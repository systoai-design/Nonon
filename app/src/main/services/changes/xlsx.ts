import ExcelJS from "exceljs";
import type { ChangeEdit } from "../../../shared/contracts";
import type { EditResult } from "./csv";
import { EditError, XLSX_SUGGESTION } from "./errors";
import { gridPreview } from "./preview";
import { assertXlsxSupported } from "./xlsx-guard";

export type XlsxEdit = Extract<ChangeEdit, { op: "xlsx-set-cells" }>;

const MAX_ROW = 1_048_576;
const MAX_COL = 16_384;

export function colToNum(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numToCol(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

export function parseAddress(address: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]{1,3})([1-9]\d{0,6})$/.exec(address.trim());
  if (!m) return null;
  const col = colToNum(m[1]!);
  const row = Number(m[2]);
  return col > MAX_COL || row > MAX_ROW ? null : { row, col };
}

interface CellSnap {
  /** JSON of the exact value, for equality. */
  v: string;
  /** Style JSON, for equality. */
  s: string;
  /** Human text, for previews. */
  t: string;
}

interface SheetSnap {
  name: string;
  state: string;
  cells: Map<string, CellSnap>;
  merges: string;
  cols: Map<number, { width: number | null; hidden: boolean }>;
  views: string;
  autoFilter: string;
  validations: string;
  tables: string;
  rowHeights: Map<number, number>;
  dims: [number, number, number, number];
}

interface BookSnap {
  sheets: SheetSnap[];
  date1904: boolean;
  names: string;
}

const key = (row: number, col: number): string => `${row}:${col}`;

/** JSON with sorted keys: exceljs returns the same style with keys in a different order after a round trip. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function safeText(cell: ExcelJS.Cell): string {
  try {
    return cell.text ?? "";
  } catch {
    return "";
  }
}

function snapSheet(ws: ExcelJS.Worksheet): SheetSnap {
  const cells = new Map<string, CellSnap>();
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    row.eachCell({ includeEmpty: true }, (cell, cn) => {
      // A merged-in cell reports its master's value, so only the master carries the value.
      const v = cell.type === ExcelJS.ValueType.Merge || cell.value === null || cell.value === undefined ? "" : stable(cell.value);
      const s = cell.style && Object.keys(cell.style).length > 0 ? stable(cell.style) : "";
      if (v === "" && s === "") return;
      cells.set(key(rn, cn), { v, s, t: safeText(cell) });
    });
  });
  const cols = new Map<number, { width: number | null; hidden: boolean }>();
  for (const c of ws.columns ?? []) {
    if (c.number && (c.width !== undefined || c.hidden)) cols.set(c.number, { width: c.width ?? null, hidden: Boolean(c.hidden) });
  }
  const rowHeights = new Map<number, number>();
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (row.height) rowHeights.set(rn, row.height);
  });
  const merges = JSON.stringify([...((ws.model as { merges?: string[] }).merges ?? [])].sort());
  const d = ws.dimensions;
  return {
    name: ws.name,
    state: ws.state,
    cells,
    merges,
    cols,
    views: stable(ws.views ?? []),
    autoFilter: stable(ws.autoFilter ?? null),
    validations: stable((ws as unknown as { dataValidations?: { model?: unknown } }).dataValidations?.model ?? {}),
    tables: JSON.stringify(ws.getTables().map((t) => (t as { name?: string }).name ?? "")),
    rowHeights,
    dims: [d?.top ?? 0, d?.left ?? 0, d?.bottom ?? 0, d?.right ?? 0],
  };
}

function snapBook(wb: ExcelJS.Workbook): BookSnap {
  return {
    sheets: wb.worksheets.map(snapSheet),
    date1904: Boolean(wb.properties?.date1904),
    names: stable(((wb.definedNames as { model?: unknown }).model ?? []) as unknown),
  };
}

async function loadBook(bytes: Buffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb;
}

function isArrayOrShared(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return "sharedFormula" in v || "shareType" in v || ("formula" in v && "ref" in v);
}

function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const exact = wb.getWorksheet(name);
  if (exact) return exact;
  const loose = wb.worksheets.filter((w) => w.name.toLowerCase() === name.trim().toLowerCase());
  if (loose.length === 1) return loose[0]!;
  const names = wb.worksheets.map((w) => `"${w.name}"`).join(", ");
  throw new EditError(`There is no sheet called "${name}". The sheets in this file are: ${names || "(none)"}.`);
}

interface Planned {
  address: string;
  row: number;
  col: number;
  value: string | number | null;
  formula?: string;
}

function plan(edit: XlsxEdit, ws: ExcelJS.Worksheet): { cells: Planned[]; appended: { header: string; col: number; values: (string | number | null)[] }[] } {
  const seen = new Set<string>();
  const cells: Planned[] = [];
  for (const c of edit.cells) {
    const pos = parseAddress(c.address);
    if (!pos) throw new EditError(`"${c.address}" is not a valid cell address (use something like B7).`);
    const k = key(pos.row, pos.col);
    if (seen.has(k)) throw new EditError(`Cell ${c.address.toUpperCase()} is listed twice.`);
    seen.add(k);
    if (typeof c.value !== "string" && typeof c.value !== "number" && c.value !== null) {
      throw new EditError(`The new value for ${c.address} must be text, a number or empty.`);
    }
    if (typeof c.value === "number" && !Number.isFinite(c.value)) throw new EditError(`The new value for ${c.address} is not a usable number.`);
    const cell = ws.getCell(pos.row, pos.col);
    if (cell.type === ExcelJS.ValueType.Merge) {
      throw new EditError(`Cell ${c.address.toUpperCase()} is inside a merged block, so a change there would be lost. Change the top-left cell of the block instead.`);
    }
    if (isArrayOrShared(cell.value)) {
      throw new EditError(`Cell ${c.address.toUpperCase()} holds a shared or array formula, which NONON cannot safely replace.`, {
        suggestion: XLSX_SUGGESTION,
        unsupported: true,
      });
    }
    cells.push({ address: c.address.trim().toUpperCase(), row: pos.row, col: pos.col, value: c.value, ...(c.formula ? { formula: c.formula.replace(/^=/, "") } : {}) });
  }
  const appended: { header: string; col: number; values: (string | number | null)[] }[] = [];
  const dataRows = Math.max(ws.rowCount - 1, 0);
  const base = ws.columnCount;
  (edit.appendColumns ?? []).forEach((a, i) => {
    if (a.values.length > dataRows) {
      throw new EditError(`The new column "${a.header}" has ${a.values.length} values but sheet "${ws.name}" only has ${dataRows} rows under the header.`);
    }
    if (base + 1 + i > MAX_COL) throw new EditError("There is no room for another column on this sheet.");
    appended.push({ header: a.header, col: base + 1 + i, values: a.values });
  });
  return { cells, appended };
}

const normalise = (v: unknown): string => (v === null || v === undefined ? "" : stable(v));

function expectedMatches(cell: CellSnap | undefined, p: { value: string | number | null; formula?: string | undefined }): boolean {
  if (p.formula !== undefined) {
    if (!cell) return false;
    return (JSON.parse(cell.v) as { formula?: string }).formula === p.formula;
  }
  if (p.value === null) return !cell || cell.v === "";
  if (typeof p.value === "number" && cell && /^"\d{4}-\d\d-\d\dT[\d:.]+Z"$/.test(cell.v)) {
    // A number written into a date-formatted cell reads back as a Date; compare as the spreadsheet serial number.
    const serial = (Date.parse(JSON.parse(cell.v) as string) - Date.UTC(1899, 11, 30)) / 86_400_000;
    return Math.abs(serial - p.value) < 1e-6;
  }
  return cell?.v === normalise(p.value);
}

/** Proves the written workbook still holds everything the original did, apart from the cells we meant to change. */
export function verifyXlsxChange(
  before: BookSnap,
  after: BookSnap,
  sheetName: string,
  expected: Map<string, { value: string | number | null; formula?: string | undefined }>,
): string | null {
  if (before.sheets.length !== after.sheets.length) return "the number of sheets changed";
  if (before.date1904 !== after.date1904) return "the date system changed";
  if (before.names !== after.names) return "named ranges changed";
  for (let i = 0; i < before.sheets.length; i++) {
    const b = before.sheets[i]!;
    const a = after.sheets[i]!;
    if (b.name !== a.name) return `sheet "${b.name}" was renamed or moved`;
    const edited = b.name === sheetName;
    const where = `on sheet "${b.name}"`;
    if (b.state !== a.state) return `sheet visibility changed ${where}`;
    if (b.merges !== a.merges) return `merged cells changed ${where}`;
    if (b.views !== a.views) return `frozen panes or zoom changed ${where}`;
    if (b.autoFilter !== a.autoFilter) return `the filter changed ${where}`;
    if (b.validations !== a.validations) return `drop-down rules changed ${where}`;
    if (b.tables !== a.tables) return `tables changed ${where}`;
    for (const [col, w] of b.cols) {
      const got = a.cols.get(col);
      if (!got || got.hidden !== w.hidden || Math.abs((got.width ?? 0) - (w.width ?? 0)) > 0.001) return `column width changed ${where}`;
    }
    if (!edited && b.cols.size !== a.cols.size) return `column widths changed ${where}`;
    for (const [row, h] of b.rowHeights) if (a.rowHeights.get(row) !== h) return `row height changed ${where}`;
    if (edited) {
      if (a.dims[2] < b.dims[2] || a.dims[3] < b.dims[3]) return `the used area shrank ${where}`;
    } else if (b.dims.some((n, k) => n !== a.dims[k])) {
      return `the used area changed ${where}`;
    }
    for (const [k, cell] of b.cells) {
      if (edited && expected.has(k)) continue;
      const got = a.cells.get(k);
      if (!got || got.v !== cell.v || got.s !== cell.s) return `a cell changed that should not have ${where} (${k.replace(":", ",")})`;
    }
    for (const k of a.cells.keys()) {
      if (!b.cells.has(k) && !(edited && expected.has(k))) return `an unexpected cell appeared ${where}`;
    }
    if (edited) {
      for (const [k, p] of expected) {
        if (!expectedMatches(a.cells.get(k), p)) return `a new value did not save correctly ${where} (${k.replace(":", ",")})`;
      }
    }
  }
  return null;
}

/** Re-opens bytes on disk and checks them against the original. Used after the file is written. */
export async function verifyWrittenXlsx(original: Buffer, written: Buffer, edit: XlsxEdit): Promise<string | null> {
  const beforeWb = await loadBook(original);
  const ws = findSheet(beforeWb, edit.sheet);
  const { cells, appended } = plan(edit, ws);
  const before = snapBook(beforeWb);
  const expected = expectedCells(cells, appended);
  try {
    return verifyXlsxChange(before, snapBook(await loadBook(written)), ws.name, expected);
  } catch {
    return "the saved file could not be opened again";
  }
}

function expectedCells(
  cells: Planned[],
  appended: { header: string; col: number; values: (string | number | null)[] }[],
): Map<string, { value: string | number | null; formula?: string | undefined }> {
  const expected = new Map<string, { value: string | number | null; formula?: string | undefined }>();
  for (const c of cells) expected.set(key(c.row, c.col), { value: c.value, formula: c.formula });
  for (const a of appended) {
    expected.set(key(1, a.col), { value: a.header });
    a.values.forEach((v, i) => expected.set(key(i + 2, a.col), { value: v }));
  }
  return expected;
}

export async function applyXlsxEdit(bytes: Buffer, edit: XlsxEdit, fileName: string): Promise<EditResult> {
  if (!/\.(xlsx|xlsm|xltm|xlam)$/i.test(fileName)) {
    throw new EditError(`${fileName} is not an .xlsx file. NONON edits .xlsx and .csv spreadsheets.`, { suggestion: XLSX_SUGGESTION, unsupported: true });
  }
  await assertXlsxSupported(bytes, fileName);

  let wb: ExcelJS.Workbook;
  try {
    wb = await loadBook(bytes);
  } catch {
    throw new EditError(`${fileName} could not be opened as a spreadsheet, so NONON did not change it.`, { unsupported: true });
  }
  const ws = findSheet(wb, edit.sheet);
  const { cells, appended } = plan(edit, ws);
  const before = snapBook(wb);

  const notes: string[] = [];
  let formulaCount = 0;
  let missing = 0;
  for (const sheet of wb.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.type !== ExcelJS.ValueType.Formula) return;
        formulaCount++;
        if (sheet === ws && (cell.value as { result?: unknown }).result === undefined) missing++;
      });
    });
  }

  for (const c of cells) {
    const cell = ws.getCell(c.row, c.col);
    cell.value = c.formula !== undefined ? { formula: c.formula, result: (c.value ?? undefined) as never } : c.value;
  }
  for (const a of appended) {
    const head = ws.getCell(1, a.col);
    head.value = a.header;
    const left = ws.getCell(1, a.col - 1);
    if (left.style && Object.keys(left.style).length > 0) head.style = JSON.parse(JSON.stringify(left.style)) as Partial<ExcelJS.Style>;
    a.values.forEach((v, i) => {
      ws.getCell(i + 2, a.col).value = v;
    });
  }

  if (missing > 0) {
    notes.push(`${missing} formula${missing === 1 ? "" : "s"} on "${ws.name}" ${missing === 1 ? "has" : "have"} no saved result, so numbers that depend on them may read as blank until the file is opened and saved in Excel.`);
  }
  if (formulaCount > 0) {
    wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };
    notes.push("This workbook has formulas. They recalculate when you open it in Excel, so saved results may look old until then.");
  }

  // exceljs treats a width of exactly 9 as "no custom width" and drops it, so nudge those by an invisible amount.
  for (const sheet of wb.worksheets) for (const col of sheet.columns ?? []) if (col.width === 9) col.width = 9.00001;

  const out = Buffer.from(await wb.xlsx.writeBuffer());
  const afterWb = await loadBook(out);
  const afterSnap = snapBook(afterWb);
  const problem = verifyXlsxChange(before, afterSnap, ws.name, expectedCells(cells, appended));
  if (problem) {
    throw new EditError(`NONON checked the saved spreadsheet and found a problem (${problem}), so it did not change your file.`, {
      suggestion: XLSX_SUGGESTION,
      unsupported: true,
    });
  }

  const beforeSheet = before.sheets.find((s) => s.name === ws.name)!;
  const afterSheet = afterSnap.sheets.find((s) => s.name === ws.name)!;
  const touched = [...expectedCells(cells, appended).keys()].map((k) => {
    const [r, c] = k.split(":").map(Number) as [number, number];
    return { row: r - 1, col: c - 1 };
  });
  const preview = gridPreview({
    title: `${fileName}, sheet "${ws.name}": ${touched.length} cell${touched.length === 1 ? "" : "s"} changed`,
    getBefore: (r, c) => beforeSheet.cells.get(key(r + 1, c + 1))?.t ?? "",
    getAfter: (r, c) => afterSheet.cells.get(key(r + 1, c + 1))?.t ?? "",
    edited: touched,
    rowCount: afterWbRowCount(afterWb, ws.name),
  });
  return { bytes: out, notes, preview };
}

function afterWbRowCount(wb: ExcelJS.Workbook, name: string): number {
  return wb.getWorksheet(name)?.rowCount ?? 0;
}
