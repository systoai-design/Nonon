/** Text helpers shared by the document procedures. Pure, no I/O. */

export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[​-‍﻿­]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function wordsOf(s: string): string[] {
  return normalizeText(s).match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? [];
}

const STOPWORDS = new Set(
  "a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those there their they them he she his her we our you your i not no yes so than then also can could would should will shall may might must do does did done has have had into over under about which who whom what when where why how".split(
    " ",
  ),
);

export function contentWords(s: string): string[] {
  return wordsOf(s).filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Light stemmer: enough to match "plants"/"plant", "absorbs"/"absorbed" without a language model. */
export function stem(w: string): string {
  let x = w;
  for (const suf of ["ing", "edly", "ed", "es", "s", "ly"]) {
    if (x.length > suf.length + 3 && x.endsWith(suf)) {
      x = x.slice(0, -suf.length);
      break;
    }
  }
  return x;
}

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18",
  nineteen: "19", twenty: "20",
};

/** Numeric tokens as written ("6.50", "7", "12345"), with thousands commas removed. */
export function numbersIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.normalize("NFKC").matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.push(m[0].replace(/,/g, "").replace(/\.$/, ""));
  return out;
}

function numberSet(source: string): Set<string> {
  const set = new Set(numbersIn(source));
  for (const w of wordsOf(source)) {
    const n = NUMBER_WORDS[w];
    if (n) set.add(n);
  }
  return set;
}

/** Numbers that appear in `output` but in none of `sources`. Used to catch invented figures and dates. */
export function unsupportedNumbers(output: string, ...sources: string[]): string[] {
  const known = new Set<string>();
  for (const s of sources) for (const n of numberSet(s)) known.add(n);
  const bad = new Set<string>();
  for (const n of numbersIn(output)) if (!known.has(n)) bad.add(n);
  return [...bad];
}

/** Phrases that read as instructions to an AI rather than as note content. */
const INJECTION_PATTERNS: RegExp[] = [
  /\bignore\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|prompts?|rules?|messages?)/i,
  /\bdisregard\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)/i,
  /\bforget\s+(?:all\s+|everything\s+)?(?:previous|prior|above|your)\s+(?:instructions?|rules?)/i,
  /\byou\s+are\s+now\s+(?:in\s+(?:\w+\s+){0,2}mode|acting\s+as|unrestricted|free\s+of)/i,
  /\b(?:admin|developer|debug|god)\s+mode\b/i,
  /\bsystem\s+prompt\b/i,
  /\bnew\s+instructions?\s*:/i,
  /\b(?:reveal|print|show|repeat)\s+(?:me\s+)?(?:your|the)\s+(?:system\s+)?(?:prompt|instructions)/i,
  /\bdo\s+not\s+(?:follow|obey)\s+(?:the\s+)?(?:above|previous|prior)/i,
  /\bpretend\s+(?:that\s+)?you\b/i,
  /\breply\s+(?:only\s+)?with\s+the\s+word\b/i,
];

export function looksLikeInjection(line: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(line));
}

/** 1-based line numbers whose text looks like an instruction aimed at an AI. */
export function findInjectionLines(lines: readonly string[]): number[] {
  const out: number[] = [];
  lines.forEach((l, i) => {
    if (looksLikeInjection(l)) out.push(i + 1);
  });
  return out;
}

/** Rough token estimate for prompt budgeting (English averages 3.5 to 4 characters per token). */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 3.5);
}

export function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

/** Strip characters that could break a file name. */
export function fileSafe(s: string): string {
  const cleaned = s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "Document";
}

/** Currency symbols in `output` that none of the sources use, such as a "$" added to a bare amount. */
export function unsupportedCurrency(output: string, ...sources: string[]): string[] {
  const all = sources.join(" ");
  return [...new Set(output.match(/[$€£₱¥]/g) ?? [])].filter((c) => !all.includes(c));
}

/**
 * Small models sometimes get stuck and repeat a line or sentence many times. Collapses back-to-back repeats
 * (ignoring case and spacing) and reports how many were removed so the caller can say so.
 */
export function collapseRepeats(text: string): { text: string; removed: number } {
  let removed = 0;
  const outLines: string[] = [];
  let prevLine = "";
  for (const line of text.split(/\r?\n/)) {
    const key = line.trim().toLowerCase();
    if (key && key === prevLine) {
      removed += 1;
      continue;
    }
    prevLine = key;
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept: string[] = [];
    let prev = "";
    for (const s of sentences) {
      const k = s.trim().toLowerCase();
      if (k.length > 3 && k === prev) {
        removed += 1;
        continue;
      }
      prev = k;
      kept.push(s);
    }
    outLines.push(kept.join(" "));
  }
  return { text: outLines.join("\n"), removed };
}
