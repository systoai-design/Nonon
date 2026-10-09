import { z } from "zod";
import type { RoleName } from "../../../../shared/contracts";
import { toJsonSchema } from "../doc-common/llm";
import { collapseRepeats } from "../doc-common/text";
import { DraftSchema, ReviewSchema, SpecSchema, type Draft, type Review, type Spec } from "./schemas";
import type { TeamSource } from "./source";

/** `problems` are things code removed or could not trust; they trigger the one retry and are kept as warnings if the retry does not fix them. */
export type Checked<T> = { ok: true; value: T; text: string; problems: string[] } | { ok: false; error: string };

export const JSON_SCHEMA: Record<RoleName, Record<string, unknown>> = {
  design: toJsonSchema(SpecSchema),
  implement: toJsonSchema(DraftSchema),
  review: toJsonSchema(ReviewSchema),
};

function parseJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
    if (fenced?.[1]) return JSON.parse(fenced[1]);
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("The reply was not JSON.");
  }
}

function issues(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

function parseWith<S extends z.ZodType>(schema: S, raw: string): { ok: true; value: z.infer<S> } | { ok: false; error: string } {
  try {
    return { ok: true, value: schema.parse(parseJson(raw)) as z.infer<S> };
  } catch (e) {
    return { ok: false, error: issues(e) };
  }
}

/** Keeps only line numbers that exist in the source. Everything dropped is described so the retry can be told. */
function keepRealLines(label: string, nums: number[], src: TeamSource, problems: string[]): number[] {
  const kept = [...new Set(nums.filter((n) => src.valid.has(n)))];
  const bad = nums.filter((n) => !src.valid.has(n));
  if (bad.length > 0) problems.push(`${label} cites line ${[...new Set(bad)].join(", ")}, which is not a line of the source (lines run from 1 to ${src.lineCount})`);
  return kept;
}

const canonical = (v: unknown) => JSON.stringify(v, null, 1);

export function checkSpec(raw: string, src: TeamSource): Checked<Spec> {
  const r = parseWith(SpecSchema, raw);
  if (!r.ok) return r;
  const problems: string[] = [];
  const value: Spec = {
    ...r.value,
    sections: r.value.sections.map((s) => ({ ...s, sourceLines: keepRealLines(`Section "${s.heading}"`, s.sourceLines, src, problems) })),
    keyPoints: r.value.keyPoints.map((k) => ({ ...k, sourceLines: keepRealLines(`Point "${k.point.slice(0, 40)}"`, k.sourceLines, src, problems) })),
  };
  return { ok: true, value, text: canonical(value), problems };
}

const headingKey = (h: string) => h.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The plan the Implement step was given, read back from its prompt. Null when it cannot be read; the coverage check is then skipped. */
export function specFromPrompt(prompt: string): Spec | null {
  const m = /--- design step result \(revision \d+\) ---\n([\s\S]*?)(?=\n\n--- |$)/.exec(prompt);
  if (!m?.[1]) return null;
  try {
    return SpecSchema.parse(JSON.parse(m[1]));
  } catch {
    return null;
  }
}

export function checkDraft(raw: string, _src: TeamSource, spec?: Spec | null): Checked<Draft> {
  const r = parseWith(DraftSchema, raw);
  if (!r.ok) return r;
  const problems: string[] = [];
  const sections = r.value.sections.map((s) => {
    const joined = s.paragraphs.map((p) => p.replace(/\s*[\r\n]+\s*/g, " ").trim()).filter(Boolean);
    const { text, removed } = collapseRepeats(joined.join("\n"));
    if (removed > 0) problems.push(`Section "${s.heading}" repeated itself ${removed} time${removed === 1 ? "" : "s"}`);
    return { ...s, paragraphs: text.split("\n").filter((p) => p.trim()) };
  });
  if (sections.every((s) => s.paragraphs.length === 0)) return { ok: false, error: "the draft has no text" };
  const value: Draft = { ...r.value, sections: sections.filter((s) => s.paragraphs.length > 0) };
  if (spec) {
    const have = value.sections.map((s) => headingKey(s.heading));
    const missingHeads = spec.sections.map((s) => s.heading).filter((h) => !have.some((x) => x === headingKey(h) || x.includes(headingKey(h)) || headingKey(h).includes(x)));
    if (missingHeads.length > 0) problems.push(`The draft has no section for: ${missingHeads.map((h) => `"${h}"`).join(", ")}. Write one section for every section of the plan, with the same headings`);
  }
  return { ok: true, value, text: canonical(value), problems };
}

export function checkReview(raw: string, src: TeamSource): Checked<Review> {
  const r = parseWith(ReviewSchema, raw);
  if (!r.ok) return r;
  const problems: string[] = [];
  const findings = r.value.findings.map((f, i) => {
    const label = `Finding ${i + 1}`;
    if (f.kind === "unsupported-claim" && !f.draftQuote.trim()) problems.push(`${label} says a claim is unsupported but does not quote the sentence from the draft`);
    return { ...f, sourceLines: keepRealLines(label, f.sourceLines, src, problems) };
  });
  const value: Review = { ...r.value, findings };
  return { ok: true, value, text: canonical(value), problems };
}

export const CHECKERS: { [R in RoleName]: (raw: string, src: TeamSource, spec?: Spec | null) => Checked<unknown> } = {
  design: checkSpec,
  implement: checkDraft,
  review: checkReview,
};

export function parseArtifact<T>(role: RoleName, text: string, src: TeamSource): T | null {
  const checked = CHECKERS[role](text, src);
  return checked.ok ? (checked.value as T) : null;
}
