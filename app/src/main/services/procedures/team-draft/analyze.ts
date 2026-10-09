import type { Run } from "../doc-common/docmodel";
import { verifyQuote } from "../doc-common/quote";
import { contentWords, normalizeText, unsupportedNumbers } from "../doc-common/text";
import type { Draft, Finding, Review } from "./schemas";
import { lineText, type TeamSource } from "./source";

export interface FindingView {
  n: number;
  finding: Finding;
  /** The cited lines, quoted from the file by code (not by the model). */
  cited: { line: number; text: string }[];
  /** "verified": the reviewer's source quote is really in the file. "not-found": it is not, so it is not relied on. */
  quote: "verified" | "not-found" | "none";
  quoteLines?: [number, number];
  /** For unsupported-claim findings: whether the sentence was found in the draft and marked. */
  marked: "marked" | "not-located" | "grounded" | "n/a";
  /** Where the doubted sentence's own words appear in the source, when they do. Code overrules the reviewer then. */
  groundedAt?: [number, number];
}

export interface FlaggedDraft {
  /** Per section, per paragraph: the runs to show, with unsupported sentences highlighted. */
  sections: { heading: string; paragraphs: { bullet: boolean; runs: Run[] }[] }[];
  findings: FindingView[];
  /** Sentences marked because the reviewer called them unsupported. */
  claimsMarked: number;
  /** Every sentence highlighted for any reason. */
  highlighted: number;
  /** Sentences marked by code because they contain a number that is not in the source or the goal. */
  numberSentences: { text: string; numbers: string[] }[];
  numbersNotInSource: string[];
}

const splitSentences = (p: string): string[] => p.split(/(?<=[.!?])\s+/).filter((s) => s.trim());

function sameSentence(sentence: string, quote: string): boolean {
  const a = normalizeText(sentence);
  const b = normalizeText(quote.replace(/^["'“‘]+|["'”’]+$/g, ""));
  if (a.length < 12 || b.length < 12) return a === b && a.length > 0;
  if (a.includes(b) || b.includes(a)) return true;
  const wa = new Set(contentWords(sentence));
  const wb = new Set(contentWords(quote));
  if (wa.size < 3 || wb.size < 3) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / (wa.size + wb.size - shared) >= 0.6;
}

export function analyzeDraft(draft: Draft, review: Review, src: TeamSource, goal: string): FlaggedDraft {
  const sourceText = src.doc.lines.join("\n");
  const grounded = new Map<number, [number, number]>();
  review.findings.forEach((f, i) => {
    if (f.kind !== "unsupported-claim" || !f.draftQuote.trim()) return;
    const m = verifyQuote(src.doc, f.draftQuote);
    if (m.found && m.startLine !== undefined) grounded.set(i, [m.startLine, m.endLine ?? m.startLine]);
  });
  const claims = review.findings.map((f, i) => ({ f, i })).filter(({ f, i }) => f.kind === "unsupported-claim" && f.draftQuote.trim() && !grounded.has(i));
  const located = new Set<number>();
  const numberSentences: { text: string; numbers: string[] }[] = [];
  let claimsMarked = 0;
  let highlighted = 0;

  const sections = draft.sections.map((s) => ({
    heading: s.heading,
    paragraphs: s.paragraphs.map((raw) => {
      const bullet = /^\s*[-*]\s+/.test(raw);
      const text = raw.replace(/^\s*[-*]\s+/, "").trim();
      const runs: Run[] = [];
      const parts = bullet ? [text] : splitSentences(text);
      parts.forEach((sentence, idx) => {
        const lead = idx > 0 ? " " : "";
        const hit = claims.filter(({ f }) => sameSentence(sentence, f.draftQuote));
        const nums = unsupportedNumbers(sentence, sourceText, goal);
        for (const { i } of hit) located.add(i);
        if (hit.length > 0 || nums.length > 0) {
          const why = hit.length > 0 ? "the reviewer found no support for this in the source" : `${nums.join(", ")} is not in the source`;
          runs.push(lead, { text: sentence, highlight: true }, { text: ` [check: ${why}]`, bold: true, highlight: true });
          highlighted += 1;
          if (hit.length > 0) claimsMarked += 1;
          if (nums.length > 0) numberSentences.push({ text: sentence, numbers: nums });
        } else {
          runs.push(lead + sentence);
        }
      });
      return { bullet, runs };
    }),
  }));

  const findings: FindingView[] = review.findings.map((f, i) => {
    const cited = f.sourceLines.filter((n) => src.valid.has(n)).map((line) => ({ line, text: lineText(src, line) }));
    let quote: FindingView["quote"] = "none";
    let quoteLines: [number, number] | undefined;
    if (f.sourceQuote.trim()) {
      const m = verifyQuote(src.doc, f.sourceQuote);
      quote = m.found ? "verified" : "not-found";
      if (m.found && m.startLine !== undefined) quoteLines = [m.startLine, m.endLine ?? m.startLine];
    }
    const isClaim = f.kind === "unsupported-claim";
    const marked: FindingView["marked"] = !isClaim ? "n/a" : grounded.has(i) ? "grounded" : located.has(i) ? "marked" : "not-located";
    const groundedAt = grounded.get(i);
    return { n: i + 1, finding: f, cited, quote, ...(quoteLines ? { quoteLines } : {}), ...(groundedAt ? { groundedAt } : {}), marked };
  });

  const allNumbers = [...new Set(numberSentences.flatMap((s) => s.numbers))];
  return { sections, findings, claimsMarked, highlighted, numberSentences, numbersNotInSource: allNumbers };
}
