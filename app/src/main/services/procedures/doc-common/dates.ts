import { normalizeText } from "./text";

/**
 * Date rules for due dates. A date is only produced when it follows from words in the notes:
 * an explicit date, or a relative phrase with a meeting date written in the notes. Anything else
 * (next week, soon, a weekday that equals the meeting day) is kept exactly as written.
 */

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const monthPattern = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const weekdayPattern = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join("|");

export interface ParsedDate {
  iso: string;
  /** The words in the source that the date came from. */
  matched: string;
  /** True when the year was not written and was taken from the meeting date. */
  yearInferred: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function validYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const toIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function fromIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return { y, m, d };
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = fromIso(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function weekdayOf(iso: string): number {
  const { y, m, d } = fromIso(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function formatIso(iso: string): string {
  const { y, m, d } = fromIso(iso);
  return `${WEEKDAY_NAMES[weekdayOf(iso)]} ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/** First explicit calendar date in `text`, by position. `refIso` supplies the year only when the text has none. */
export function parseExplicitDate(text: string, refIso?: string | null): ParsedDate | null {
  const t = text.normalize("NFKC");
  const ref = refIso ? fromIso(refIso) : null;
  const refKey = ref ? `${ref.y}-${pad(ref.m)}-${pad(ref.d)}` : "";
  const found: (ParsedDate & { at: number })[] = [];

  const withOptionalYear = (mo: number, day: number, yearText: string | undefined, matched: string, at: number) => {
    if (yearText) {
      if (validYmd(+yearText, mo, day)) found.push({ iso: toIso(+yearText, mo, day), matched, yearInferred: false, at });
    } else if (ref) {
      let y = ref.y;
      if (validYmd(y, mo, day) && toIso(y, mo, day) < refKey) y += 1;
      if (validYmd(y, mo, day)) found.push({ iso: toIso(y, mo, day), matched, yearInferred: true, at });
    }
  };

  for (const m of t.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    if (validYmd(+m[1]!, +m[2]!, +m[3]!)) found.push({ iso: toIso(+m[1]!, +m[2]!, +m[3]!), matched: m[0], yearInferred: false, at: m.index ?? 0 });
  }
  // Month day[, year]  e.g. "October 20", "Oct 20th, 2026"
  const mdRe = new RegExp(String.raw`\b(${monthPattern})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b`, "gi");
  for (const m of t.matchAll(mdRe)) withOptionalYear(MONTHS[m[1]!.toLowerCase()]!, +m[2]!, m[3], m[0], m.index ?? 0);
  // Day Month[ year]  e.g. "20 October", "20th of October 2026"
  const dmRe = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${monthPattern})\.?(?:,?\s+(\d{4}))?\b`, "gi");
  for (const m of t.matchAll(dmRe)) withOptionalYear(MONTHS[m[2]!.toLowerCase()]!, +m[1]!, m[3], m[0], m.index ?? 0);
  // 14/10/2026 or 10/14/2026: only when one side cannot be a month.
  for (const m of t.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g)) {
    const a = +m[1]!;
    const b = +m[2]!;
    const y = +m[3]!;
    if (a > 12 && validYmd(y, b, a)) found.push({ iso: toIso(y, b, a), matched: m[0], yearInferred: false, at: m.index ?? 0 });
    else if (b > 12 && validYmd(y, a, b)) found.push({ iso: toIso(y, a, b), matched: m[0], yearInferred: false, at: m.index ?? 0 });
  }
  if (found.length === 0) return null;
  // Earliest in the text; at the same spot prefer the one that states its own year.
  found.sort((p, q) => p.at - q.at || Number(p.yearInferred) - Number(q.yearInferred) || q.matched.length - p.matched.length);
  const best = found[0]!;
  return { iso: best.iso, matched: best.matched, yearInferred: best.yearInferred };
}

/** The meeting date written near the top of the notes ("Date: Tuesday 6 October 2026"). Needs a full date with a year. */
export function findMeetingDate(lines: readonly string[]): { iso: string; line: number; matched: string } | null {
  // A labelled header line may be anywhere in the first 25 lines; an unlabelled date only counts in the first three
  // non-empty lines, so a deadline written further down ("by 9 October 2026") is never mistaken for the meeting date.
  let seen = 0;
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    seen += 1;
    const labelled = /^\s*[#*_\s-]*(?:meeting\s+)?(?:date|when|held|on)\b/i.test(line);
    if (!labelled && seen > 3) continue;
    const p = parseExplicitDate(line, null);
    if (p && !p.yearInferred) return { iso: p.iso, line: i + 1, matched: p.matched };
  }
  return null;
}

export type DueBasis = "explicit" | "relative" | "as-written";

export interface DueResolution {
  /** YYYY-MM-DD when the phrase pins one day, else null. */
  iso: string | null;
  /** The phrase exactly as written in the notes. */
  phrase: string;
  basis: DueBasis;
  /** Plain explanation shown next to the date. */
  note: string;
}

/**
 * Turn a due phrase from the notes into a date only when the notes make it unambiguous.
 * Weekday phrases resolve to the first such weekday AFTER the meeting day; "next <weekday>", "next week",
 * "end of the month" and similar stay as written because people read them differently.
 */
export function resolveDue(phrase: string, meetingIso: string | null): DueResolution {
  const raw = phrase.trim();
  const asWritten = (note: string): DueResolution => ({ iso: null, phrase: raw, basis: "as-written", note });
  if (!raw) return asWritten("");
  const n = normalizeText(raw);

  const explicit = parseExplicitDate(raw, meetingIso);
  if (explicit) {
    return {
      iso: explicit.iso,
      phrase: raw,
      basis: "explicit",
      note: explicit.yearInferred ? `Year taken from the meeting date (${meetingIso}).` : "Date written in the notes.",
    };
  }
  if (!meetingIso) return asWritten("The notes do not say when the meeting was, so this is kept as written.");

  if (/\b(?:next|following|after)\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(n) || /\bnext\s+(?:mon|tue|wed|thu|fri|sat|sun)\b/.test(n)) {
    return asWritten("Kept as written because it can mean more than one day.");
  }
  if (/\b(?:end of (?:the )?(?:week|month|quarter|year)|asap|soon|later|eventually|when possible|whenever|some ?time)\b/.test(n)) {
    return asWritten("Kept as written because it does not name a day.");
  }
  if (/\btomorrow\b/.test(n)) return { iso: addDays(meetingIso, 1), phrase: raw, basis: "relative", note: `The day after the meeting (${meetingIso}).` };
  if (/\b(?:today|tonight)\b/.test(n)) return { iso: meetingIso, phrase: raw, basis: "relative", note: `The day of the meeting (${meetingIso}).` };

  const inN = /\bin\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|days|week|weeks)\b/.exec(n);
  if (inN) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const count = /^\d+$/.test(inN[1]!) ? +inN[1]! : (words[inN[1]!] ?? 0);
    if (count > 0) {
      const days = inN[2]!.startsWith("week") ? count * 7 : count;
      return { iso: addDays(meetingIso, days), phrase: raw, basis: "relative", note: `${days} days after the meeting (${meetingIso}).` };
    }
  }

  const wd = new RegExp(`\\b(${weekdayPattern})\\b`).exec(n);
  if (wd) {
    const target = WEEKDAYS[wd[1]!]!;
    const meetingDay = weekdayOf(meetingIso);
    if (target === meetingDay) return asWritten("Kept as written: that weekday is also the meeting day, so it could mean today or next week.");
    let delta = (target - meetingDay + 7) % 7;
    if (delta === 0) delta = 7;
    return { iso: addDays(meetingIso, delta), phrase: raw, basis: "relative", note: `The first ${WEEKDAY_NAMES[target]} after the meeting (${meetingIso}).` };
  }
  return asWritten("Kept as written.");
}

/** Every explicit calendar date written in `text` (with the year it states or, for the day-month form, none). */
export function allExplicitDates(text: string): { iso: string; matched: string }[] {
  const out: { iso: string; matched: string }[] = [];
  let rest = text;
  for (let guard = 0; guard < 200; guard++) {
    const p = parseExplicitDate(rest, null);
    if (!p) break;
    out.push({ iso: p.iso, matched: p.matched });
    rest = rest.slice(rest.indexOf(p.matched) + p.matched.length);
  }
  return out;
}

/**
 * Full dates (with a year) in `output` that the sources never write. This catches a model attaching a year to
 * "12 October", or combining a day from one place with a month from another. `allowedIso` are dates the code itself resolved.
 */
export function unsupportedDates(output: string, sources: string[], allowedIso: string[] = []): string[] {
  const known = new Set(allowedIso);
  for (const s of sources) for (const d of allExplicitDates(s)) known.add(d.iso);
  const bad: string[] = [];
  for (const d of allExplicitDates(output)) if (!known.has(d.iso)) bad.push(d.matched);
  return [...new Set(bad)];
}
