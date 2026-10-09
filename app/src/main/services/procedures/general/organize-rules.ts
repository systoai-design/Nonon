import { existsSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

/** Deterministic part of folder organisation: categories, names and the safety rules every move must pass. */

export type GroupBy = "type" | "type-year";

const EXT_CATEGORY: Record<string, string> = {};
const add = (cat: string, exts: string) => exts.split(" ").forEach((e) => (EXT_CATEGORY[`.${e}`] = cat));
add("Images", "jpg jpeg png gif webp heic bmp tif tiff svg");
add("Documents", "doc docx odt rtf txt md pdf pages");
add("Spreadsheets", "xls xlsx csv ods numbers");
add("Presentations", "ppt pptx key odp");
add("Audio", "mp3 wav m4a flac aac ogg");
add("Video", "mp4 mov avi mkv webm m4v");
add("Archives", "zip rar 7z tar gz");
add("Installers", "exe msi dmg pkg");

export const RESERVED_NAMES = new Set(["sorted", "nonon output", "samples", "possible duplicates", "con", "prn", "aux", "nul"]);
export const DUPLICATES = "Possible duplicates";

export interface Classified {
  category: string;
  /** False when only the file type was known and the name gives no hint (generic documents, unknown types). */
  confident: boolean;
  reason: string;
}

const NAME_RULES: { re: RegExp; category: string; exts?: RegExp }[] = [
  { re: /\b(?:invoice|inv[-_ ]?\d+|receipt|bill|statement)\b/i, category: "Invoices", exts: /^\.(?:pdf|docx?|xlsx?|csv|txt|jpe?g|png|heic)$/ },
  { re: /\b(?:screenshot|screen shot|screen capture)\b/i, category: "Screenshots", exts: /^\.(?:png|jpe?g|webp|heic)$/ },
  { re: /\b(?:contract|agreement|nda|lease)\b/i, category: "Contracts", exts: /^\.(?:pdf|docx?|txt|rtf|odt)$/ },
];

export function classifyByRules(name: string): Classified {
  const ext = extname(name).toLowerCase();
  const stem = basename(name, extname(name)).replace(/[_]+/g, " ");
  for (const r of NAME_RULES) {
    if (r.re.test(stem) && (!r.exts || r.exts.test(ext))) {
      return { category: r.category, confident: true, reason: `${ext || "file"} with "${r.re.exec(stem)?.[0]?.toLowerCase()}" in the name` };
    }
  }
  const byExt = EXT_CATEGORY[ext];
  if (!byExt) return { category: "Other", confident: false, reason: ext ? `${ext} files have no fixed folder` : "no file type" };
  if (byExt === "Documents") return { category: "Documents", confident: false, reason: `${ext} document` };
  return { category: byExt, confident: true, reason: `${ext} file` };
}

const DATE_FULL = /(?<!\d)((?:19|20)\d{2})[-_. ]?(0[1-9]|1[0-2])[-_. ]?(0[1-9]|[12]\d|3[01])(?!\d)/;
const YEAR_ONLY = /(?<!\d)((?:19|20)\d{2})(?!\d)/;

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** A date written in the file name, if any. */
export function dateInName(name: string): { year: number; iso?: string } | null {
  const stem = basename(name, extname(name));
  const full = DATE_FULL.exec(stem);
  if (full && validDate(+full[1]!, +full[2]!, +full[3]!)) return { year: +full[1]!, iso: `${full[1]}-${full[2]}-${full[3]}` };
  const y = YEAR_ONLY.exec(stem);
  return y ? { year: +y[1]! } : null;
}

/** Tidy a file name without changing what it says: lower-case extension, one space between words, ISO dates. */
export function normaliseName(name: string): string {
  const ext = extname(name);
  let stem = basename(name, ext);
  stem = stem.replace(/^\s*copy of\s+/i, "");
  stem = stem.replace(/(?<!\d)((?:19|20)\d{2})[_.](0[1-9]|1[0-2])[_.](0[1-9]|[12]\d|3[01])(?!\d)/g, "$1-$2-$3");
  stem = stem.replace(/(?<!\d)((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g, (m, y: string, mo: string, d: string) => (validDate(+y, +mo, +d) ? `${y}-${mo}-${d}` : m));
  stem = stem.replace(/_+/g, " ").replace(/\s+/g, " ").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").trim().replace(/[. ]+$/, "");
  if (!stem) stem = "File";
  if (stem.length > 120) stem = stem.slice(0, 120).trim();
  return `${stem}${ext.toLowerCase()}`;
}

/** Category names come from the model or from rules and become folder names, so they are strictly cleaned. */
export function cleanCategory(raw: string): string | null {
  if (/[\\/:*?"<>|]|\.\./.test(raw)) return null;
  const t = raw.replace(/\s+/g, " ").trim().replace(/^\W+|\W+$/g, "");
  if (!/^[A-Za-z][A-Za-z0-9 &'-]{1,28}$/.test(t)) return null;
  if (RESERVED_NAMES.has(t.toLowerCase())) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export interface MoveCheckInput {
  folder: string;
  from: string;
  to: string;
  /** Lower-cased absolute paths already claimed by earlier moves in this plan. */
  claimed: Set<string>;
  exists?: (p: string) => boolean;
}

function inside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== "" && !rel.startsWith("..") && resolve(parent, rel) === resolve(child) && !rel.split(sep).includes("..");
}

/**
 * Every proposed move passes through here. Returns a plain-language reason to refuse, or null when it is safe.
 * Refuses: leaving the workspace folder, overwriting anything (on disk or earlier in this plan), moving a file
 * out of a folder the user organised themselves (flattening), and moves that change nothing.
 */
export function refuseMove({ folder, from, to, claimed, exists = existsSync }: MoveCheckInput): string | null {
  const root = resolve(folder);
  const f = resolve(from);
  const t = resolve(to);
  if (!inside(root, f)) return "the file is outside the project's folder";
  if (!inside(root, t)) return "the new location would be outside the project's folder";
  if (f.toLowerCase() === t.toLowerCase()) {
    return f === t ? "nothing would change" : null;
  }
  const origin = dirname(f);
  if (origin !== root && origin !== join(root, "Samples")) return "it sits inside one of your own folders, and moving it would empty that folder out";
  if (!exists(f)) return "the file no longer exists";
  if (exists(t)) return "a file with that name already exists at the new location";
  if (claimed.has(t.toLowerCase())) return "another file in this plan is already going to that exact location";
  if (t.length > 240) return "the new path would be too long for Windows";
  return null;
}
