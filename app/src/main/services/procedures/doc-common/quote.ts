import { docFromText, type SourceDoc } from "./extract";
import { normalizeText } from "./text";

export interface QuoteMatch {
  found: boolean;
  /** 1-based line where the quote starts / ends. */
  startLine?: number;
  endLine?: number;
  reason?: string;
}

interface DocIndex {
  text: string;
  starts: number[];
}

const indexCache = new WeakMap<SourceDoc, DocIndex>();

function indexOf(doc: SourceDoc): DocIndex {
  const hit = indexCache.get(doc);
  if (hit) return hit;
  const starts: number[] = [];
  let text = "";
  for (const line of doc.lines) {
    const n = normalizeText(line);
    starts.push(text.length);
    if (n) text += n + " ";
  }
  const built = { text, starts };
  indexCache.set(doc, built);
  return built;
}

function lineAt(index: DocIndex, offset: number): number {
  let lo = 0;
  let hi = index.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((index.starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const MIN_WORDS = 3;
const MIN_CHARS = 12;

/**
 * True only when the quoted words really appear in the source, in order. Differences in spacing,
 * capitalisation, curly vs straight quotes and the "[12]" line markers we put in prompts are ignored.
 * "..." in a quote means "words skipped"; every fragment must still be found, in order.
 */
export function verifyQuote(source: SourceDoc | string, quote: string): QuoteMatch {
  const doc = typeof source === "string" ? docFromText("text", source) : source;
  const cleaned = quote
    .replace(/(^|\n)\s*\[\d+\]\s?/g, " ")
    .replace(/^["'“‘]+|["'”’]+$/g, "");
  const fragments = cleaned
    .split(/\.{3}|…/)
    .map(normalizeText)
    .filter((f) => f.length > 0);
  if (fragments.length === 0) return { found: false, reason: "no supporting words were given" };
  const total = fragments.join(" ");
  if (total.length < MIN_CHARS || total.split(" ").length < MIN_WORDS) return { found: false, reason: "the supporting words are too short to check" };

  const index = indexOf(doc);
  let from = 0;
  let first = -1;
  let last = -1;
  for (const frag of fragments) {
    if (frag.split(" ").length < 2 && fragments.length > 1) continue;
    const at = index.text.indexOf(frag, from);
    if (at < 0) return { found: false, reason: "those words are not in the file" };
    if (first < 0) first = at;
    from = at + frag.length;
    last = from - 1;
  }
  if (first < 0) return { found: false, reason: "the supporting words are too short to check" };
  return { found: true, startLine: lineAt(index, first), endLine: lineAt(index, Math.max(first, last)) };
}

/** Try each document; returns the first that contains the quote. */
export function verifyQuoteInAny(docs: SourceDoc[], quote: string): (QuoteMatch & { doc?: SourceDoc }) {
  let reason: string | undefined;
  for (const doc of docs) {
    const m = verifyQuote(doc, quote);
    if (m.found) return { ...m, doc };
    reason = m.reason;
  }
  return reason ? { found: false, reason } : { found: false };
}
