import { daysBetween } from "./dates";
import { formatMoney } from "./money";
import type { Totals } from "./totals";
import type { Assignment, MatchResult, Rec } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Oct 2026, 5:57 PM" in the computer's own time zone. */
export function friendlyTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function headline(t: Totals): string {
  const total = t.totalA.count + t.totalB.count;
  const matchedRows = t.matched.pairs * 2;
  const first =
    matchedRows === total ? `Of ${total} rows, all ${total} match.` : matchedRows === 0 ? `Of ${total} rows, none match.` : `Of ${total} rows, ${matchedRows} match.`;
  const pieces: [number, string][] = [
    [t.onlyA.count, "only in the first file"],
    [t.onlyB.count, "only in the second"],
    [t.dupA.count + t.dupB.count, "listed twice"],
    [t.ambA.count + t.ambB.count, "not sure"],
  ];
  const used = pieces.filter(([n]) => n > 0);
  if (!used.length) return first;
  const parts = used.map(([n, text], i) => (i === 0 ? `${n} ${n === 1 ? "is" : "are"} ${text}` : `${n} ${text}`));
  return `${first} ${parts.join(", ")}.`;
}

/** Plain lines that say where the gap between the two totals comes from. Every figure is from the integer-cent totals. */
export function gapLines(t: Totals, currency: string | null): string[] {
  const m = (c: number) => formatMoney(c, currency);
  const by = Object.fromEntries(t.rows.map((r) => [r.key, r]));
  const move = (effect: number) =>
    effect === 0 ? "This does not change the gap." : `This ${effect > 0 ? "raises" : "lowers"} the gap by ${m(Math.abs(effect))}.`;
  const lines: string[] = [];

  const matched = by.matched;
  if (matched && matched.effect !== 0) {
    lines.push(`The matched pairs are not exactly equal, as you allowed. ${move(matched.effect)}`);
  }
  if (t.onlyA.count) {
    lines.push(`${plural(t.onlyA.count, "item", "items")} only in the first file ${t.onlyA.count === 1 ? "adds" : "add"} up to ${m(t.onlyA.cents)}. ${move(by.onlyA?.effect ?? 0)}`);
  }
  if (t.onlyB.count) {
    lines.push(`${plural(t.onlyB.count, "item", "items")} only in the second file ${t.onlyB.count === 1 ? "adds" : "add"} up to ${m(t.onlyB.cents)}. ${move(by.onlyB?.effect ?? 0)}`);
  }
  if (t.dupA.count || t.dupB.count) {
    const sides: string[] = [];
    if (t.dupA.count) sides.push(`${plural(t.dupA.count, "row", "rows")} listed twice in the first file (${m(t.dupA.cents)} extra)`);
    if (t.dupB.count) sides.push(`${plural(t.dupB.count, "row", "rows")} listed twice in the second file (${m(t.dupB.cents)} extra)`);
    lines.push(`${sides.join(" and ")}. ${move((by.dupA?.effect ?? 0) + (by.dupB?.effect ?? 0))}`);
  }
  if (t.ambA.count || t.ambB.count) {
    lines.push(`${plural(t.ambA.count + t.ambB.count, "row", "rows")} could match more than one other row, so they are left for you. ${move(by.ambiguous?.effect ?? 0)}`);
  }
  if (!lines.length) lines.push(t.difference === 0 ? "There is no gap. Every row found its partner." : "The matched rows account for the whole gap.");
  return lines;
}

/** One adjacent pair of digits trades places: 3846.00 and 3486.00. Never a guess about anything else. */
export function looksSwapped(x: number, y: number): boolean {
  if (x === y || Math.sign(x) !== Math.sign(y)) return false;
  const a = String(Math.abs(x));
  const b = String(Math.abs(y));
  if (a.length !== b.length || a.length < 3) return false;
  const at: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) at.push(i);
  const i = at[0];
  return at.length === 2 && i !== undefined && at[1] === i + 1 && a[i] === b[i + 1] && a[i + 1] === b[i];
}

export interface LookItem {
  title: string;
  where: string;
  reason: string;
  weight: number;
}

interface Names {
  a: string;
  b: string;
}

const tidyText = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const titleOf = (r: Rec) => tidyText(r.description, 50) || "(no description)";

function pairReason(a: Rec, b: Rec, m: (c: number) => string): string {
  const sameRef = a.refNorm !== "" && a.refNorm === b.refNorm;
  const parts = [sameRef ? `They have the same reference (${tidyText(a.reference, 30)}) but do not match.` : "These two rows look like the same payment, but they do not match."];
  const diff = a.cmp - b.cmp;
  if (diff !== 0) {
    parts.push(`The first file says ${m(a.cmp)}, the second file says ${m(b.cmp)}.`);
    if (looksSwapped(a.cmp, b.cmp)) parts.push("The digits may be swapped.");
  } else {
    parts.push(`Both rows say ${m(a.cmp)}.`);
  }
  const days = a.date && b.date ? Math.abs(daysBetween(a.date, b.date)) : 0;
  if (days > 0) parts.push(`The dates are ${plural(days, "day", "days")} apart.`);
  return parts.join(" ");
}

/** The few rows worth opening first, built from the real match result. Never invented. */
export function lookFirst(match: MatchResult, names: Names, currency: string | null, limit = 5): LookItem[] {
  const m = (c: number) => formatMoney(c, currency);
  const nameOf = (r: Rec) => (r.file === "A" ? names.a : names.b);
  const sideOf = (r: Rec) => (r.file === "A" ? "first" : "second");
  const otherOf = (r: Rec) => (r.file === "A" ? "second" : "first");
  const where = (r: Rec) => `${nameOf(r)}, row ${r.row}`;
  const all: Assignment[] = [...match.onlyA, ...match.onlyB, ...match.dupA, ...match.dupB, ...match.ambA, ...match.ambB];

  const candidates: { item: LookItem; covers: string[]; own: string }[] = [];
  for (const x of all) {
    const r = x.rec;
    if (x.cls === "only") {
      const partner = x.partners.length === 1 ? x.partners[0] : undefined;
      const back = partner ? match.byId.get(partner.id) : undefined;
      const paired = partner && back?.cls === "only" && back.partners[0]?.id === r.id;
      if (partner && paired) {
        if (r.file !== "A") continue;
        candidates.push({
          own: r.id,
          covers: [partner.id],
          item: { title: titleOf(r), where: `${where(r)} and ${where(partner)}`, reason: pairReason(r, partner, m), weight: Math.max(Math.abs(r.cmp), Math.abs(partner.cmp)) },
        });
        continue;
      }
      const outside = x.note.includes("Outside the dates both files cover") ? " It also falls outside the dates both files cover." : "";
      candidates.push({
        own: r.id,
        covers: [],
        item: {
          title: titleOf(r),
          where: where(r),
          reason: `It is only in the ${sideOf(r)} file (${m(r.cmp)}). It is not in the ${otherOf(r)} file.${outside}`,
          weight: Math.abs(r.cmp),
        },
      });
    } else if (x.cls === "duplicate") {
      const twin = x.partners[0];
      candidates.push({
        own: r.id,
        covers: [],
        item: {
          title: titleOf(r),
          where: where(r),
          reason: `${m(r.cmp)}. ${twin ? `It looks like a copy of row ${twin.row} in the same file: same date, amount and wording.` : "It looks like a copy of another row."} Check whether it was entered twice.`,
          weight: Math.abs(r.cmp),
        },
      });
    } else if (x.cls === "ambiguous") {
      const rows = x.partners.slice(0, 4).map((p) => `row ${p.row}`);
      const reason =
        rows.length > 1
          ? `${m(r.cmp)}. It could match ${rows.join(" or ")} in the ${otherOf(r)} file. They fit equally well, so you decide which one.`
          : `${m(r.cmp)}. It could match ${rows[0] ?? "a row"} in the ${otherOf(r)} file, but another entry fits just as well. You decide which pair is right.`;
      candidates.push({ own: r.id, covers: x.partners.map((p) => p.id), item: { title: titleOf(r), where: where(r), reason, weight: Math.abs(r.cmp) } });
    }
  }
  candidates.sort((x, y) => y.item.weight - x.item.weight || x.own.localeCompare(y.own, "en", { numeric: true }));

  const chosen: LookItem[] = [];
  const covered = new Set<string>();
  for (const c of candidates) {
    if (chosen.length >= limit) break;
    if (covered.has(c.own)) continue;
    chosen.push(c.item);
    covered.add(c.own);
    for (const id of c.covers) covered.add(id);
  }

  if (chosen.length < limit) {
    const weak = match.pairs.filter((p) => p.how === "amount-date").sort((x, y) => Math.abs(y.a.cmp) - Math.abs(x.a.cmp) || x.a.row - y.a.row);
    for (const p of weak) {
      if (chosen.length >= limit) break;
      chosen.push({
        title: titleOf(p.a),
        where: `${where(p.a)} and ${where(p.b)}`,
        reason: `${m(p.a.cmp)}. These were matched on amount and date only. The wording is different ("${tidyText(p.b.description, 40)}"), so check they are the same payment.`,
        weight: Math.abs(p.a.cmp),
      });
    }
  }
  return chosen;
}
