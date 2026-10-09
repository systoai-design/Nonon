import { contentWords, normalizeText, numbersIn, stem, wordsOf } from "../doc-common/text";

const stems = (s: string): string[] => contentWords(s).map(stem);

export interface SupportVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Is `answer` actually backed by `quote`? Numbers must appear in the quote, and most of the answer's
 * meaningful words must too. This is a floor, not a proof of correctness: the quote itself is separately
 * checked against the source, and the quote is shown beside every answer so a person can judge.
 */
export function answerSupported(answer: string, quote: string, question = ""): SupportVerdict {
  const a = answer.trim();
  if (a.length < 1) return { ok: false, reason: "the answer is empty" };
  if (a.length > 400) return { ok: false, reason: "the answer is too long to check" };
  const quoteNums = new Set(numbersIn(quote));
  for (const n of numbersIn(a)) if (!quoteNums.has(n)) return { ok: false, reason: `the number ${n} is not in the quote` };

  const aStems = stems(a);
  const qStems = new Set(stems(quote));
  if (aStems.length === 0) {
    return numbersIn(a).length > 0 ? { ok: true } : { ok: false, reason: "the answer has no words that can be checked" };
  }
  const present = aStems.filter((s) => qStems.has(s)).length;
  const need = aStems.length <= 2 ? aStems.length : Math.ceil(aStems.length * 0.6);
  if (present < need) return { ok: false, reason: `only ${present} of ${aStems.length} words in the answer appear in the quote` };

  if (question) {
    const qs = new Set(stems(question));
    if (aStems.every((s) => qs.has(s))) return { ok: false, reason: "the question already contains the answer" };
  }
  return { ok: true };
}

/** Share of `text`'s meaningful words that occur somewhere in the source. */
export function groundedRatio(text: string, sourceStems: Set<string>): number {
  const ts = stems(text);
  if (ts.length === 0) return 0;
  return ts.filter((s) => sourceStems.has(s)).length / ts.length;
}

export function sourceStemSet(text: string): Set<string> {
  return new Set(stems(text));
}

/** Does the term really occur in the source (so the glossary cannot contain words that are not there)? */
export function termInSource(term: string, sourceNormalized: string): boolean {
  const t = normalizeText(term);
  if (t.length < 2 || wordsOf(t).length > 5) return false;
  return sourceNormalized.includes(t);
}
