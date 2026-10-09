import type { Check } from "../../../../shared/contracts";
import { formatMoney } from "./money";
import type { Assignment, MatchResult, Rec } from "./types";

export interface Bucket {
  count: number;
  /** Integer cents on the comparison amount. */
  cents: number;
}

export interface EffectRow {
  key: "matched" | "onlyA" | "onlyB" | "dupA" | "dupB" | "ambiguous";
  label: string;
  a: Bucket;
  b: Bucket;
  /** This group's contribution to (total A - total B). */
  effect: number;
}

export interface Totals {
  totalA: Bucket;
  totalB: Bucket;
  /** Amounts exactly as written in each file (before any sign rule). */
  writtenA: number;
  writtenB: number;
  matched: { pairs: number; a: Bucket; b: Bucket };
  onlyA: Bucket;
  onlyB: Bucket;
  dupA: Bucket;
  dupB: Bucket;
  ambA: Bucket;
  ambB: Bucket;
  difference: number;
  rows: EffectRow[];
}

function sum(recs: Rec[]): Bucket {
  let cents = 0;
  for (const r of recs) cents += r.cmp;
  return { count: recs.length, cents };
}

const recs = (xs: Assignment[]) => xs.map((x) => x.rec);

export function computeTotals(a: Rec[], b: Rec[], m: MatchResult): Totals {
  const matchedA = sum(m.pairs.map((p) => p.a));
  const matchedB = sum(m.pairs.map((p) => p.b));
  const t = {
    totalA: sum(a),
    totalB: sum(b),
    writtenA: a.reduce((s, r) => s + r.cents, 0),
    writtenB: b.reduce((s, r) => s + r.cents, 0),
    matched: { pairs: m.pairs.length, a: matchedA, b: matchedB },
    onlyA: sum(recs(m.onlyA)),
    onlyB: sum(recs(m.onlyB)),
    dupA: sum(recs(m.dupA)),
    dupB: sum(recs(m.dupB)),
    ambA: sum(recs(m.ambA)),
    ambB: sum(recs(m.ambB)),
  };
  const zero: Bucket = { count: 0, cents: 0 };
  const rows: EffectRow[] = [
    { key: "matched", label: "Matched pairs", a: matchedA, b: matchedB, effect: matchedA.cents - matchedB.cents },
    { key: "onlyA", label: "Only in A", a: t.onlyA, b: zero, effect: t.onlyA.cents },
    { key: "onlyB", label: "Only in B", a: zero, b: t.onlyB, effect: -t.onlyB.cents },
    { key: "dupA", label: "Listed twice in A", a: t.dupA, b: zero, effect: t.dupA.cents },
    { key: "dupB", label: "Listed twice in B", a: zero, b: t.dupB, effect: -t.dupB.cents },
    { key: "ambiguous", label: "Not sure which row matches", a: t.ambA, b: t.ambB, effect: t.ambA.cents - t.ambB.cents },
  ];
  return { ...t, difference: t.totalA.cents - t.totalB.cents, rows };
}

/** Every record of both files is in exactly one class, and the class sums explain the difference exactly. */
export function accountingChecks(a: Rec[], b: Rec[], m: MatchResult, t: Totals): Check[] {
  const checks: Check[] = [];
  const total = a.length + b.length;
  const counted =
    t.matched.pairs * 2 + t.onlyA.count + t.onlyB.count + t.dupA.count + t.dupB.count + t.ambA.count + t.ambB.count;
  const seen = new Set<string>();
  let dupSeen = 0;
  for (const x of [...m.pairs.flatMap((p) => [p.a, p.b]), ...recs([...m.onlyA, ...m.onlyB, ...m.dupA, ...m.dupB, ...m.ambA, ...m.ambB])]) {
    if (seen.has(x.id)) dupSeen++;
    seen.add(x.id);
  }
  const missing = [...a, ...b].filter((r) => !seen.has(r.id)).length;
  const ok = counted === total && dupSeen === 0 && missing === 0 && m.byId.size === total;
  checks.push({
    id: "account-for-every-record",
    label: "Every row from both files is accounted for",
    status: ok ? "pass" : "fail",
    detail: ok
      ? `All ${total} rows are accounted for: ${t.matched.pairs} matched pair${t.matched.pairs === 1 ? "" : "s"}, ${t.onlyA.count + t.onlyB.count} only in one file, ${t.dupA.count + t.dupB.count} listed twice, ${t.ambA.count + t.ambB.count} not sure which row matches.`
      : `${total} rows went in, but ${counted} were placed (${missing} missing, ${dupSeen} counted twice). Please do not rely on these results.`,
  });

  const explained = t.rows.reduce((s, r) => s + r.effect, 0);
  checks.push({
    id: "difference-explained",
    label: "The difference between the two totals is fully explained",
    status: explained === t.difference ? "pass" : "fail",
    detail: `File A's total minus file B's total is ${formatMoney(t.difference)}. The groups above add up to ${formatMoney(explained)}. NONON adds up every amount itself, so these are exact.`,
  });
  return checks;
}
