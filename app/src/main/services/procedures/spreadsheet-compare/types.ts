import type { Check, FileFingerprint } from "../../../../shared/contracts";

/** One source cell. `t` is the display text; `n`/`d` are set when the source cell was typed as a number or date. */
export interface Cell {
  t: string;
  n?: number;
  /** ISO date (YYYY-MM-DD) when the source cell was a real date. */
  d?: string;
  /** A formula cell with no saved result. NONON never recalculates, so the value is missing. */
  formulaMissing?: boolean;
}

export interface SourceRow {
  /** 1-based row number exactly as shown in Excel (or the record number of a CSV). */
  row: number;
  cells: Cell[];
}

export interface SheetInfo {
  name: string;
  rows: number;
}

export interface ReadTable {
  path: string;
  name: string;
  kind: "csv" | "xlsx";
  sheet?: string;
  sheets: SheetInfo[];
  /** More than one sheet holds data and the user has not chosen one yet. */
  needsSheet: boolean;
  headers: string[];
  headerRow: number;
  columnCount: number;
  /** Non-blank rows after the header row. */
  rows: SourceRow[];
  /** Last non-blank row number in the file. */
  lastRow: number;
  /** Workbook features NONON can read around but must not edit (macros, charts, ...). */
  features: string[];
  warnings: Check[];
  fingerprint: FileFingerprint;
}

export type FieldKey = "date" | "description" | "reference" | "amount" | "debit" | "credit";

export interface Mapping {
  date: number;
  description: number | null;
  reference: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
}

export type FileLabel = "A" | "B";
export type DateOrder = "DMY" | "MDY";

export interface Rec {
  id: string;
  file: FileLabel;
  row: number;
  date: string | null;
  dateRaw: string;
  /** Amount as written in the file, integer cents. */
  cents: number;
  /** Amount used for comparing (sign rule applied), integer cents. */
  cmp: number;
  amountRaw: string;
  description: string;
  descTokens: string[];
  descNorm: string;
  reference: string;
  refNorm: string;
  rawCells: string[];
}

export interface SkippedRow {
  file: FileLabel;
  row: number;
  reason: string;
  rawCells: string[];
}

export type RecClass = "matched" | "only" | "duplicate" | "ambiguous";
export type MatchHow = "reference" | "amount-date-description" | "amount-date";

export interface Assignment {
  rec: Rec;
  cls: RecClass;
  /** Counterpart(s): matched partner, the twin a duplicate repeats, or the tied candidates. */
  partners: Rec[];
  how?: MatchHow;
  pairId?: number;
  note: string;
}

export interface Pair {
  id: number;
  a: Rec;
  b: Rec;
  how: MatchHow;
  dateDiffDays: number | null;
  amountDiffCents: number;
  note: string;
}

export interface Rules {
  amountTolCents: number;
  dateTolDays: number;
}

export interface MatchResult {
  pairs: Pair[];
  onlyA: Assignment[];
  onlyB: Assignment[];
  dupA: Assignment[];
  dupB: Assignment[];
  ambA: Assignment[];
  ambB: Assignment[];
  /** Every record of both files, keyed by Rec.id. */
  byId: Map<string, Assignment>;
}
