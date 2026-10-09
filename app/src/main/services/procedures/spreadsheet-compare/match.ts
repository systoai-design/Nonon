import { daysBetween } from "./dates";
import { formatMoney } from "./money";
import type { Assignment, MatchHow, MatchResult, Pair, Rec, Rules } from "./types";

/** Scores closer than this are a tie: NONON will not pick a winner, a person should. */
const EPS = 0.01;

export function descSimilarity(a: Rec, b: Rec): number {
  if (!a.descNorm || !b.descNorm) return 0.5;
  if (a.descNorm === b.descNorm) return 1;
  const ta = new Set(a.descTokens);
  const tb = new Set(b.descTokens);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jac = inter / (ta.size + tb.size - inter || 1);
  const contain = inter / Math.min(ta.size, tb.size || 1);
  const dice = trigramDice(a.descNorm, b.descNorm);
  return Math.max(0.5 * jac + 0.5 * dice, 0.9 * contain);
}

function trigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const p = `  ${s} `;
  for (let i = 0; i < p.length - 2; i++) {
    const g = p.slice(i, i + 3);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function trigramDice(a: string, b: string): number {
  const ga = trigrams(a);
  const gb = trigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of ga) {
    total += n;
    inter += Math.min(n, gb.get(g) ?? 0);
  }
  for (const n of gb.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

function twinKey(r: Rec): string {
  return `${r.date ?? ""}|${r.cmp}|${r.descNorm}|${r.refNorm}`;
}

interface Node {
  id: number;
  file: "A" | "B";
  members: Rec[];
}

interface Edge {
  a: Node;
  b: Node;
  score: number;
  sim: number;
  dateDiff: number | null;
  amountDiff: number;
}

function dateDiffOf(a: Rec, b: Rec): number | null {
  return a.date && b.date ? Math.abs(daysBetween(a.date, b.date)) : null;
}

function edgeFor(a: Node, b: Node, rules: Rules): Edge | null {
  const ra = a.members[0] as Rec;
  const rb = b.members[0] as Rec;
  const amountDiff = Math.abs(ra.cmp - rb.cmp);
  if (amountDiff > rules.amountTolCents) return null;
  const dd = dateDiffOf(ra, rb);
  if (dd === null || dd > rules.dateTolDays) return null;
  const sim = descSimilarity(ra, rb);
  if (sim < 0.2 && (dd > 0 || amountDiff > 0)) return null;
  const refClash = ra.refNorm && rb.refNorm && ra.refNorm !== rb.refNorm ? 0.25 : 0;
  const dateScore = 1 - dd / (rules.dateTolDays + 1);
  const amtScore = 1 - amountDiff / (rules.amountTolCents + 1);
  const score = 0.45 * sim + 0.35 * dateScore + 0.2 * amtScore - refClash;
  return { a, b, score, sim, dateDiff: dd, amountDiff };
}

function lowerBound(sorted: Rec[], cmp: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as Rec).cmp < cmp) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function compareRecords(recsA: Rec[], recsB: Rec[], rules: Rules): MatchResult {
  const byId = new Map<string, Assignment>();
  const pairs: Pair[] = [];
  const used = new Set<string>();

  const setMatched = (a: Rec, b: Rec, how: MatchHow, edge?: Edge) => {
    const id = pairs.length + 1;
    const dateDiffDays = edge ? edge.dateDiff : dateDiffOf(a, b);
    const amountDiffCents = a.cmp - b.cmp;
    const notes: string[] = [];
    if (how === "reference" && dateDiffDays !== null && dateDiffDays > rules.dateTolDays) {
      notes.push(`Dates are ${dateDiffDays} days apart`);
    }
    if (amountDiffCents !== 0) notes.push(`Amounts differ by ${formatMoney(Math.abs(amountDiffCents))} (within the difference you allowed)`);
    if (how === "amount-date") notes.push("Matched on amount and date only. The wording is different");
    pairs.push({ id, a, b, how, dateDiffDays, amountDiffCents, note: notes.join(". ") });
    byId.set(a.id, { rec: a, cls: "matched", partners: [b], how, pairId: id, note: notes.join(". ") });
    byId.set(b.id, { rec: b, cls: "matched", partners: [a], how, pairId: id, note: notes.join(". ") });
    used.add(a.id);
    used.add(b.id);
  };

  // Stage 1: a reference that appears exactly once on each side is the strongest evidence there is.
  const refMap = (recs: Rec[]) => {
    const m = new Map<string, Rec[]>();
    for (const r of recs) if (r.refNorm) m.set(r.refNorm, [...(m.get(r.refNorm) ?? []), r]);
    return m;
  };
  const refsA = refMap(recsA);
  const refsB = refMap(recsB);
  for (const [ref, as] of refsA) {
    const bs = refsB.get(ref);
    if (!bs || as.length !== 1 || bs.length !== 1) continue;
    const a = as[0] as Rec;
    const b = bs[0] as Rec;
    if (Math.abs(a.cmp - b.cmp) > rules.amountTolCents) continue;
    setMatched(a, b, "reference");
  }

  // Stage 2: group identical records so repeated entries are counted, not guessed at.
  let nodeId = 0;
  const makeNodes = (recs: Rec[], file: "A" | "B") => {
    const groups = new Map<string, Rec[]>();
    for (const r of recs) {
      if (used.has(r.id)) continue;
      const k = twinKey(r);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return [...groups.values()].map((members): Node => ({ id: nodeId++, file, members: members.sort((x, y) => x.row - y.row) }));
  };
  const nodesA = makeNodes(recsA, "A");
  const nodesB = makeNodes(recsB, "B");

  const sortedB = nodesB.map((n) => n.members[0] as Rec).sort((x, y) => x.cmp - y.cmp);
  const nodeOf = new Map<string, Node>();
  for (const n of nodesB) nodeOf.set((n.members[0] as Rec).id, n);

  const edgesOf = new Map<number, Edge[]>();
  const push = (n: Node, e: Edge) => {
    const list = edgesOf.get(n.id);
    if (list) list.push(e);
    else edgesOf.set(n.id, [e]);
  };
  for (const na of nodesA) {
    const ra = na.members[0] as Rec;
    for (let i = lowerBound(sortedB, ra.cmp - rules.amountTolCents); i < sortedB.length; i++) {
      const rb = sortedB[i] as Rec;
      if (rb.cmp > ra.cmp + rules.amountTolCents) break;
      const nb = nodeOf.get(rb.id) as Node;
      const e = edgeFor(na, nb, rules);
      if (e) {
        push(na, e);
        push(nb, e);
      }
    }
  }

  const done = new Set<number>();
  const live = (n: Node) => !done.has(n.id);
  const topOf = (n: Node): { edge: Edge; unique: boolean } | null => {
    const list = (edgesOf.get(n.id) ?? []).filter((e) => live(e.a) && live(e.b)).sort((x, y) => y.score - x.score);
    const first = list[0];
    if (!first) return null;
    const second = list[1];
    return { edge: first, unique: !second || first.score - second.score > EPS };
  };

  for (let progress = true; progress; ) {
    progress = false;
    const chosen: Edge[] = [];
    for (const na of nodesA) {
      if (!live(na)) continue;
      const ta = topOf(na);
      if (!ta || !ta.unique) continue;
      const tb = topOf(ta.edge.b);
      if (tb && tb.unique && tb.edge === ta.edge) chosen.push(ta.edge);
    }
    for (const e of chosen) {
      const k = Math.min(e.a.members.length, e.b.members.length);
      for (let i = 0; i < k; i++) {
        const how: MatchHow = e.sim >= 0.35 || !(e.a.members[0] as Rec).descNorm || !(e.b.members[0] as Rec).descNorm ? "amount-date-description" : "amount-date";
        setMatched(e.a.members[i] as Rec, e.b.members[i] as Rec, how, e);
      }
      const leftoverA = e.a.members.slice(k);
      const leftoverB = e.b.members.slice(k);
      for (const r of leftoverA) markDuplicate(r, e.a.members[0] as Rec);
      for (const r of leftoverB) markDuplicate(r, e.b.members[0] as Rec);
      done.add(e.a.id);
      done.add(e.b.id);
      progress = true;
    }
  }

  function markDuplicate(r: Rec, twin: Rec) {
    byId.set(r.id, { rec: r, cls: "duplicate", partners: [twin], note: `Same as ${r.file} row ${twin.row} (same date, amount and description)` });
    used.add(r.id);
  }

  // What is left is either unmatched or tied. A node with live candidates cannot be decided by code.
  for (const n of [...nodesA, ...nodesB]) {
    if (!live(n)) continue;
    const cands = (edgesOf.get(n.id) ?? []).filter((e) => live(e.a) && live(e.b));
    if (cands.length) {
      const partners = cands.flatMap((e) => (n.file === "A" ? e.b.members : e.a.members));
      const seen = new Set<string>();
      const uniq = partners.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
      const other = n.file === "A" ? "B" : "A";
      const note =
        uniq.length > 1
          ? `Could match ${other} ${uniq.map((p) => `row ${p.row}`).slice(0, 4).join(" or ")}. They fit equally well, so you decide which one.`
          : `Could match ${other} row ${uniq[0]?.row}, but another entry fits that row just as well. You decide which pair is right.`;
      for (const r of n.members) byId.set(r.id, { rec: r, cls: "ambiguous", partners: uniq, note });
      continue;
    }
    const [first, ...rest] = n.members;
    if (first) byId.set(first.id, { rec: first, cls: "only", partners: [], note: "" });
    for (const r of rest) markDuplicate(r, first as Rec);
  }

  noteNearMisses(recsA, recsB, byId, rules);

  const pick = (file: "A" | "B", cls: Assignment["cls"]) =>
    (file === "A" ? recsA : recsB).map((r) => byId.get(r.id) as Assignment).filter((x) => x.cls === cls);
  return {
    pairs,
    onlyA: pick("A", "only"),
    onlyB: pick("B", "only"),
    dupA: pick("A", "duplicate"),
    dupB: pick("B", "duplicate"),
    ambA: pick("A", "ambiguous"),
    ambB: pick("B", "ambiguous"),
    byId,
  };
}

const NEAR_MISS_PAIR_CAP = 400_000;

/** For unmatched rows, point at a likely counterpart that differs in amount or date: a typo is the usual cause. */
function noteNearMisses(recsA: Rec[], recsB: Rec[], byId: Map<string, Assignment>, rules: Rules) {
  const onlyA = recsA.map((r) => byId.get(r.id) as Assignment).filter((x) => x.cls === "only");
  const onlyB = recsB.map((r) => byId.get(r.id) as Assignment).filter((x) => x.cls === "only");
  if (!onlyA.length || !onlyB.length || onlyA.length * onlyB.length > NEAR_MISS_PAIR_CAP) return;
  const describe = (x: Rec, y: Rec): string => {
    const parts: string[] = [];
    const d = x.cmp - y.cmp;
    if (d !== 0) parts.push(`amount differs by ${formatMoney(Math.abs(d))}`);
    const dd = dateDiffOf(x, y);
    if (dd !== null && dd > 0) parts.push(`date differs by ${dd} day${dd === 1 ? "" : "s"}`);
    return `${y.file} row ${y.row}${parts.length ? " (" + parts.join(", ") + ")" : ""}`;
  };
  for (const a of onlyA) {
    for (const b of onlyB) {
      if (a.rec.refNorm && a.rec.refNorm === b.rec.refNorm) {
        a.note = `Same reference as B row ${b.rec.row} but ${describeDiff(a.rec, b.rec)}`;
        b.note = `Same reference as A row ${a.rec.row} but ${describeDiff(b.rec, a.rec)}`;
        a.partners = [b.rec];
        b.partners = [a.rec];
        break;
      }
    }
  }
  for (const a of onlyA) {
    if (a.note) continue;
    const near = onlyB.filter((b) => {
      if (b.note) return false;
      const dd = dateDiffOf(a.rec, b.rec);
      if (dd === null) return false;
      const sim = descSimilarity(a.rec, b.rec);
      const diff = Math.abs(a.rec.cmp - b.rec.cmp);
      // Same amount, a few weeks apart: usually a late posting. Close dates, similar wording, near amount: usually a typo.
      if (diff <= rules.amountTolCents) return dd <= 31 && sim >= 0.3;
      return dd <= rules.dateTolDays && sim >= 0.6 && diff <= 0.5 * Math.max(Math.abs(a.rec.cmp), Math.abs(b.rec.cmp));
    });
    if (near.length === 1) {
      const b = near[0] as Assignment;
      a.note = `Possible match: ${describe(a.rec, b.rec)}`;
      b.note = `Possible match: ${describe(b.rec, a.rec)}`;
      a.partners = [b.rec];
      b.partners = [a.rec];
    }
  }
}

function describeDiff(x: Rec, y: Rec): string {
  const parts: string[] = [];
  const d = x.cmp - y.cmp;
  if (d !== 0) parts.push(`the amount differs by ${formatMoney(Math.abs(d))}`);
  const dd = dateDiffOf(x, y);
  if (dd !== null && dd > 0) parts.push(`the date differs by ${dd} day${dd === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" and ") : "it was not matched for another reason";
}
