import { open, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import Papa from "papaparse";
import type { OutputPreview, PreviewSheet, Workspace } from "../../shared/contracts";
import { UserError } from "./core/errors";
import { isInside } from "./fs-util";

/** Reads the files NONON made so the Results viewer can show them in the app. Pure Node: no Electron. */

export const MAX_TEXT_BYTES = 200 * 1024;
export const MAX_SHEET_ROWS = 200;
export const MAX_SHEET_COLS = 20;
const MAX_BINARY_FILE = 25 * 1024 * 1024;
const MAX_CSV_FILE = 20 * 1024 * 1024;
const MAX_CELL_CHARS = 500;

const OPEN_INSTEAD = "NONON could not show this one here. Use Open document to see it in its own app.";

interface WorkspaceLookup {
  list(): Pick<Workspace, "folder">[];
}

/** Resolves symlinks and junctions, then requires the real file to sit inside an approved workspace folder. */
async function resolveApproved(workspaces: WorkspaceLookup, path: string): Promise<string> {
  if (typeof path !== "string" || path.trim() === "" || !isAbsolute(path)) throw new UserError("That file is outside your project folders, so NONON will not open it.");
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    throw new UserError("NONON could not find that file. It may have been moved or deleted.");
  }
  let inside = false;
  for (const w of workspaces.list()) {
    if (!w.folder) continue;
    try {
      if (isInside(await realpath(w.folder), real)) {
        inside = true;
        break;
      }
    } catch {
      /* a workspace whose folder is gone cannot approve anything */
    }
  }
  if (!inside) throw new UserError("That file is outside your project folders, so NONON will not open it.");
  const s = await stat(real);
  if (!s.isFile()) throw new UserError("That is a folder, not a file.");
  return real;
}

async function readHead(path: string, maxBytes: number): Promise<{ buf: Buffer; size: number }> {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const buf = Buffer.alloc(Math.min(size, maxBytes + 1));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return { buf: buf.subarray(0, bytesRead), size };
  } finally {
    await fh.close();
  }
}

function clipText(text: string, truncated: boolean): { text: string; truncated: boolean } {
  if (!truncated) return { text, truncated };
  // Cut at a line end so the preview never stops in the middle of a word or a table row.
  const cut = text.lastIndexOf("\n");
  return { text: cut > text.length * 0.8 ? text.slice(0, cut) : text, truncated };
}

function decodeUtf8(buf: Buffer, truncated: boolean): string {
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // A multi-byte character split by the byte cap decodes to U+FFFD at the very end.
  if (truncated) text = text.replace(/�+$/, "");
  return text;
}

async function previewText(path: string, kind: "markdown" | "text", pretty: boolean): Promise<OutputPreview> {
  const { buf, size } = await readHead(path, MAX_TEXT_BYTES);
  if (buf.subarray(0, 4096).includes(0)) return { kind: "unsupported", reason: "This file is not plain text, so it cannot be shown here. Use Open document." };
  const truncated = size > MAX_TEXT_BYTES;
  let text = decodeUtf8(buf.subarray(0, MAX_TEXT_BYTES), truncated);
  if (pretty && !truncated) {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* show it as written */
    }
  }
  const clipped = clipText(text.length > 0 ? text : "", truncated);
  return { kind, text: clipped.text, truncated: clipped.truncated, bytes: size };
}

// ---------------------------------------------------------------- tables

function clampRows(maxRows: number | undefined): number {
  const n = Math.floor(Number(maxRows));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_SHEET_ROWS) : MAX_SHEET_ROWS;
}

function shortCell(s: string): string {
  return s.length > MAX_CELL_CHARS ? `${s.slice(0, MAX_CELL_CHARS)}…` : s;
}

function finishSheet(name: string, all: string[][], maxRows: number): PreviewSheet {
  const nonEmpty = (r: string[]) => r.some((c) => c.trim() !== "");
  let end = all.length;
  while (end > 0 && !nonEmpty(all[end - 1] ?? [])) end--;
  const rows = all.slice(0, end);
  const totalCols = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const width = Math.min(totalCols, MAX_SHEET_COLS);
  const totalRows = Math.max(0, rows.length - 1);
  const shown = rows.slice(0, maxRows + 1).map((r) => Array.from({ length: width }, (_, i) => shortCell(r[i] ?? "")));
  return { name, rows: shown, totalRows, totalCols, truncated: totalRows > maxRows || totalCols > MAX_SHEET_COLS };
}

async function previewCsv(path: string, maxRows: number): Promise<OutputPreview> {
  if ((await stat(path)).size > MAX_CSV_FILE) return { kind: "unsupported", reason: "This table is too large to show here. Use Open document." };
  const parsed = Papa.parse<string[]>(decodeUtf8(await readFile(path), false), { skipEmptyLines: "greedy" });
  const rows = parsed.data.filter((r): r is string[] => Array.isArray(r)).map((r) => r.map((c) => String(c ?? "")));
  const sheet = finishSheet(basename(path), rows, maxRows);
  return { kind: "table", sheets: [sheet] };
}

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Formats a number the way its Excel number format would show it, for the formats NONON writes and the common ones people use. */
export function formatNumber(v: number, numFmt: string | undefined): string {
  if (!Number.isFinite(v)) return String(v);
  const section = (numFmt ?? "General").split(";")[0] ?? "General";
  if (section === "General" || section === "@") return String(Number(v.toPrecision(12)));
  const pct = section.includes("%");
  const dec = /0\.(0+)/.exec(section)?.[1]?.length ?? 0;
  if (!/[0#]/.test(section)) return String(Number(v.toPrecision(12)));
  const x = pct ? v * 100 : v;
  const [int = "0", frac] = Math.abs(x).toFixed(dec).split(".");
  const grouped = section.includes(",") ? groupDigits(int) : int;
  const sign = x < 0 && Number(Math.abs(x).toFixed(dec)) !== 0 ? "-" : "";
  const symbol = section.includes("$") ? "$" : "";
  return `${sign}${symbol}${grouped}${frac ? `.${frac}` : ""}${pct ? "%" : ""}`;
}

function formatDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  const iso = d.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** Values only: a formula shows its cached result, never the formula. */
function cellToText(value: unknown, numFmt: string | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatNumber(value, numFmt);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ("result" in o) return cellToText(o.result, numFmt);
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    if ("text" in o) return cellToText(o.text, numFmt);
    if ("error" in o) return String(o.error);
  }
  return "";
}

async function previewXlsx(path: string, maxRows: number): Promise<OutputPreview> {
  if ((await stat(path)).size > MAX_BINARY_FILE) return { kind: "unsupported", reason: "This spreadsheet is too large to show here. Use Open document." };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await readFile(path)) as unknown as ArrayBuffer);
  const sheets: PreviewSheet[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== "visible") continue;
    const last = Math.min(ws.rowCount, maxRows + 1);
    const cols = Math.min(Math.max(ws.columnCount, 0), MAX_SHEET_COLS);
    const rows: string[][] = [];
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r);
      rows.push(
        Array.from({ length: cols }, (_, i) => {
          const cell = row.getCell(i + 1);
          return cellToText(cell.value, cell.numFmt);
        }),
      );
    }
    const sheet = finishSheet(ws.name, rows, maxRows);
    // The row and column counts come from the sheet itself, since only a window of it was read.
    sheets.push({ ...sheet, totalRows: Math.max(0, ws.rowCount - 1), totalCols: ws.columnCount, truncated: ws.rowCount - 1 > maxRows || ws.columnCount > MAX_SHEET_COLS });
  }
  if (sheets.length === 0) return { kind: "unsupported", reason: "This spreadsheet has no sheets that can be shown." };
  return { kind: "table", sheets };
}

// ---------------------------------------------------------------- docx

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

interface HNode {
  tag: string;
  children: (HNode | string)[];
}

function parseHtml(html: string): HNode {
  const root: HNode = { tag: "root", children: [] };
  const stack: HNode[] = [root];
  const VOID = new Set(["br", "img", "hr"]);
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*?(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const top = stack[stack.length - 1] as HNode;
    if (m[4] !== undefined) {
      top.children.push(decodeEntities(m[4]));
      continue;
    }
    const tag = (m[2] ?? "").toLowerCase();
    if (m[1] === "/") {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
    } else if (VOID.has(tag) || m[3] === "/") {
      top.children.push({ tag, children: [] });
    } else {
      const node: HNode = { tag, children: [] };
      top.children.push(node);
      stack.push(node);
    }
  }
  return root;
}

function inlineMd(nodes: (HNode | string)[]): string {
  let out = "";
  for (const n of nodes) {
    if (typeof n === "string") {
      out += n.replace(/\s+/g, " ");
      continue;
    }
    const inner = inlineMd(n.children);
    if (n.tag === "br") out += " ";
    else if (n.tag === "strong" || n.tag === "b") out += inner.trim() ? wrapKeepingSpace(inner, "**") : inner;
    else if (n.tag === "em" || n.tag === "i") out += inner.trim() ? wrapKeepingSpace(inner, "*") : inner;
    else if (n.tag === "mark") out += inner.trim() ? wrapKeepingSpace(inner, "==") : inner;
    else if (n.tag === "img") continue;
    else out += inner;
  }
  return out;
}

function wrapKeepingSpace(s: string, mark: string): string {
  const core = s.trim();
  const at = s.indexOf(core);
  return s.slice(0, at) + mark + core + mark + s.slice(at + core.length);
}

function listMd(node: HNode, depth: number): string[] {
  const lines: string[] = [];
  let n = 0;
  for (const li of node.children) {
    if (typeof li === "string" || li.tag !== "li") continue;
    n++;
    const nested = li.children.filter((c): c is HNode => typeof c !== "string" && (c.tag === "ul" || c.tag === "ol"));
    const own = li.children.filter((c) => typeof c === "string" || (c.tag !== "ul" && c.tag !== "ol"));
    lines.push(`${"  ".repeat(depth)}${node.tag === "ol" ? `${n}.` : "-"} ${inlineMd(own).trim()}`);
    for (const sub of nested) lines.push(...listMd(sub, depth + 1));
  }
  return lines;
}

function tableMd(node: HNode): string {
  const rows: string[][] = [];
  const walk = (n: HNode) => {
    for (const c of n.children) {
      if (typeof c === "string") continue;
      if (c.tag === "tr") {
        rows.push(c.children.filter((x): x is HNode => typeof x !== "string" && (x.tag === "td" || x.tag === "th")).map((cell) => inlineMd(cell.children).trim().replace(/\|/g, "\\|")));
      } else walk(c);
    }
  };
  walk(node);
  if (rows.length === 0) return "";
  const width = rows.reduce((w, r) => Math.max(w, r.length), 1);
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");
  const [head = [], ...body] = rows;
  return [
    `| ${pad(head).join(" | ")} |`,
    `| ${pad(head)
      .map(() => "---")
      .join(" | ")} |`,
    ...body.map((r) => `| ${pad(r).join(" | ")} |`),
  ].join("\n");
}

function blocksMd(nodes: (HNode | string)[], out: string[]): void {
  for (const n of nodes) {
    if (typeof n === "string") {
      if (n.trim()) out.push(n.trim());
      continue;
    }
    if (/^h[1-6]$/.test(n.tag)) out.push(`${"#".repeat(Number(n.tag[1]))} ${inlineMd(n.children).trim()}`);
    else if (n.tag === "p") {
      const t = inlineMd(n.children).trim();
      if (t) out.push(/^(#{1,6}\s|[-*+]\s|\d+\.\s|>)/.test(t) ? `\\${t}` : t);
    } else if (n.tag === "ul" || n.tag === "ol") out.push(listMd(n, 0).join("\n"));
    else if (n.tag === "table") {
      const t = tableMd(n);
      if (t) out.push(t);
    } else if (n.tag === "blockquote") {
      const inner: string[] = [];
      blocksMd(n.children, inner);
      out.push(
        inner
          .join("\n\n")
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n"),
      );
    } else blocksMd(n.children, out);
  }
}

export function htmlToMarkdown(html: string): string {
  const out: string[] = [];
  blocksMd(parseHtml(html).children, out);
  return `${out.filter((b) => b.trim() !== "").join("\n\n")}\n`;
}

async function previewDocx(path: string): Promise<OutputPreview> {
  const size = (await stat(path)).size;
  if (size > MAX_BINARY_FILE) return { kind: "unsupported", reason: "This document is too large to show here. Use Open document." };
  const buf = await readFile(path);
  let text = "";
  try {
    // convertToHtml (not mammoth's convertToMarkdown) because only the HTML route keeps tables.
    const html = await mammoth.convertToHtml({ buffer: buf }, { styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Heading 1'] => h2:fresh", "p[style-name='Heading 2'] => h3:fresh", "p[style-name='Heading 3'] => h4:fresh", "highlight => mark"] });
    text = htmlToMarkdown(html.value);
  } catch {
    text = "";
  }
  if (text.trim() === "") {
    const raw = await mammoth.extractRawText({ buffer: buf });
    text = raw.value.trim();
    if (text === "") return { kind: "unsupported", reason: "This document has no text that can be shown here. Use Open document." };
  }
  const truncated = text.length > MAX_TEXT_BYTES;
  const clipped = clipText(truncated ? text.slice(0, MAX_TEXT_BYTES) : text, truncated);
  return { kind: "markdown", text: clipped.text, truncated: clipped.truncated, bytes: size };
}

// ---------------------------------------------------------------- entry point

export async function previewOutput(workspaces: WorkspaceLookup, path: string, maxRows?: number): Promise<OutputPreview> {
  const real = await resolveApproved(workspaces, path);
  const ext = extname(real).toLowerCase();
  const rows = clampRows(maxRows);
  try {
    switch (ext) {
      case ".md":
      case ".markdown":
        return await previewText(real, "markdown", false);
      case ".txt":
        return await previewText(real, "text", false);
      case ".json":
        return await previewText(real, "text", true);
      case ".csv":
        return await previewCsv(real, rows);
      case ".xlsx":
        return await previewXlsx(real, rows);
      case ".docx":
        return await previewDocx(real);
      default:
        return { kind: "unsupported", reason: `${ext ? `A ${ext} file` : "This kind of file"} cannot be shown here. Use Open document to see it in its own app.` };
    }
  } catch {
    return { kind: "unsupported", reason: OPEN_INSTEAD };
  }
}
