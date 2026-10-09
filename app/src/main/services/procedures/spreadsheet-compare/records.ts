import type { Check } from "../../../../shared/contracts";
import { cellDate } from "./dates";
import { moneyFromNumber, parseMoney, type ParsedMoney } from "./money";
import type { Cell, DateOrder, FileLabel, Mapping, ReadTable, Rec, SkippedRow } from "./types";

const STOP = new Set([
  "pos", "purchase", "payment", "pmt", "debit", "credit", "card", "online", "transfer", "the", "of", "and", "for", "to", "from",
  "ref", "txn", "via", "inc", "co", "no",
]);

export function tokensOf(text: string): string[] {
  const words = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const meaningful = words.filter((w) => !STOP.has(w) && !/^\d{4,}$/.test(w));
  return meaningful.length ? meaningful : words;
}

export function normRef(raw: string): string {
  const n = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (n.length < 3 || /^0+$/.test(n) || ["NA", "NONE", "NULL", "NIL", "UNKNOWN"].includes(n)) return "";
  return n;
}

const PLACEHOLDER = new Set(["-", "—", "–", "n/a", "na"]);

function cellMoney(c: Cell): ParsedMoney | null {
  if (c.formulaMissing) return null;
  if (c.n !== undefined) return moneyFromNumber(c.n);
  const t = c.t.trim();
  if (!t || c.d || PLACEHOLDER.has(t.toLowerCase())) return null;
  return parseMoney(t);
}

const SUMMARY_ROW = /^\s*(grand\s+|sub\s*)?totals?\b|^\s*(opening|closing|beginning|ending|running)?\s*balance\b|^\s*carried forward|^\s*brought forward/i;

export interface BuildOutput {
  records: Rec[];
  skipped: SkippedRow[];
  currencies: Set<string>;
  fractionalAmounts: number;
  missingDates: number;
  formulaGaps: number;
}

export function buildRecords(table: ReadTable, mapping: Mapping, order: DateOrder, file: FileLabel): BuildOutput {
  const records: Rec[] = [];
  const skipped: SkippedRow[] = [];
  const currencies = new Set<string>();
  let fractionalAmounts = 0;
  let missingDates = 0;
  let formulaGaps = 0;
  const split = mapping.amount === null;

  for (const r of table.rows) {
    const raw = r.cells.map((c) => c.t);
    const cell = (i: number | null): Cell => (i === null ? { t: "" } : (r.cells[i] ?? { t: "" }));
    const dateCell = cell(mapping.date);
    const descCell = cell(mapping.description);
    const refCell = cell(mapping.reference);

    const mappedCells = [dateCell, descCell, refCell, cell(mapping.amount), cell(mapping.debit), cell(mapping.credit)];
    const gap = mappedCells.some((c) => c.formulaMissing);
    if (gap) formulaGaps++;

    let money: ParsedMoney | null = null;
    let amountRaw = "";
    if (!split) {
      const c = cell(mapping.amount);
      money = cellMoney(c);
      amountRaw = c.t;
    } else {
      const d = cellMoney(cell(mapping.debit));
      const cr = cellMoney(cell(mapping.credit));
      amountRaw = [cell(mapping.debit).t, cell(mapping.credit).t].filter((x) => x.trim()).join(" / ");
      if (d || cr) {
        money = {
          cents: (cr ? Math.abs(cr.cents) : 0) - (d ? Math.abs(d.cents) : 0),
          currency: d?.currency ?? cr?.currency ?? null,
          fractional: Boolean(d?.fractional || cr?.fractional),
        };
      }
    }

    const description = descCell.t.trim();
    const date = cellDate(dateCell, order);
    const summaryLike = !date && (SUMMARY_ROW.test(description) || raw.some((x) => SUMMARY_ROW.test(x)));
    if (!money || summaryLike) {
      skipped.push({
        file,
        row: r.row,
        reason: summaryLike
          ? "Looks like a total or balance line, not an entry"
          : gap
            ? "A formula here has no saved result, so the amount is missing"
            : amountRaw.trim()
              ? `The amount "${amountRaw.trim().slice(0, 30)}" could not be read as a number`
              : "No amount",
        rawCells: raw,
      });
      continue;
    }
    if (!date) missingDates++;
    if (money.currency) currencies.add(money.currency);
    if (money.fractional) fractionalAmounts++;
    const reference = refCell.t.trim();
    records.push({
      id: `${file}:${r.row}`,
      file,
      row: r.row,
      date,
      dateRaw: dateCell.t,
      cents: money.cents,
      cmp: money.cents,
      amountRaw,
      description,
      descTokens: tokensOf(description),
      descNorm: tokensOf(description).join(" "),
      reference,
      refNorm: normRef(reference),
      rawCells: raw,
    });
  }
  return { records, skipped, currencies, fractionalAmounts, missingDates, formulaGaps };
}

export type SignRule = "same" | "opposite" | "ignore";

/** Applies the sign rule. `opposite` flips file B so an expense sheet (+) lines up with a bank debit (-). */
export function applySignRule(a: Rec[], b: Rec[], rule: SignRule): void {
  for (const r of a) r.cmp = rule === "ignore" ? Math.abs(r.cents) : r.cents;
  for (const r of b) r.cmp = rule === "ignore" ? Math.abs(r.cents) : rule === "opposite" ? -r.cents : r.cents;
}

export function negativeShare(recs: Rec[]): number {
  if (!recs.length) return 0;
  return recs.filter((r) => r.cents < 0).length / recs.length;
}

/** True when one file writes outflows as positive and the other as negative. */
export function signsDiffer(a: Rec[], b: Rec[]): boolean {
  if (!a.length || !b.length) return false;
  const na = negativeShare(a);
  const nb = negativeShare(b);
  return (na < 0.1 && nb > 0.6) || (nb < 0.1 && na > 0.6);
}

export function skippedChecks(label: FileLabel, name: string, skipped: SkippedRow[]): Check[] {
  if (!skipped.length) return [];
  const rows = skipped.slice(0, 8).map((s) => s.row).join(", ");
  return [
    {
      id: `skipped-rows-${label.toLowerCase()}`,
      label: `${skipped.length} row(s) in "${name}" were left out`,
      status: "warn",
      detail: `Rows ${rows}${skipped.length > 8 ? " and more" : ""} could not be used as entries. You can see them on the "Skipped rows" sheet.`,
    },
  ];
}
