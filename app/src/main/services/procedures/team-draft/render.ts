import type { ArtifactRecord } from "../../providers/stages";
import { p, type Block, type Run } from "../doc-common/docmodel";
import { clip } from "../doc-common/text";
import type { FlaggedDraft, FindingView } from "./analyze";
import { providerLabel, STAGE_LABEL } from "./pipeline";
import type { Draft, FindingKind, Review, Spec } from "./schemas";
import type { RoleName } from "../../../../shared/contracts";

const KIND_TEXT: Record<FindingKind, string> = {
  "unsupported-claim": "Not supported by the source",
  "missing-point": "Left out",
  contradiction: "Disagrees with the source",
  "spec-deviation": "Does not follow the plan",
  unclear: "Unclear",
};

const q = (s: string) => `"${s}"`;

function findingRuns(v: FindingView): Run[][] {
  const f = v.finding;
  const lines: Run[][] = [[{ text: `${KIND_TEXT[f.kind]}. `, bold: true }, f.issue]];
  if (f.draftQuote.trim()) lines.push([{ text: "Draft says: ", italic: true }, q(clip(f.draftQuote.trim(), 220))]);
  for (const c of v.cited) lines.push([{ text: `Source line ${c.line}: `, italic: true }, q(clip(c.text, 220))]);
  if (v.quote === "verified" && v.quoteLines) {
    const [a, b] = v.quoteLines;
    lines.push([`The reviewer's quote was found in the source at line ${a === b ? a : `${a} to ${b}`}.`]);
  } else if (v.quote === "not-found") {
    lines.push([{ text: "The reviewer's quote was not found in the source, so it is not relied on.", highlight: true }]);
  }
  if (v.marked === "grounded" && v.groundedAt) {
    const [a, b] = v.groundedAt;
    lines.push([{ text: `NONON found these words in the source at line ${a === b ? a : `${a} to ${b}`}, so the sentence is not highlighted and this finding is probably wrong.`, bold: true }]);
  }
  if (v.marked === "marked") lines.push(["This sentence is highlighted in the draft above."]);
  if (v.marked === "not-located") lines.push([{ text: "The sentence could not be found in the draft. Check it by hand.", highlight: true }]);
  return lines;
}

export interface ProvenanceRow {
  stage: RoleName;
  record: ArtifactRecord;
  status: "made now" | "reused";
}

export function draftBlocks(draft: Draft, flagged: FlaggedDraft, review: Review, rows: ProvenanceRow[]): Block[] {
  const blocks: Block[] = [{ t: "title", text: draft.title.trim() || "Team draft" }];
  flagged.sections.forEach((s) => {
    blocks.push({ t: "h1", text: s.heading });
    let bullets: Run[][] = [];
    const flush = () => {
      if (bullets.length > 0) blocks.push({ t: "bullets", items: bullets });
      bullets = [];
    };
    for (const para of s.paragraphs) {
      if (para.bullet) bullets.push(para.runs);
      else {
        flush();
        blocks.push({ t: "p", runs: para.runs });
      }
    }
    flush();
  });

  blocks.push({ t: "h1", text: "Review notes" });
  blocks.push({
    t: "note",
    runs: [
      review.verdict === "ready" && flagged.numberSentences.length === 0 ? "The reviewer found this draft ready." : "The reviewer asks for changes before this is used.",
      review.summary.trim() ? ` ${review.summary.trim()}` : "",
    ],
  });
  if (flagged.findings.length === 0) blocks.push(p("The reviewer listed no problems."));
  else {
    blocks.push({ t: "numbered", items: flagged.findings.map((v) => findingRuns(v).flatMap((line, i) => (i === 0 ? line : [" ", ...line]))) });
  }
  if (flagged.numberSentences.length > 0) {
    blocks.push(p({ text: "Checked by NONON, not by the AI: ", bold: true }, `these sentences contain numbers that are not in the source or your goal (${flagged.numbersNotInSource.join(", ")}). They are highlighted above.`));
  }
  blocks.push(
    p({ text: "Who did what: ", bold: true }, rows.map((r) => `${STAGE_LABEL[r.stage]}: ${providerLabel(r.record.provider)}`).join(". ") + "."),
    p("Highlighted sentences are the ones to check against your source before you use this."),
  );
  return blocks;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function provenanceTable(rows: ProvenanceRow[]): string {
  const head = "| Step | Done by | Version | Made at | Based on (ID of what it read) | This run |\n| --- | --- | --- | --- | --- | --- |";
  const body = rows.map((r) => `| ${STAGE_LABEL[r.stage]} | ${cell(providerLabel(r.record.provider))} | ${r.record.revision} | ${r.record.createdAt} | ${r.record.inputRevision.slice(0, 16)} | ${r.status} |`);
  return [head, ...body].join("\n");
}

export function specMarkdown(spec: Spec): string {
  const out = [`**Audience:** ${spec.audience}`, "", `**Purpose:** ${spec.purpose}`, "", "**Structure**", ""];
  for (const s of spec.sections) out.push(`- ${s.heading}: ${s.covers}${s.sourceLines.length ? ` (source lines ${s.sourceLines.join(", ")})` : ""}`);
  out.push("", "**Key points**", "");
  for (const k of spec.keyPoints) out.push(`- ${k.point}${k.sourceLines.length ? ` (source lines ${k.sourceLines.join(", ")})` : ""}`);
  out.push("", "**Rules to follow**", "");
  if (spec.constraints.length === 0) out.push("- None given.");
  for (const c of spec.constraints) out.push(`- ${c}`);
  return out.join("\n");
}

export function draftMarkdown(draft: Draft): string {
  const out = [`# ${draft.title}`, ""];
  for (const s of draft.sections) {
    out.push(`## ${s.heading}`, "");
    let prevBullet = false;
    for (const para of s.paragraphs) {
      const bullet = /^\s*[-*]\s+/.test(para);
      if (bullet) out.push(para.replace(/^\s*[*]\s+/, "- "));
      else {
        if (prevBullet) out.push("");
        out.push(para, "");
      }
      prevBullet = bullet;
    }
    if (prevBullet) out.push("");
  }
  return out.join("\n");
}

export function reviewMarkdown(review: Review, flagged: FlaggedDraft): string {
  const out = [`**Verdict:** ${review.verdict === "ready" ? "Ready" : "Needs changes"}`, "", review.summary.trim() || "(no summary)", ""];
  if (flagged.findings.length === 0) out.push("No problems listed.");
  for (const v of flagged.findings) {
    const lines = findingRuns(v).map((line) => line.map((r) => (typeof r === "string" ? r : r.text)).join(""));
    out.push(`${v.n}. ${lines[0] ?? ""}`);
    for (const l of lines.slice(1)) out.push(`   - ${l}`);
  }
  return out.join("\n");
}

export function specAndReviewDoc(opts: {
  goal: string;
  sourceName: string;
  spec: Spec;
  draft: Draft;
  review: Review;
  flagged: FlaggedDraft;
  rows: ProvenanceRow[];
}): string {
  return [
    "# Team draft: plan, draft and review",
    "",
    `Source: ${opts.sourceName}`,
    `Goal: ${opts.goal}`,
    "",
    "## Where each step came from",
    "",
    provenanceTable(opts.rows),
    "",
    "Each step only saw what it needed: the Plan step saw the source and your goal; the Write step saw the plan and the source; the Check step saw the plan, the draft and the source. No other files, email or chat were shared.",
    "",
    `## 1. Plan: the outline (${providerLabel(opts.rows.find((r) => r.stage === "design")?.record.provider ?? "local")})`,
    "",
    specMarkdown(opts.spec),
    "",
    `## 2. Write: the draft (${providerLabel(opts.rows.find((r) => r.stage === "implement")?.record.provider ?? "local")})`,
    "",
    draftMarkdown(opts.draft),
    `## 3. Check: the review (${providerLabel(opts.rows.find((r) => r.stage === "review")?.record.provider ?? "local")})`,
    "",
    reviewMarkdown(opts.review, opts.flagged),
    "",
  ].join("\n");
}
