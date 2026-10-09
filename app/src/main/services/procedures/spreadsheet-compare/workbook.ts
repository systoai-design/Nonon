import ExcelJS from "exceljs";
import type { Check } from "../../../../shared/contracts";
import { centsToUnits, formatMoney } from "./money";
import type { Assignment, MatchResult, Rec, SkippedRow } from "./types";
import type { Totals } from "./totals";
import { friendlyTimestamp, gapLines, headline, lookFirst } from "./summary-text";

export interface SideInfo {
  name: string;
  sha256: string;
  sheet?: string;
  records: number;
  skipped: number;
  headers: string[];
  mappingLines: string[];
  currency: string | null;
}

export interface WorkbookInput {
  revision: string;
  generatedAt: string;
  a: SideInfo;
  b: SideInfo;
  ruleLines: string[];
  recsA: Rec[];
  recsB: Rec[];
  match: MatchResult;
  totals: Totals;
  skipped: SkippedRow[];
}

const SHEETS = {
  summary: "Summary",
  matched: "Matched",
  onlyA: "Only in A",
  onlyB: "Only in B",
  dup: "Listed twice",
  amb: "Not sure",
  skipped: "Skipped rows",
  about: "About this comparison",
} as const;

/** Width (in characters) of the first column on the Summary and About sheets, where whole sentences live. */
const TEXT_COLUMN_WIDTH = 70;
const MONEY_FMT = "#,##0.00;[Red]-#,##0.00";
const RECORD_HEADERS = [
  "Source", "File", "Row", "Date (as written)", "Description", "Reference", "Amount (as written)", "Amount used",
  "Note", "Related rows", "All original values",
];
const MATCHED_HEADERS = [
  "Match", "How matched", "A row", "A date", "A description", "A reference", "A amount (as written)", "A amount used",
  "B row", "B date", "B description", "B reference", "B amount (as written)", "B amount used", "Difference (A - B)", "Note",
  "All A values", "All B values",
];
const SUMMARY_TABLE_HEADERS = ["Group", "How many", "First file total", "Second file total", "Where to look"];
const SUMMARY_LABELS = {
  totalA: "Total of the first file",
  totalB: "Total of the second file",
  gap: "Gap (first minus second)",
  group: "Group",
} as const;
const GROUP_LABELS = {
  matched: "Matched (pairs)",
  onlyA: "Only in the first file",
  onlyB: "Only in the second file",
  dup: "Listed twice",
  amb: "Not sure",
  skipped: "Left out (could not be read)",
} as const;
const SECTION_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDE8DF" } } as const;

function original(rec: Rec | SkippedRow, headers: string[]): string {
  const cells = "rawCells" in rec ? rec.rawCells : [];
  return cells
    .map((v, i) => (v.trim() ? `${headers[i] ?? `Column ${i + 1}`}: ${v.trim()}` : ""))
    .filter(Boolean)
    .join(" | ");
}

function style(ws: ExcelJS.Worksheet, widths: number[], moneyCols: number[]) {
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDE8DF" } };
  head.alignment = { vertical: "middle", wrapText: true };
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  for (const c of moneyCols) ws.getColumn(c).numFmt = MONEY_FMT;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function relatedText(x: Assignment): string {
  if (x.partners.length === 0) return "";
  const side = x.partners[0]?.file ?? "";
  return `${side} row ${x.partners.map((p) => p.row).join(", ")}`;
}

function addRecordRows(ws: ExcelJS.Worksheet, items: Assignment[], sideFor: (r: Rec) => SideInfo) {
  for (const x of items) {
    const side = sideFor(x.rec);
    ws.addRow([
      x.rec.file, side.name, x.rec.row, x.rec.dateRaw, x.rec.description, x.rec.reference, x.rec.amountRaw,
      centsToUnits(x.rec.cmp), x.note, relatedText(x), original(x.rec, side.headers),
    ]);
  }
}

function sectionRow(ws: ExcelJS.Worksheet, text: string, cols: number) {
  const row = ws.addRow([text]);
  row.font = { bold: true, size: 12 };
  for (let c = 1; c <= cols; c++) row.getCell(c).fill = SECTION_FILL;
}

/** One sentence is one cell. The column is wide and the cell wraps, so Excel shows it whole and the Results viewer can wrap it too. */
function textLines(ws: ExcelJS.Worksheet, text: string, indent = "") {
  const row = ws.addRow([`${indent}${text}`]);
  row.getCell(1).alignment = { wrapText: true, vertical: "top" };
  return row;
}

function writeSummary(wb: ExcelJS.Workbook, input: WorkbookInput) {
  const { match: m, totals: t } = input;
  const cur = input.a.currency ?? input.b.currency;
  const money = (c: number) => formatMoney(c, cur);
  const ws = wb.addWorksheet(SHEETS.summary);
  ws.getColumn(1).width = TEXT_COLUMN_WIDTH;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 34;
  ws.pageSetup = { fitToPage: true, fitToWidth: 1, fitToHeight: 0, orientation: "portrait" };

  textLines(ws, `Comparison of ${input.a.name} and ${input.b.name}`).font = { bold: true, size: 14 };
  textLines(ws, headline(t));
  ws.addRow([]);

  sectionRow(ws, "The difference", 5);
  const valueRow = (label: string, cents: number) => {
    const row = ws.addRow([label, centsToUnits(cents)]);
    row.getCell(2).numFmt = MONEY_FMT;
    row.getCell(2).alignment = { horizontal: "right" };
    return row;
  };
  valueRow(SUMMARY_LABELS.totalA, t.totalA.cents);
  valueRow(SUMMARY_LABELS.totalB, t.totalB.cents);
  valueRow(SUMMARY_LABELS.gap, t.difference).font = { bold: true };
  textLines(ws, cur ? `All amounts are in ${cur}. The gap is the first total minus the second.` : "The gap is the first total minus the second.");
  ws.addRow([]);
  for (const line of gapLines(t, cur)) textLines(ws, line, "");
  ws.addRow([]);

  sectionRow(ws, "What to look at first", 5);
  const items = lookFirst(m, { a: input.a.name, b: input.b.name }, cur, 5);
  if (!items.length) textLines(ws, "Nothing needs a look. Every row has its partner.");
  items.forEach((item, i) => {
    textLines(ws, `${i + 1}. ${item.title}`).font = { bold: true };
    textLines(ws, item.where, "   ");
    textLines(ws, item.reason, "   ");
  });
  ws.addRow([]);

  sectionRow(ws, "Where every row went", 5);
  const head = ws.addRow(SUMMARY_TABLE_HEADERS);
  head.font = { bold: true };
  const groupRow = (label: string, count: number, a: number | null, b: number | null, sheet: string) => {
    const row = ws.addRow([label, count, a === null ? null : centsToUnits(a), b === null ? null : centsToUnits(b), `See the sheet '${sheet}'`]);
    row.getCell(3).numFmt = MONEY_FMT;
    row.getCell(4).numFmt = MONEY_FMT;
  };
  groupRow(GROUP_LABELS.matched, t.matched.pairs, t.matched.a.cents, t.matched.b.cents, SHEETS.matched);
  groupRow(GROUP_LABELS.onlyA, t.onlyA.count, t.onlyA.cents, null, SHEETS.onlyA);
  groupRow(GROUP_LABELS.onlyB, t.onlyB.count, null, t.onlyB.cents, SHEETS.onlyB);
  groupRow(GROUP_LABELS.dup, t.dupA.count + t.dupB.count, t.dupA.cents, t.dupB.cents, SHEETS.dup);
  groupRow(GROUP_LABELS.amb, t.ambA.count + t.ambB.count, t.ambA.cents, t.ambB.cents, SHEETS.amb);
  if (input.skipped.length) groupRow(GROUP_LABELS.skipped, input.skipped.length, null, null, SHEETS.skipped);
  ws.addRow([]);
  textLines(ws, `The technical details are on the last sheet, '${SHEETS.about}'.`);
}

function writeAbout(wb: ExcelJS.Workbook, input: WorkbookInput) {
  const ws = wb.addWorksheet(SHEETS.about);
  ws.getColumn(1).width = TEXT_COLUMN_WIDTH;
  ws.getColumn(2).width = 64;
  const cur = input.a.currency ?? input.b.currency;
  const pair = (label: string, value: string | number) => {
    const row = ws.addRow([label, value]);
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    row.getCell(2).alignment = { wrapText: true, vertical: "top", horizontal: "left" };
    return row;
  };

  ws.addRow([SHEETS.about]).font = { bold: true, size: 14 };
  pair("Made on", friendlyTimestamp(input.generatedAt));
  pair("Currency", cur ?? "not stated in the files");
  ws.addRow([]);

  sectionRow(ws, "The rules used", 2);
  for (const l of input.ruleLines) textLines(ws, l);
  textLines(ws, "Amounts are exact, shown with two decimals.");
  textLines(ws, "The sheets hold plain values, not formulas.");
  ws.addRow([]);

  for (const [heading, side, file] of [["The first file", input.a, "A"], ["The second file", input.b, "B"]] as const) {
    sectionRow(ws, heading, 2);
    pair("File", `${side.name}${side.sheet ? ` (sheet "${side.sheet}")` : ""}`);
    const wants = ["Date", "Description", "Reference", "Amount"];
    for (const w of wants) {
      const found = side.mappingLines.filter((l) => l.startsWith(`${w} column: `));
      if (w === "Amount" && !found.length) {
        const split = side.mappingLines.filter((l) => /^(Debit|Credit) column: /.test(l));
        if (split.length) {
          for (const l of split) pair(`${l.split(" column: ")[0]} read from`, l.split(" column: ")[1] ?? "");
          continue;
        }
      }
      pair(`${w} read from`, found.length ? (found[0] as string).split(" column: ")[1] ?? "" : "no column found");
    }
    pair("Rows compared", side.records);
    pair("Rows left out", side.skipped);
    const reasons = new Map<string, number>();
    for (const s of input.skipped) if (s.file === file) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
    for (const [reason, n] of reasons) pair(`  ${n} row${n === 1 ? "" : "s"} left out because`, reason);
    ws.addRow([]);
  }

  sectionRow(ws, "For the record", 2);
  textLines(ws, "These details let someone check this result later.");
  pair("Job version", `spreadsheet-compare ${input.revision}`);
  pair("Saved at (exact time, UTC)", input.generatedAt);
  textLines(ws, "A file check code lets you prove the file was not changed.");
  pair("File check code, first file", input.a.sha256);
  pair("File check code, second file", input.b.sha256);
}

export async function buildWorkbook(input: WorkbookInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "NONON";
  const { match: m, totals: t } = input;
  const sideFor = (r: Rec) => (r.file === "A" ? input.a : input.b);

  writeSummary(wb, input);

  // Matched
  const mat = wb.addWorksheet(SHEETS.matched);
  mat.addRow(MATCHED_HEADERS);
  const how: Record<string, string> = {
    reference: "Same reference",
    "amount-date-description": "Amount, date and wording",
    "amount-date": "Amount and date only",
  };
  for (const p of [...m.pairs].sort((x, y) => x.a.row - y.a.row)) {
    mat.addRow([
      p.id, how[p.how], p.a.row, p.a.dateRaw, p.a.description, p.a.reference, p.a.amountRaw, centsToUnits(p.a.cmp),
      p.b.row, p.b.dateRaw, p.b.description, p.b.reference, p.b.amountRaw, centsToUnits(p.b.cmp), centsToUnits(p.a.cmp - p.b.cmp),
      p.note, original(p.a, input.a.headers), original(p.b, input.b.headers),
    ]);
  }
  style(mat, [8, 24, 8, 14, 28, 16, 16, 14, 8, 14, 28, 16, 16, 14, 14, 40, 60, 60], [8, 14, 15]);

  // Only in A / Only in B
  for (const [key, items] of [[SHEETS.onlyA, m.onlyA], [SHEETS.onlyB, m.onlyB]] as const) {
    const ws = wb.addWorksheet(key);
    ws.addRow(RECORD_HEADERS);
    addRecordRows(ws, items, sideFor);
    style(ws, [8, 26, 8, 14, 32, 16, 16, 14, 50, 18, 70], [8]);
  }

  // Duplicates
  const dup = wb.addWorksheet(SHEETS.dup);
  dup.addRow(RECORD_HEADERS);
  addRecordRows(dup, [...m.dupA, ...m.dupB], sideFor);
  style(dup, [8, 26, 8, 14, 32, 16, 16, 14, 50, 18, 70], [8]);

  // Ambiguous
  const amb = wb.addWorksheet(SHEETS.amb);
  amb.addRow(RECORD_HEADERS);
  addRecordRows(amb, [...m.ambA, ...m.ambB], sideFor);
  style(amb, [8, 26, 8, 14, 32, 16, 16, 14, 50, 18, 70], [8]);

  if (input.skipped.length) {
    const sk = wb.addWorksheet(SHEETS.skipped);
    sk.addRow(["Source", "File", "Row", "Why it was left out", "All original values"]);
    for (const s of input.skipped) {
      const side = s.file === "A" ? input.a : input.b;
      sk.addRow([s.file, side.name, s.row, s.reason, original(s, side.headers)]);
    }
    style(sk, [8, 26, 8, 50, 80], []);
  }

  writeAbout(wb, input);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

// ------------------------------------------------------------------ reopen and validate

function num(v: ExcelJS.CellValue | undefined): number | null {
  return typeof v === "number" ? v : null;
}

function at(row: ExcelJS.Row, col: number | undefined): ExcelJS.CellValue | undefined {
  return col === undefined ? undefined : row.getCell(col).value;
}

function headerIndex(ws: ExcelJS.Worksheet, headers: string[]): Record<string, number> {
  const row = ws.getRow(1);
  const idx: Record<string, number> = {};
  headers.forEach((h) => {
    for (let c = 1; c <= row.cellCount; c++) {
      if (String(row.getCell(c).value ?? "") === h && !(h in idx)) idx[h] = c;
    }
  });
  return idx;
}

export interface ValidationResult {
  ok: boolean;
  problems: string[];
}

/** Reads the workbook back from bytes and proves every row and total made it in. */
export async function validateWorkbook(data: Buffer, input: WorkbookInput): Promise<ValidationResult> {
  const problems: string[] = [];
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ExcelJS.Buffer);
  } catch (e) {
    return { ok: false, problems: [`The workbook could not be reopened: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const { match: m, totals: t } = input;
  const seenA = new Map<number, number>();
  const seenB = new Map<number, number>();
  const bump = (file: string, row: number | null) => {
    if (row === null) return;
    const map = file === "A" ? seenA : seenB;
    map.set(row, (map.get(row) ?? 0) + 1);
  };
  const sums = { onlyA: 0, onlyB: 0, dupA: 0, dupB: 0, ambA: 0, ambB: 0, matchedA: 0, matchedB: 0 };
  const counts = { onlyA: 0, onlyB: 0, dupA: 0, dupB: 0, ambA: 0, ambB: 0, matched: 0 };
  const cents = (v: ExcelJS.CellValue | undefined) => {
    const n = num(v);
    return n === null ? null : Math.round(n * 100);
  };

  const mat = wb.getWorksheet(SHEETS.matched);
  if (!mat) problems.push('The "Matched" sheet is missing.');
  else {
    const ix = headerIndex(mat, MATCHED_HEADERS);
    mat.eachRow((row, n) => {
      if (n === 1) return;
      counts.matched++;
      bump("A", num(at(row, ix["A row"])));
      bump("B", num(at(row, ix["B row"])));
      sums.matchedA += cents(at(row, ix["A amount used"])) ?? 0;
      sums.matchedB += cents(at(row, ix["B amount used"])) ?? 0;
    });
  }

  const readRecords = (sheetName: string) => {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) {
      problems.push(`The "${sheetName}" sheet is missing.`);
      return;
    }
    const ix = headerIndex(ws, RECORD_HEADERS);
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const src = String(at(row, ix.Source) ?? "");
      const rowNo = num(at(row, ix.Row));
      const c = cents(at(row, ix["Amount used"])) ?? 0;
      bump(src, rowNo);
      const k = (sheetName === SHEETS.onlyA ? "onlyA" : sheetName === SHEETS.onlyB ? "onlyB" : sheetName === SHEETS.dup ? (src === "A" ? "dupA" : "dupB") : src === "A" ? "ambA" : "ambB") as keyof typeof counts;
      counts[k] = (counts[k] ?? 0) + 1;
      (sums as Record<string, number>)[k] = ((sums as Record<string, number>)[k] ?? 0) + c;
    });
  };
  readRecords(SHEETS.onlyA);
  readRecords(SHEETS.onlyB);
  readRecords(SHEETS.dup);
  readRecords(SHEETS.amb);

  for (const [label, recs, seen] of [["A", input.recsA, seenA], ["B", input.recsB, seenB]] as const) {
    for (const r of recs) {
      const n = seen.get(r.row) ?? 0;
      if (n !== 1) problems.push(`Row ${r.row} of file ${label} appears ${n} times in the workbook (expected once).`);
    }
    if (seen.size !== recs.length) problems.push(`File ${label}: ${seen.size} distinct rows in the workbook, ${recs.length} expected.`);
  }
  const want: [string, number, number][] = [
    ["pairs that match", counts.matched, t.matched.pairs],
    ["only in A", counts.onlyA, t.onlyA.count],
    ["only in B", counts.onlyB, t.onlyB.count],
    ["duplicates in A", counts.dupA, t.dupA.count],
    ["duplicates in B", counts.dupB, t.dupB.count],
    ["unclear in A", counts.ambA, t.ambA.count],
    ["unclear in B", counts.ambB, t.ambB.count],
    ["matched total A", sums.matchedA, t.matched.a.cents],
    ["matched total B", sums.matchedB, t.matched.b.cents],
    ["only-in-A total", sums.onlyA, t.onlyA.cents],
    ["only-in-B total", sums.onlyB, t.onlyB.cents],
    ["duplicates-in-A total", sums.dupA, t.dupA.cents],
    ["duplicates-in-B total", sums.dupB, t.dupB.cents],
    ["unclear-in-A total", sums.ambA, t.ambA.cents],
    ["unclear-in-B total", sums.ambB, t.ambB.cents],
  ];
  for (const [what, got, exp] of want) if (got !== exp) problems.push(`${what}: workbook has ${got}, expected ${exp}.`);

  const names = wb.worksheets.map((w) => w.name);
  if (names[0] !== SHEETS.summary) problems.push('The "Summary" sheet is not the first sheet.');
  if (names[names.length - 1] !== SHEETS.about) problems.push(`The "${SHEETS.about}" sheet is not the last sheet.`);

  const summary = wb.getWorksheet(SHEETS.summary);
  if (!summary) problems.push('The "Summary" sheet is missing.');
  else {
    const labelRows = new Map<string, ExcelJS.Row>();
    summary.eachRow((row) => {
      const label = String(row.getCell(1).value ?? "");
      if (!labelRows.has(label)) labelRows.set(label, row);
    });
    const value = (label: string, expected: number) => {
      const row = labelRows.get(label);
      if (!row) {
        problems.push(`The Summary sheet has no "${label}" line.`);
        return;
      }
      const got = cents(row.getCell(2).value);
      if (got !== expected) problems.push(`Summary "${label}": workbook has ${got}, expected ${expected}.`);
    };
    value(SUMMARY_LABELS.totalA, t.totalA.cents);
    value(SUMMARY_LABELS.totalB, t.totalB.cents);
    value(SUMMARY_LABELS.gap, t.difference);

    const group = (label: string, count: number, a: number, b: number) => {
      const row = labelRows.get(label);
      if (!row) {
        problems.push(`The Summary table has no "${label}" line.`);
        return;
      }
      const got = [num(row.getCell(2).value), cents(row.getCell(3).value) ?? 0, cents(row.getCell(4).value) ?? 0];
      [count, a, b].forEach((e, i) => {
        if (got[i] !== e) problems.push(`Summary "${label}" column ${i + 2}: workbook has ${got[i]}, expected ${e}.`);
      });
    };
    group(GROUP_LABELS.matched, t.matched.pairs, t.matched.a.cents, t.matched.b.cents);
    group(GROUP_LABELS.onlyA, t.onlyA.count, t.onlyA.cents, 0);
    group(GROUP_LABELS.onlyB, t.onlyB.count, 0, t.onlyB.cents);
    group(GROUP_LABELS.dup, t.dupA.count + t.dupB.count, t.dupA.cents, t.dupB.cents);
    group(GROUP_LABELS.amb, t.ambA.count + t.ambB.count, t.ambA.cents, t.ambB.cents);
  }

  const about = wb.getWorksheet(SHEETS.about);
  if (!about) problems.push(`The "${SHEETS.about}" sheet is missing.`);
  else {
    const cells = new Set<string>();
    about.eachRow((row) => cells.add(String(row.getCell(2).value ?? "")));
    for (const [label, side] of [["first", input.a], ["second", input.b]] as const) {
      if (!cells.has(side.sha256)) problems.push(`The file check code of the ${label} file is missing from "${SHEETS.about}".`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export function validationCheck(r: ValidationResult, _label: string, difference: number): Check {
  return r.ok
    ? {
        id: "output-reopened",
        label: "The comparison spreadsheet was reopened and checked",
        status: "pass",
        detail: `The saved spreadsheet opens again, every row is in it exactly once, and the totals match (file A minus file B is ${formatMoney(difference)}).`,
      }
    : { id: "output-reopened", label: "The comparison spreadsheet did not pass its check", status: "fail", detail: r.problems.slice(0, 5).join(" ") };
}
