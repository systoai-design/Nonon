import Papa from "papaparse";
import type { ChangeEdit, ChangePreview } from "../../../shared/contracts";
import { EditError } from "./errors";
import { gridPreview } from "./preview";

export type CsvEdit = Extract<ChangeEdit, { op: "csv-set-cells" }>;

export interface EditResult {
  bytes: Buffer;
  /** Things worth a warning, not a refusal. */
  notes: string[];
  preview: ChangePreview;
}

function decodeUtf8(bytes: Buffer): { text: string; bom: boolean } {
  const b0 = bytes[0];
  const b1 = bytes[1];
  if ((b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff)) {
    throw new EditError("This CSV is saved as UTF-16, which NONON cannot edit without risking the text.", {
      suggestion: "Open it in Excel, use Save As > CSV UTF-8, then try again.",
      unsupported: true,
    });
  }
  const bom = b0 === 0xef && b1 === 0xbb && bytes[2] === 0xbf;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bom ? bytes.subarray(3) : bytes);
    if (text.includes("\u0000")) throw new Error("nul");
    return { text, bom };
  } catch {
    throw new EditError("This file is not saved as UTF-8 text, so NONON cannot edit it without risking the text.", {
      suggestion: "Open it in Excel, use Save As > CSV UTF-8, then try again.",
      unsupported: true,
    });
  }
}

type Eol = "\r\n" | "\n" | "\r";

function detectEol(text: string): { eol: Eol; mixed: boolean } {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  const cr = (text.match(/\r(?!\n)/g) ?? []).length;
  const kinds = [crlf, lf, cr].filter((n) => n > 0).length;
  const eol = crlf >= lf && crlf >= cr && crlf > 0 ? "\r\n" : lf >= cr && lf > 0 ? "\n" : cr > 0 ? "\r" : "\n";
  return { eol, mixed: kinds > 1 };
}

function parseGrid(core: string, eol: Eol, forcedDelimiter: string | undefined): { rows: string[][]; delimiter: string } {
  const res = Papa.parse<string[]>(core, {
    delimiter: forcedDelimiter ?? "",
    delimitersToGuess: [",", "\t", ";", "|"],
    newline: eol,
    skipEmptyLines: false,
  });
  if (res.errors.some((e) => e.type === "Quotes")) {
    throw new EditError("This CSV has a quotation mark that is never closed, so NONON cannot tell where cells end.", { unsupported: true });
  }
  return { rows: res.data, delimiter: res.meta.delimiter || forcedDelimiter || "," };
}

const width = (rows: string[][]): number => rows.reduce((m, r) => Math.max(m, r.length), 0);

export function applyCsvEdit(bytes: Buffer, edit: CsvEdit, fileName: string): EditResult {
  const { text, bom } = decodeUtf8(bytes);
  const trailing = /(\r\n|\n|\r)$/.exec(text)?.[0] ?? "";
  let core = trailing ? text.slice(0, text.length - trailing.length) : text;
  const { eol, mixed } = detectEol(core);
  const notes: string[] = [];
  if (mixed) {
    core = core.replace(/\r\n|\r|\n/g, eol);
    notes.push("The file mixed line-ending styles; they will be made consistent.");
  }
  const { rows, delimiter } = parseGrid(core, eol, /\.tsv$/i.test(fileName) ? "\t" : undefined);
  const before = rows.map((r) => [...r]);
  if (core === "" || rows.length === 0) throw new EditError("This CSV file is empty, so there is nothing to change.");

  const w = width(rows);
  const seen = new Set<string>();
  const edited: { row: number; col: number }[] = [];
  for (const c of edit.cells) {
    if (!Number.isInteger(c.row) || !Number.isInteger(c.col) || c.row < 0 || c.col < 0) {
      throw new EditError(`Row ${c.row}, column ${c.col} is not a valid cell position.`);
    }
    if (c.row >= rows.length) throw new EditError(`Row ${c.row + 1} is past the end of ${fileName}, which has ${rows.length} rows.`);
    if (c.col >= w) throw new EditError(`Column ${c.col + 1} is past the end of ${fileName}, which has ${w} columns.`);
    if (typeof c.value !== "string") throw new EditError(`The new value for row ${c.row + 1}, column ${c.col + 1} must be text.`);
    const key = `${c.row}:${c.col}`;
    if (seen.has(key)) throw new EditError(`Row ${c.row + 1}, column ${c.col + 1} is listed twice with possibly different values.`);
    seen.add(key);
    if (/^[=@]/.test(c.value)) notes.push(`"${c.value.slice(0, 20)}" starts like a formula and may be treated as one when opened in Excel.`);
    const row = rows[c.row]!;
    while (row.length <= c.col) row.push("");
    row[c.col] = c.value;
    edited.push({ row: c.row, col: c.col });
  }

  const dataRows = rows.length - 1;
  edit.appendColumns?.forEach((col, k) => {
    if (col.values.length > dataRows) {
      throw new EditError(`The new column "${col.header}" has ${col.values.length} values but ${fileName} only has ${dataRows} data rows.`);
    }
    if (rows[0]!.includes(col.header)) notes.push(`${fileName} already has a column named "${col.header}".`);
    const at = w + k;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      while (row.length < at) row.push("");
      row[at] = r === 0 ? col.header : (col.values[r - 1] ?? "");
      edited.push({ row: r, col: at });
    }
  });

  const body = Papa.unparse(rows, { delimiter, newline: eol, quotes: false, skipEmptyLines: false });
  const out = Buffer.from(`${bom ? "\uFEFF" : ""}${body}${trailing ? eol : ""}`, "utf8");

  const check = parseGrid(body, eol, delimiter);
  if (check.rows.length !== rows.length || check.rows.some((r, i) => r.length !== rows[i]!.length || r.some((v, j) => v !== rows[i]![j]))) {
    throw new EditError("NONON could not write this CSV back without altering other cells, so it did not change anything.", { unsupported: true });
  }

  const after = rows;
  const preview = gridPreview({
    title: `${fileName}: ${edited.length} cell${edited.length === 1 ? "" : "s"} changed`,
    getBefore: (r, c) => before[r]?.[c] ?? "",
    getAfter: (r, c) => after[r]?.[c] ?? "",
    edited,
    rowCount: rows.length,
  });
  return { bytes: out, notes, preview };
}
