import type { Cell, DateOrder } from "./types";

export type DateClass =
  | { type: "ymd"; y: number; m: number; d: number }
  /** Numeric a/b/year where a and b could be day or month. */
  | { type: "num3"; a: number; b: number; y: number; text: string };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

function fullYear(y: number): number {
  if (y >= 100) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

export function toIso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const TIME_TAIL = /[T\s]+\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:[AaPp][Mm])?\s*(?:Z|[+-]\d{2}:?\d{2})?$/;
const WEEKDAY_HEAD = /^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+/i;

/** Parses the text shapes bookkeepers meet. Does not decide day/month order for numeric a/b/year dates. */
export function classifyDate(raw: string): DateClass | null {
  let s = raw.normalize("NFKC").trim();
  if (!s || s.length > 40) return null;
  s = s.replace(TIME_TAIL, "").replace(WEEKDAY_HEAD, "").trim();

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m && Number(m[1]) >= 1990 && Number(m[1]) <= 2099) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(s);
  if (m) return { type: "num3", a: Number(m[1]), b: Number(m[2]), y: fullYear(Number(m[3])), text: s };

  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([A-Za-z]{3,9})\.?,?[\s\-/.]*(\d{4}|\d{2})$/.exec(s);
  if (m) {
    const mo = MONTHS[(m[2] ?? "").toLowerCase()];
    return mo ? ymd(fullYear(Number(m[3])), mo, Number(m[1])) : null;
  }

  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}|\d{2})$/.exec(s);
  if (m) {
    const mo = MONTHS[(m[1] ?? "").toLowerCase()];
    return mo ? ymd(fullYear(Number(m[3])), mo, Number(m[2])) : null;
  }
  return null;
}

function ymd(y: number, m: number, d: number): DateClass | null {
  return toIso(y, m, d) ? { type: "ymd", y, m, d } : null;
}

export function classifyCell(cell: Cell): DateClass | null {
  if (cell.d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cell.d);
    return m ? { type: "ymd", y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
  }
  if (cell.n !== undefined) return null;
  return classifyDate(cell.t);
}

export function resolveDate(c: DateClass, order: DateOrder): string | null {
  if (c.type === "ymd") return toIso(c.y, c.m, c.d);
  return order === "DMY" ? toIso(c.y, c.b, c.a) : toIso(c.y, c.a, c.b);
}

export function cellDate(cell: Cell, order: DateOrder): string | null {
  const c = classifyCell(cell);
  return c ? resolveDate(c, order) : null;
}

export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86400000);
}

export function daysBetween(a: string, b: string): number {
  return dayNumber(a) - dayNumber(b);
}

export interface DateColumnInfo {
  nonEmpty: number;
  parsed: number;
  num3: number;
  dayFirst: number;
  monthFirst: number;
  invalid: number;
  /** none: no day/month-ambiguous values; determined: values prove the order; ambiguous: no proof; mixed: both orders proven. */
  status: "none" | "determined" | "ambiguous" | "mixed";
  order: DateOrder | null;
  /** First ambiguous value, for the question text. */
  example: Extract<DateClass, { type: "num3" }> | null;
  values: DateClass[];
}

export function analyseDateColumn(cells: Cell[]): DateColumnInfo {
  const info: DateColumnInfo = {
    nonEmpty: 0, parsed: 0, num3: 0, dayFirst: 0, monthFirst: 0, invalid: 0,
    status: "none", order: null, example: null, values: [],
  };
  for (const cell of cells) {
    if (!cell.t.trim() && !cell.d) continue;
    info.nonEmpty++;
    const c = classifyCell(cell);
    if (!c) continue;
    info.parsed++;
    info.values.push(c);
    if (c.type !== "num3") continue;
    info.num3++;
    const aBig = c.a > 12;
    const bBig = c.b > 12;
    if (aBig && bBig) info.invalid++;
    else if (aBig) info.dayFirst++;
    else if (bBig) info.monthFirst++;
    else info.example ??= c;
  }
  if (info.num3 === 0) return info;
  if (info.dayFirst > 0 && info.monthFirst > 0) info.status = "mixed";
  else if (info.dayFirst > 0) {
    info.status = "determined";
    info.order = "DMY";
  } else if (info.monthFirst > 0) {
    info.status = "determined";
    info.order = "MDY";
  } else info.status = "ambiguous";
  return info;
}

export interface DateRange {
  from: string;
  to: string;
}

export function rangeOf(isos: string[]): DateRange | null {
  if (!isos.length) return null;
  let from = isos[0] as string;
  let to = from;
  for (const d of isos) {
    if (d < from) from = d;
    if (d > to) to = d;
  }
  return { from, to };
}

/**
 * Picks the more plausible reading of an ambiguous column: the one with more dates inside the other file's
 * range, else the one with the tighter span (a statement covers weeks, not a year).
 * Only a suggestion: the user always confirms.
 */
export function suggestOrder(values: DateClass[], sibling: DateRange | null): DateOrder {
  const score = (order: DateOrder) => {
    const isos = values.map((v) => resolveDate(v, order)).filter((d): d is string => d !== null);
    const r = rangeOf(isos);
    if (!r) return { overlap: -1, span: Infinity };
    const span = daysBetween(r.to, r.from);
    // Count dates that land inside the other file's range: a wide range overlapping a sibling proves nothing.
    const overlap = sibling ? isos.filter((d) => d >= sibling.from && d <= sibling.to).length : 0;
    return { overlap, span };
  };
  const dmy = score("DMY");
  const mdy = score("MDY");
  if (sibling && dmy.overlap !== mdy.overlap) return dmy.overlap > mdy.overlap ? "DMY" : "MDY";
  if (dmy.span !== mdy.span) return dmy.span < mdy.span ? "DMY" : "MDY";
  return "DMY";
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 Apr 2026" for plain-language prompts. */
export function friendlyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[(m ?? 1) - 1]} ${y}`;
}
