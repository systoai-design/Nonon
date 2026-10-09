import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export type DocKind = "txt" | "md" | "docx" | "pdf";

/** Text of one input file with stable 1-based line numbers, so every claim can cite `file:line`. */
export interface SourceDoc {
  path: string;
  name: string;
  kind: DocKind;
  lines: string[];
  /** Page of each line for PDFs (same length as `lines`). */
  linePage?: number[];
  pageCount?: number;
  warnings: string[];
}

export type ExtractResult = { ok: true; doc: SourceDoc } | { ok: false; reason: string };

export const DOC_EXTENSIONS = [".txt", ".md", ".docx", ".pdf"] as const;
const MAX_BYTES = 25 * 1024 * 1024;
/** Average characters per page below which a PDF is treated as scanned images. */
const MIN_CHARS_PER_PAGE = 25;

export function docFromText(name: string, text: string, kind: DocKind = "txt", path = name): SourceDoc {
  return { path, name, kind, lines: text.split(/\r\n|\r|\n/), warnings: [] };
}

export function docText(doc: SourceDoc): string {
  return doc.lines.join("\n");
}

/** `file:line` (plus the page for PDFs). */
export function cite(doc: SourceDoc, line: number): string {
  const page = doc.linePage?.[line - 1];
  return page ? `${doc.name}:${line} (page ${page})` : `${doc.name}:${line}`;
}

function decodeText(buf: Buffer): string | null {
  let b = buf;
  let enc: "utf-8" | "utf-16le" = "utf-8";
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  else if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    b = b.subarray(2);
    enc = "utf-16le";
  }
  const text = new TextDecoder(enc).decode(b);
  if (enc === "utf-8") {
    const sample = text.slice(0, 4000);
    const bad = (sample.match(/[\u0000�]/g) ?? []).length;
    if (sample.length > 0 && bad / sample.length > 0.02) return null;
  }
  return text;
}

export async function extractDocument(path: string): Promise<ExtractResult> {
  const name = basename(path);
  const ext = extname(path).toLowerCase();
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return { ok: false, reason: `${name} could not be opened. It may have been moved or deleted.` };
  }
  if (size > MAX_BYTES) return { ok: false, reason: `${name} is larger than 25 MB, which is too big for NONON to read. Try a smaller file or split it into parts.` };
  if (size === 0) return { ok: false, reason: `${name} is empty.` };

  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch {
    return { ok: false, reason: `${name} could not be read. It may be open in another program or protected.` };
  }

  if (ext === ".txt" || ext === ".md" || ext === ".markdown") {
    const text = decodeText(buf);
    if (text === null) return { ok: false, reason: `${name} does not look like a plain text file. Save it as a .txt or .docx file and try again.` };
    const doc = docFromText(name, text, ext === ".txt" ? "txt" : "md", path);
    while (doc.lines.length > 1 && doc.lines[doc.lines.length - 1]?.trim() === "") doc.lines.pop();
    if (!doc.lines.some((l) => l.trim())) return { ok: false, reason: `${name} has no text in it.` };
    return { ok: true, doc };
  }

  if (ext === ".docx") {
    try {
      const res = await mammoth.extractRawText({ buffer: buf });
      const lines = res.value
        .split(/\r\n|\r|\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length === 0) return { ok: false, reason: `${name} has no readable text. Text inside pictures is not read.` };
      return { ok: true, doc: { path, name, kind: "docx", lines, warnings: res.messages.map((m) => m.message).slice(0, 5) } };
    } catch {
      return { ok: false, reason: `${name} is not a Word (.docx) file that NONON can open. Older .doc files do not work. Open it in Word and save a copy as .docx.` };
    }
  }

  if (ext === ".pdf") {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text: pages, totalPages } = await extractText(pdf, { mergePages: false });
      const lines: string[] = [];
      const linePage: number[] = [];
      pages.forEach((pageText, i) => {
        for (const raw of pageText.split(/\r\n|\r|\n/)) {
          const l = raw.trim();
          if (l) {
            lines.push(l);
            linePage.push(i + 1);
          }
        }
      });
      const chars = lines.reduce((n, l) => n + l.length, 0);
      if (chars / Math.max(1, totalPages) < MIN_CHARS_PER_PAGE) {
        return {
          ok: false,
          reason: `${name} looks like a scan or a photo of pages, so there is no text to read. NONON cannot read scanned PDFs yet. Save or export a copy that has real text, then try again.`,
        };
      }
      return { ok: true, doc: { path, name, kind: "pdf", lines, linePage, pageCount: totalPages, warnings: [] } };
    } catch (e) {
      const msg = e instanceof Error ? `${e.name} ${e.message}` : "";
      if (/password/i.test(msg)) return { ok: false, reason: `${name} is password protected. Remove the password and try again.` };
      return { ok: false, reason: `${name} could not be read as a PDF. It may be damaged.` };
    }
  }

  return { ok: false, reason: `${name} is a ${ext || "unknown"} file. NONON reads .txt, .md, .docx and PDF files that have real text.` };
}

/** Extract several files; failures are returned with reasons so the caller can say exactly which file failed. */
export async function extractMany(paths: string[]): Promise<{ docs: SourceDoc[]; failures: { path: string; reason: string }[] }> {
  const docs: SourceDoc[] = [];
  const failures: { path: string; reason: string }[] = [];
  for (const p of paths) {
    const r = await extractDocument(p);
    if (r.ok) docs.push(r.doc);
    else failures.push({ path: p, reason: r.reason });
  }
  return { docs, failures };
}
