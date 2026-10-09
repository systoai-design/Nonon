/**
 * The spreadsheet comparison hands over `Task.report` as procedure-specific JSON.
 * We read it defensively: find the five result classes by tolerant key names, and
 * return null when nothing recognisable is there (the panel then shows only the
 * summary, outputs and checks).
 *
 * Recognised shape (any nesting of counts/totals one level deep is accepted):
 *   { currency?: "PHP",
 *     counts: { matched, onlyInA, onlyInB, duplicates, ambiguous },        // numbers or arrays
 *     totalsCents?: { matched, onlyInA, ... , totalA, totalB, difference } // integer cents
 *   }
 * A class may also be an object: { count, totalCents }.
 */

export type ReportClassId = "matched" | "onlyA" | "onlyB" | "duplicates" | "ambiguous";

export interface ReportClass {
  id: ReportClassId;
  label: string;
  count: number;
  cents: number | null;
}

export interface ReportView {
  classes: ReportClass[];
  currency?: string;
  totals: { label: string; cents: number }[];
}

const CLASS_LABELS: Record<ReportClassId, string> = {
  matched: "Matched",
  onlyA: "Only in file A",
  onlyB: "Only in file B",
  duplicates: "Listed twice",
  ambiguous: "Not sure which",
};

const ALIASES: Record<ReportClassId, string[]> = {
  matched: ["matched", "matches", "match", "matchedcount"],
  onlyA: ["onlyina", "onlya", "unmatcheda", "unmatchedina", "missinginb", "aonly", "onlyleft", "unmatchedleft"],
  onlyB: ["onlyinb", "onlyb", "unmatchedb", "unmatchedinb", "missingina", "bonly", "onlyright", "unmatchedright"],
  duplicates: ["duplicates", "duplicate", "dupes", "duplicaterows"],
  ambiguous: ["ambiguous", "ambiguousmatches", "unclear", "needsreview"],
};

const TOTAL_LABELS: { keys: string[]; label: string }[] = [
  { keys: ["totalacents", "totalinacents", "sumacents", "atotalcents"], label: "Total in file A" },
  { keys: ["totalbcents", "totalinbcents", "sumbcents", "btotalcents"], label: "Total in file B" },
  { keys: ["differencecents", "diffcents", "differenceincents", "gapcents"], label: "Difference" },
];

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function flatten(obj: Record<string, unknown>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  const visit = (o: Record<string, unknown>, depth: number) => {
    for (const [k, v] of Object.entries(o)) {
      const nk = norm(k);
      if (!map.has(nk)) map.set(nk, v);
      if (depth < 1 && isObj(v)) visit(v, depth + 1);
    }
  };
  visit(obj, 0);
  return map;
}

function countOf(v: unknown): number | null {
  if (isNum(v)) return Math.max(0, Math.round(v));
  if (Array.isArray(v)) return v.length;
  if (isObj(v)) {
    for (const key of ["count", "n", "rows", "items", "records"]) {
      const inner = v[key];
      if (isNum(inner)) return Math.max(0, Math.round(inner));
      if (Array.isArray(inner)) return inner.length;
    }
  }
  return null;
}

function centsOf(v: unknown): number | null {
  if (!isObj(v)) return null;
  for (const key of ["totalCents", "cents", "amountCents", "sumCents"]) {
    const inner = v[key];
    if (isNum(inner)) return Math.round(inner);
  }
  return null;
}

export function readReport(report: unknown): ReportView | null {
  if (!isObj(report)) return null;
  const flat = flatten(report);

  const totalsSrc = ["totalscents", "totalcents", "amountscents", "totals"]
    .map((k) => flat.get(k))
    .find(isObj);
  const totalsFlat = totalsSrc ? flatten(totalsSrc) : new Map<string, unknown>();

  const classes: ReportClass[] = [];
  for (const id of Object.keys(ALIASES) as ReportClassId[]) {
    const raw = ALIASES[id].map((a) => flat.get(a)).find((v) => v !== undefined);
    const count = countOf(raw);
    if (count === null) continue;
    const fromTotals = ALIASES[id].map((a) => totalsFlat.get(a)).find(isNum);
    classes.push({ id, label: CLASS_LABELS[id], count, cents: centsOf(raw) ?? (fromTotals !== undefined ? Math.round(fromTotals) : null) });
  }
  if (classes.length === 0) return null;

  const totals: ReportView["totals"] = [];
  for (const t of TOTAL_LABELS) {
    const v = [...totalsFlat, ...flat].find(([k, val]) => t.keys.includes(k) && isNum(val))?.[1];
    if (isNum(v)) totals.push({ label: t.label, cents: Math.round(v) });
  }

  const currency = typeof flat.get("currency") === "string" ? (flat.get("currency") as string) : undefined;
  return { classes, currency, totals };
}
