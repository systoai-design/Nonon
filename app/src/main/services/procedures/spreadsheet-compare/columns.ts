import type { Question } from "../../../../shared/contracts";
import { classifyCell } from "./dates";
import { moneyFromNumber, parseMoney } from "./money";
import type { Cell, FieldKey, Mapping, ReadTable } from "./types";

export const NONE = "__none__";
/** At or above this a mapping is accepted without asking. */
export const CONFIDENT = 0.85;
/** Below this a column is not even offered as a suggestion. */
export const MIN_CANDIDATE = 0.3;

const EXACT: Record<FieldKey, string[]> = {
  date: ["date", "transaction date", "posting date", "posted date", "value date", "txn date"],
  description: ["description", "memo", "narration", "particulars", "transaction description"],
  reference: ["reference", "reference number", "reference no", "ref no", "ref", "check number", "check no", "cheque no", "receipt no", "or no", "invoice no"],
  amount: ["amount"],
  debit: ["debit", "debits", "withdrawal", "withdrawals"],
  credit: ["credit", "credits", "deposit", "deposits"],
};

const ALIAS: Record<FieldKey, string[]> = {
  date: ["dt", "txn dt", "trans date", "trans dt", "day", "when", "posted", "booking date", "tran date", "date posted", "entry date", "dated"],
  description: ["details", "detail", "desc", "payee", "vendor", "merchant", "name", "particular", "remarks", "note", "notes", "item", "narrative", "transaction details", "supplier", "paid to"],
  reference: ["ref #", "txn id", "transaction id", "id", "number", "no", "doc no", "voucher", "voucher no", "trace", "confirmation", "or number", "receipt", "invoice", "check", "cheque", "ref number", "txn ref", "trace no"],
  amount: ["amt", "total", "value", "sum", "price", "net", "gross", "php", "php amount", "amount php", "transaction amount", "cost"],
  debit: ["dr", "money out", "paid out", "out", "expense", "expenses", "payments", "payment", "charge"],
  credit: ["cr", "money in", "paid in", "in", "income", "receipts", "received"],
};

const KEYWORD: Record<FieldKey, string> = {
  date: "date", description: "description", reference: "reference", amount: "amount", debit: "debit", credit: "credit",
};

export function normHeader(h: string): string {
  return h
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();
}

export function headerScore(field: FieldKey, header: string): number {
  const n = normHeader(header);
  if (!n) return 0;
  if (/\b(balance|running|available)\b/.test(n) && (field === "amount" || field === "debit" || field === "credit")) return 0;
  if (EXACT[field].includes(n)) return 1;
  if (ALIAS[field].includes(n)) return 0.6;
  if (n.split(" ").includes(KEYWORD[field])) return 0.55;
  return 0;
}

export interface ColumnProfile {
  index: number;
  header: string;
  nonEmpty: number;
  money: number;
  dateLike: number;
  text: number;
  avgLen: number;
  distinct: number;
  /** Share of money values that have decimals, thousands commas, a currency or a sign. */
  decimalFrac: number;
  idLike: boolean;
  refLike: number;
  sample: string;
}

function moneyOf(c: Cell) {
  if (c.formulaMissing) return null;
  if (c.n !== undefined) return moneyFromNumber(c.n);
  const t = c.t.trim();
  if (!t || c.d) return null;
  return parseMoney(t);
}

export function profileColumns(table: ReadTable): ColumnProfile[] {
  const out: ColumnProfile[] = [];
  for (let i = 0; i < table.columnCount; i++) {
    let nonEmpty = 0, money = 0, dateLike = 0, text = 0, lenSum = 0, decimals = 0, idDigits = 0, refLike = 0;
    const seen = new Set<string>();
    let sample = "";
    for (const r of table.rows) {
      const c = r.cells[i] as Cell;
      const t = c.t.trim();
      if (!t && !c.d && c.n === undefined) continue;
      nonEmpty++;
      if (!sample) sample = t;
      seen.add(t);
      lenSum += t.length;
      if (classifyCell(c)) dateLike++;
      const m = moneyOf(c);
      if (m) {
        money++;
        if (/[.,₱$()\-]|php/i.test(t) || (c.n !== undefined && !Number.isInteger(c.n))) decimals++;
        if (/^\d{5,}$/.test(t)) idDigits++;
      } else if (!classifyCell(c)) text++;
      if (/^[A-Za-z0-9#\-_/.]{3,25}$/.test(t) && /\d/.test(t)) refLike++;
    }
    out.push({
      index: i,
      header: table.headers[i] ?? "",
      nonEmpty,
      money,
      dateLike,
      text,
      avgLen: nonEmpty ? lenSum / nonEmpty : 0,
      distinct: seen.size,
      decimalFrac: money ? decimals / money : 0,
      idLike: money > 0 && idDigits / money > 0.8,
      refLike,
      sample,
    });
  }
  return out;
}

export function shapeScore(field: FieldKey, p: ColumnProfile): number {
  if (p.nonEmpty === 0) return 0;
  switch (field) {
    case "date":
      return p.dateLike / p.nonEmpty;
    case "amount":
    case "debit":
    case "credit": {
      if (p.idLike) return 0.1;
      return (p.money / p.nonEmpty) * (0.7 + 0.3 * p.decimalFrac);
    }
    case "description": {
      const textFrac = p.text / p.nonEmpty;
      return textFrac * Math.min(1, p.avgLen / 5);
    }
    case "reference": {
      const f = p.refLike / p.nonEmpty;
      return f * (p.distinct / p.nonEmpty > 0.8 ? 1 : 0.85);
    }
  }
}

export function columnConfidence(field: FieldKey, p: ColumnProfile): number {
  const shape = shapeScore(field, p);
  const hdr = headerScore(field, p.header);
  const moneyField = field === "amount" || field === "debit" || field === "credit";
  if (moneyField && /(balance|running|available)/.test(normHeader(p.header))) return 0;
  if ((field === "date" || field === "amount" || field === "debit" || field === "credit") && shape < 0.5) {
    return Math.min(0.2, 0.6 * hdr + 0.4 * shape);
  }
  return 0.6 * hdr + 0.4 * shape;
}

export interface FieldChoice {
  col: number | null;
  conf: number;
  /** Header-and-values agreement is strong and no rival column is close. */
  confident: boolean;
  /** The user picked this column, so no question is needed. */
  answered: boolean;
}

export interface ProposedMapping {
  amountMode: "single" | "split";
  fields: Partial<Record<FieldKey, FieldChoice>>;
}

export interface AiHints {
  hints: Partial<Record<FieldKey, number>>;
}

function best(field: FieldKey, profiles: ColumnProfile[], used: Set<number>) {
  const scored = profiles
    .filter((p) => !used.has(p.index))
    .map((p) => ({ index: p.index, conf: columnConfidence(field, p) }))
    .sort((a, b) => b.conf - a.conf || a.index - b.index);
  return { top: scored[0], second: scored[1] };
}

function pickAnswer(answers: Record<string, string>, id: string, headers: string[], optional: boolean): number | null | undefined {
  const v = answers[id];
  if (v === undefined) return undefined;
  if (optional && v === NONE) return null;
  const idx = headers.findIndex((h, i) => headerKey(h, i, headers) === v);
  return idx >= 0 ? idx : undefined;
}

/** Stable answer value for a header: the text itself, with the column number added only if two headers match. */
export function headerKey(h: string, i: number, headers: string[]): string {
  const dup = headers.some((x, j) => j !== i && x === h);
  return dup ? `${h} (column ${i + 1})` : h;
}

/**
 * Proposes a column for each field from header names AND value shapes. User answers (id
 * `<prefix>.<field>`) win; model hints are used only where the code is unsure and the values fit.
 */
export function proposeMapping(
  table: ReadTable,
  profiles: ColumnProfile[],
  answers: Record<string, string>,
  prefix: string,
  ai?: AiHints,
): ProposedMapping {
  const used = new Set<number>();
  const fields: Partial<Record<FieldKey, FieldChoice>> = {};
  const answered: Partial<Record<FieldKey, number | null>> = {};
  const optionalField = (f: FieldKey) => f === "description" || f === "reference";

  for (const f of ["date", "amount", "debit", "credit", "description", "reference"] as FieldKey[]) {
    const a = pickAnswer(answers, `${prefix}.${f}`, table.headers, optionalField(f));
    if (a !== undefined) {
      answered[f] = a;
      if (a !== null) used.add(a);
    }
  }

  const decide = (field: FieldKey): FieldChoice => {
    const a = answered[field];
    if (a !== undefined) return { col: a, conf: 1, confident: true, answered: true };
    const { top, second } = best(field, profiles, used);
    let col = top && top.conf >= MIN_CANDIDATE ? top.index : null;
    let conf = top && col !== null ? top.conf : 0;
    const hint = ai?.hints[field];
    if (hint !== undefined && !used.has(hint) && conf < 0.6) {
      const p = profiles[hint];
      if (p && shapeScore(field, p) >= 0.5) {
        col = hint;
        conf = 0.6;
      }
    }
    // A reference column with no header hint is too easy to confuse with any short code.
    if (field === "reference" && col !== null && headerScore(field, table.headers[col] ?? "") === 0 && conf < 0.6) {
      col = null;
      conf = 0;
    }
    const rival = second && col !== null && second.index !== col ? second.conf : 0;
    const confident = col !== null && conf >= CONFIDENT && conf - rival >= 0.2;
    if (col !== null) used.add(col);
    return { col, conf, confident, answered: false };
  };

  const date = decide("date");

  let mode: "single" | "split";
  if (answered.amount !== undefined && answered.amount !== null) mode = "single";
  else if ((answered.debit ?? null) !== null || (answered.credit ?? null) !== null) mode = "split";
  else {
    const free = (f: FieldKey) => best(f, profiles, used).top;
    const amt = free("amount");
    const deb = free("debit");
    const cred = free("credit");
    const dc = deb && cred && deb.index !== cred.index ? Math.min(deb.conf, cred.conf) : 0;
    mode = dc >= MIN_CANDIDATE && dc > (amt?.conf ?? 0) ? "split" : "single";
  }

  fields.date = date;
  if (mode === "single") {
    let amount = decide("amount");
    if (amount.col === null) {
      // A lone debit-only or credit-only column is still the amount column.
      const only = best("debit", profiles, used).top;
      const other = best("credit", profiles, used).top;
      const pick = (only?.conf ?? 0) >= (other?.conf ?? 0) ? only : other;
      if (pick && pick.conf >= MIN_CANDIDATE) {
        used.add(pick.index);
        amount = { col: pick.index, conf: Math.min(pick.conf, 0.6), confident: false, answered: false };
      }
    }
    fields.amount = amount;
  } else {
    fields.debit = decide("debit");
    fields.credit = decide("credit");
  }
  fields.reference = decide("reference");
  fields.description = decide("description");
  return { amountMode: mode, fields };
}

export function toMapping(p: ProposedMapping): Mapping | null {
  const f = p.fields;
  const date = f.date?.col;
  if (date === null || date === undefined) return null;
  const m: Mapping = {
    date,
    description: f.description?.col ?? null,
    reference: f.reference?.col ?? null,
    amount: f.amount?.col ?? null,
    debit: f.debit?.col ?? null,
    credit: f.credit?.col ?? null,
  };
  const hasAmount = m.amount !== null || m.debit !== null || m.credit !== null;
  return hasAmount ? m : null;
}

const FIELD_PROMPT: Record<FieldKey, string> = {
  date: "the date of each entry",
  amount: "the amount",
  debit: "money going out (debit)",
  credit: "money coming in (credit)",
  description: "the description or payee",
  reference: "the reference or receipt number",
};

/** Questions for every field the code is not sure about. `suggested` is the best guess, so one click accepts it. */
export function mappingQuestions(
  table: ReadTable,
  profiles: ColumnProfile[],
  proposal: ProposedMapping,
  prefix: string,
  fileLabel: string,
): Question[] {
  const qs: Question[] = [];
  const labelFor = (i: number) => {
    const p = profiles[i];
    const key = headerKey(table.headers[i] ?? "", i, table.headers);
    return { value: key, label: p?.sample ? `${table.headers[i]} (for example: ${p.sample.slice(0, 24)})` : (table.headers[i] ?? key) };
  };
  const all = table.headers.map((_, i) => labelFor(i));
  for (const [field, choice] of Object.entries(proposal.fields) as [FieldKey, FieldChoice][]) {
    if (choice.confident || choice.answered) continue;
    const optional = field === "description" || field === "reference";
    if (choice.col === null) continue;
    qs.push({
      id: `${prefix}.${field}`,
      prompt: `Which column in "${table.name}" (file ${fileLabel}) has ${FIELD_PROMPT[field]}?`,
      kind: "choice",
      options: optional ? [...all, { value: NONE, label: "None of these" }] : all,
      suggested: headerKey(table.headers[choice.col] ?? "", choice.col, table.headers),
    });
  }
  return qs;
}
