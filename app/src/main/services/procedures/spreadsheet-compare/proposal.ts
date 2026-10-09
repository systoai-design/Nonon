import type { Check, ChangeEdit, ChangeProposalDraft } from "../../../../shared/contracts";
import type { Assignment, FileLabel, Mapping, ReadTable, Rec, SkippedRow } from "./types";

export const STATUS_HEADER = "NONON status";
export const NOTE_HEADER = "NONON note";

export type RowStatus = "matched" | "only here" | "listed twice" | "check" | "";

export interface RowAnnotation {
  status: RowStatus;
  note: string;
}

function annotate(a: Assignment, otherName: string): RowAnnotation {
  const rows = a.partners.map((p) => p.row);
  switch (a.cls) {
    case "matched":
      return { status: "matched", note: `Matches row ${rows[0]} in ${otherName}${a.note ? `. ${a.note}` : ""}` };
    case "only":
      return { status: "only here", note: a.note ? a.note : `Not found in ${otherName}` };
    case "duplicate":
      return { status: "listed twice", note: `Listed more than once: same as row ${rows[0]}` };
    case "ambiguous":
      return { status: "check", note: `Could be ${rows.slice(0, 4).map((r) => `row ${r}`).join(" or ")} in ${otherName}. You decide which` };
  }
}

/** Annotation for every row after the header, in file order: values[k] belongs to row headerRow + 1 + k. */
export function annotateRows(
  table: ReadTable,
  recs: Rec[],
  byId: Map<string, Assignment>,
  skipped: SkippedRow[],
  otherName: string,
): RowAnnotation[] {
  const byRow = new Map<number, RowAnnotation>();
  for (const r of recs) {
    const a = byId.get(r.id);
    if (a) byRow.set(r.row, annotate(a, otherName));
  }
  for (const s of skipped) {
    const total = s.reason.startsWith("Looks like a total");
    byRow.set(s.row, total ? { status: "", note: "" } : { status: "check", note: `Not compared: ${s.reason}` });
  }
  const out: RowAnnotation[] = [];
  for (let row = table.headerRow + 1; row <= table.lastRow; row++) out.push(byRow.get(row) ?? { status: "", note: "" });
  return out;
}

function uniqueHeader(base: string, headers: string[]): string {
  if (!headers.includes(base)) return base;
  let n = 2;
  while (headers.includes(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

export interface ProposalResult {
  draft?: ChangeProposalDraft;
  check: Check;
}

export function buildProposal(args: {
  table: ReadTable;
  label: FileLabel;
  mapping: Mapping;
  recs: Rec[];
  byId: Map<string, Assignment>;
  skipped: SkippedRow[];
  otherName: string;
}): ProposalResult {
  const { table, mapping } = args;
  const skip = (detail: string): ProposalResult => ({
    check: { id: "proposal-offered", label: "No change to your original file is offered", status: "warn", detail },
  });
  if (table.features.length) {
    return skip(`"${table.name}" contains ${table.features.join(", ")}, and NONON does not change files like that. The comparison spreadsheet has everything you need.`);
  }
  if (table.headerRow !== 1) {
    return skip(`The column titles in "${table.name}" are on row ${table.headerRow}, not row 1, so adding columns is not offered. The comparison spreadsheet has everything you need.`);
  }
  const ann = annotateRows(table, args.recs, args.byId, args.skipped, args.otherName);
  const statusHeader = uniqueHeader(STATUS_HEADER, table.headers);
  const noteHeader = uniqueHeader(NOTE_HEADER, table.headers);
  const appendColumns = [
    { header: statusHeader, values: ann.map((x) => x.status) },
    { header: noteHeader, values: ann.map((x) => x.note) },
  ];
  const edit: ChangeEdit =
    table.kind === "csv"
      ? { op: "csv-set-cells", path: table.path, cells: [], appendColumns }
      : { op: "xlsx-set-cells", path: table.path, sheet: table.sheet ?? "", cells: [], appendColumns };

  // Preview: rows that need attention first, then matched rows, at most 12, in file order.
  const dataRows = table.rows.map((r, i) => ({ r, a: ann[r.row - table.headerRow - 1] ?? { status: "" as RowStatus, note: "" }, i }));
  const attention = dataRows.filter((x) => x.a.status !== "matched" && x.a.status !== "");
  const rest = dataRows.filter((x) => x.a.status === "matched");
  const chosen = [...attention, ...rest].slice(0, 12).sort((x, y) => x.r.row - y.r.row);

  const shown: number[] = [];
  for (const c of [mapping.date, mapping.description, mapping.reference, mapping.amount, mapping.debit, mapping.credit]) {
    if (c !== null && !shown.includes(c)) shown.push(c);
  }
  for (let c = 0; c < table.columnCount && shown.length < 6; c++) if (!shown.includes(c)) shown.push(c);
  shown.sort((x, y) => x - y);
  const cols = shown.slice(0, 6);

  const before: string[][] = [["Row", ...cols.map((c) => table.headers[c] ?? "")]];
  const after: string[][] = [["Row", ...cols.map((c) => table.headers[c] ?? ""), statusHeader, noteHeader]];
  const highlights: { row: number; col: number }[] = [
    { row: 0, col: cols.length + 1 },
    { row: 0, col: cols.length + 2 },
  ];
  chosen.forEach((x, i) => {
    const cells = cols.map((c) => (x.r.cells[c]?.t ?? "").slice(0, 40));
    before.push([String(x.r.row), ...cells]);
    after.push([String(x.r.row), ...cells, x.a.status, x.a.note.slice(0, 120)]);
    highlights.push({ row: i + 1, col: cols.length + 1 }, { row: i + 1, col: cols.length + 2 });
  });

  const annotated = ann.filter((x) => x.status !== "").length;
  const checks: Check[] = [
    {
      id: "append-only",
      label: "Only two new columns are added to the end",
      status: "pass",
      detail: `"${statusHeader}" and "${noteHeader}" go after your last column. Nothing already in the file changes.`,
    },
    {
      id: "rows-annotated",
      label: `${annotated} of ${table.rows.length} rows get a status`,
      status: annotated === table.rows.length ? "pass" : "warn",
      detail: annotated === table.rows.length ? undefined : "Blank lines and total lines are left empty.",
    },
  ];
  return {
    draft: {
      target: table.path,
      edits: [edit],
      reason: `Adds two columns to "${table.name}". They show, row by row, whether each entry was found in "${args.otherName}". Nothing already in the file changes.`,
      preview: {
        title: `${table.name}: add two columns, "${statusHeader}" and "${noteHeader}"`,
        before,
        after,
        highlights,
      },
      checks,
    },
    check: {
      id: "proposal-offered",
      label: "A change to your original file is ready for you to review",
      status: "pass",
      detail: `This adds two columns to "${table.name}". Nothing changes until you say OK.`,
    },
  };
}
