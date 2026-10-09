import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import Papa from "papaparse";
import type { Check } from "../../../../shared/contracts";
import { classifyDate } from "./dates";
import { parseMoney } from "./money";
import type { Cell, ReadTable, SheetInfo, SourceRow } from "./types";

export const MAX_ROWS = 50_000;

/** A file NONON cannot compare. `message` is shown to the user as is. */
export class UnsupportedFile extends Error {
  constructor(
    message: string,
    readonly suggestion?: string,
  ) {
    super(message);
    this.name = "UnsupportedFile";
  }
}

export interface ReadOptions {
  /** Sheet chosen by the user for an .xlsx file. */
  sheet?: string;
  maxRows?: number;
}

export async function readTable(filePath: string, opts: ReadOptions = {}): Promise<ReadTable> {
  const name = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".csv" && ext !== ".xlsx") {
    const hint =
      ext === ".xls" || ext === ".xlsm" || ext === ".xlsb"
        ? "Open it in Excel, choose Save As, and save a copy as .xlsx or .csv. Then choose that copy."
        : "Save or export your list as an Excel (.xlsx) or .csv file, then choose that instead.";
    throw new UnsupportedFile(`"${name}" is a ${ext || "unknown"} file. NONON can compare Excel (.xlsx) and .csv spreadsheets only.`, hint);
  }
  const [buf, st] = await Promise.all([readFile(filePath), stat(filePath)]);
  const fingerprint = {
    path: filePath,
    size: st.size,
    mtimeMs: st.mtimeMs,
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
  const base = ext === ".csv" ? readCsv(buf, name) : await readXlsx(buf, name, opts.sheet);
  const maxRows = opts.maxRows ?? MAX_ROWS;
  if (base.rows.length > maxRows) {
    throw new UnsupportedFile(
      `"${name}" has ${base.rows.length.toLocaleString("en-US")} rows. NONON can compare up to ${maxRows.toLocaleString("en-US")} rows per file.`,
      "Split the file by month and compare one month at a time. Nothing was changed.",
    );
  }
  return { path: filePath, name, kind: ext === ".csv" ? "csv" : "xlsx", fingerprint, ...base };
}

type Base = Omit<ReadTable, "path" | "name" | "kind" | "fingerprint">;

// ------------------------------------------------------------------ CSV

function decodeText(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // Excel on Windows saves "CSV" in the local code page, not UTF-8.
    return new TextDecoder("windows-1252").decode(buf);
  }
}

function readCsv(buf: Buffer, name: string): Base {
  const text = decodeText(buf);
  const parsed = Papa.parse<string[]>(text, {
    delimiter: "",
    delimitersToGuess: [",", ";", "\t", "|"],
    skipEmptyLines: false,
  });
  const warnings: Check[] = [];
  const quoteErrors = parsed.errors.filter((e) => e.type === "Quotes");
  if (quoteErrors.length) {
    warnings.push({
      id: "csv-quotes",
      label: `"${name}" has mismatched quotation marks`,
      status: "warn",
      detail: `${quoteErrors.length === 1 ? "1 place" : `${quoteErrors.length} places`} may have been read wrongly, for example near row ${(quoteErrors[0]?.row ?? 0) + 1}.`,
    });
  }
  const all: SourceRow[] = parsed.data.map((cells, i) => ({ row: i + 1, cells: cells.map((t) => ({ t })) }));
  return finishTable(all, name, warnings, []);
}

// ------------------------------------------------------------------ XLSX

interface XlsxFeature {
  label: string;
  test: (names: string[], contentTypes: string) => boolean;
}

const FEATURES: XlsxFeature[] = [
  { label: "macros", test: (n, ct) => n.includes("xl/vbaProject.bin") || /macroEnabled/i.test(ct) },
  { label: "links to other workbooks", test: (n) => n.some((x) => x.startsWith("xl/externalLinks/")) },
  { label: "pivot tables", test: (n) => n.some((x) => x.startsWith("xl/pivotTables/") || x.startsWith("xl/pivotCache/")) },
  { label: "charts", test: (n) => n.some((x) => x.startsWith("xl/charts/") || x.startsWith("xl/chartsheets/")) },
  { label: "embedded objects", test: (n) => n.some((x) => x.startsWith("xl/embeddings/") || x.startsWith("xl/activeX/")) },
];

export async function detectXlsxFeatures(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  const ct = (await zip.file("[Content_Types].xml")?.async("string")) ?? "";
  return FEATURES.filter((f) => f.test(names, ct)).map((f) => f.label);
}

function isOleContainer(buf: Buffer): boolean {
  return buf.length > 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
}

function isoFromDate(d: Date): string {
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function xlsxCell(v: ExcelJS.CellValue | undefined): Cell {
  if (v === null || v === undefined) return { t: "" };
  if (typeof v === "string") return { t: v };
  if (typeof v === "number") return { t: String(v), n: v };
  if (typeof v === "boolean") return { t: v ? "TRUE" : "FALSE" };
  if (v instanceof Date) {
    const iso = isoFromDate(v);
    return { t: iso, d: iso };
  }
  const o = v as unknown as Record<string, unknown>;
  if ("formula" in o || "sharedFormula" in o) {
    const result = o.result as ExcelJS.CellValue | undefined;
    if (result === undefined || result === null) return { t: "", formulaMissing: true };
    return xlsxCell(result);
  }
  if (Array.isArray(o.richText)) return { t: (o.richText as { text: string }[]).map((r) => r.text).join("") };
  if (typeof o.text === "string") return { t: o.text };
  if (typeof o.error === "string") return { t: o.error };
  return { t: "" };
}

async function readXlsx(buf: Buffer, name: string, wantSheet?: string): Promise<Base> {
  if (isOleContainer(buf)) {
    throw new UnsupportedFile(
      `"${name}" has a password or is in an old Excel format, so NONON cannot open it.`,
      "Open it in Excel, remove the password if there is one, and save a copy as .xlsx or .csv.",
    );
  }
  let features: string[];
  try {
    features = await detectXlsxFeatures(buf);
  } catch {
    throw new UnsupportedFile(`"${name}" is not a proper .xlsx file.`, "Open it in Excel and save a fresh copy, or save it as .csv.");
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  } catch {
    throw new UnsupportedFile(`NONON could not open "${name}".`, "Open it in Excel and save a fresh copy, or save it as .csv.");
  }

  const visible = wb.worksheets.filter((w) => w.state === "visible");
  const sheets: SheetInfo[] = visible.map((w) => ({ name: w.name, rows: w.actualRowCount }));
  const withData = sheets.filter((s) => s.rows >= 2);
  if (!withData.length) {
    throw new UnsupportedFile(`"${name}" has no sheet with column titles and rows of data.`);
  }
  let chosen = withData.find((s) => s.name === wantSheet);
  const needsSheet = withData.length > 1 && !chosen;
  if (!chosen) chosen = withData.reduce((best, s) => (s.rows > best.rows ? s : best), withData[0] as SheetInfo);
  const ws = wb.getWorksheet(chosen.name);
  if (!ws) throw new UnsupportedFile(`NONON could not find the sheet "${chosen.name}" in "${name}".`);

  const all: SourceRow[] = [];
  const columnCount = ws.columnCount;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: Cell[] = [];
    for (let c = 1; c <= columnCount; c++) cells.push(xlsxCell(row.getCell(c).value));
    all.push({ row: rowNumber, cells });
  });

  const warnings: Check[] = [];
  const missing: string[] = [];
  for (const r of all) r.cells.forEach((c, i) => c.formulaMissing && missing.push(`${colLetter(i)}${r.row}`));
  if (missing.length) {
    warnings.push({
      id: "formula-no-result",
      label: `"${name}" has formulas with no saved result`,
      status: "warn",
      detail: `NONON does not work out formulas, so these cells count as empty: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ` and ${missing.length - 8} more` : ""}. To include them, open the file in Excel, save it, and run this again.`,
    });
  }
  if (features.length) {
    warnings.push({
      id: "unsupported-features",
      label: `"${name}" contains ${features.join(", ")}`,
      status: "warn",
      detail: "NONON read the values, but it will not change this file. Your comparison spreadsheet is still created.",
    });
  }
  const table = finishTable(all, name, warnings, features);
  return { ...table, sheet: chosen.name, sheets, needsSheet };
}

export function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ------------------------------------------------------------------ shared table shaping

function isBlank(r: SourceRow): boolean {
  return r.cells.every((c) => !c.t.trim() && !c.d && c.n === undefined);
}

function textLike(c: Cell): boolean {
  const t = c.t.trim();
  if (!t || c.d || c.n !== undefined) return false;
  return !parseMoney(t) && !classifyDate(t);
}

/**
 * The header is the first row that is mostly words and about as wide as the widest early row.
 * Bank exports often put a title or account number above it.
 */
export function detectHeaderRow(rows: SourceRow[]): number {
  const early = rows.filter((r) => !isBlank(r)).slice(0, 20);
  if (!early.length) return -1;
  const filled = (r: SourceRow) => r.cells.filter((c) => c.t.trim()).length;
  const widest = Math.max(...early.map(filled));
  for (let i = 0; i < early.length - 1; i++) {
    const r = early[i] as SourceRow;
    const n = filled(r);
    if (n < 2 || n < widest * 0.6) continue;
    const words = r.cells.filter(textLike).length;
    if (words / n >= 0.6) return r.row;
  }
  return (early[0] as SourceRow).row;
}

function finishTable(all: SourceRow[], name: string, warnings: Check[], features: string[]): Base {
  const nonBlank = all.filter((r) => !isBlank(r));
  if (nonBlank.length < 2) {
    throw new UnsupportedFile(`"${name}" has no data rows to compare.`);
  }
  const headerRow = detectHeaderRow(nonBlank);
  const columnCount = Math.max(...nonBlank.map((r) => r.cells.length));
  const headerSource = nonBlank.find((r) => r.row === headerRow) as SourceRow;
  const headers: string[] = [];
  for (let i = 0; i < columnCount; i++) {
    const h = (headerSource.cells[i]?.t ?? "").trim();
    headers.push(h || `Column ${colLetter(i)}`);
  }
  const first = nonBlank[0] as SourceRow;
  if (first.row !== headerRow) {
    warnings.push({
      id: "header-not-first",
      label: `"${name}" has ${headerRow - first.row} line(s) above the column titles`,
      status: "warn",
      detail: `NONON used row ${headerRow} as the column titles and ignored the lines above it.`,
    });
  }
  const rows = nonBlank
    .filter((r) => r.row > headerRow)
    .map((r) => ({ row: r.row, cells: padCells(r.cells, columnCount) }));
  const last = nonBlank[nonBlank.length - 1] as SourceRow;
  return { sheets: [], needsSheet: false, headers, headerRow, columnCount, rows, lastRow: last.row, features, warnings };
}

function padCells(cells: Cell[], n: number): Cell[] {
  if (cells.length >= n) return cells;
  return [...cells, ...Array.from({ length: n - cells.length }, () => ({ t: "" }))];
}
