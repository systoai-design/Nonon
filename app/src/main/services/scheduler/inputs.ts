import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { FileFingerprint, Routine } from "../../../shared/contracts";

type PickRule = Routine["inputScope"]["pick"][string];

export function normalizeExtension(ext: string): string {
  const e = ext.trim().toLowerCase();
  return e.startsWith(".") ? e : `.${e}`;
}

/** Newest-first files in `folder` (not recursive) that match the rule, after skipping `rule.skip` newer ones. Office lock files and dotfiles are never inputs. */
export async function pickFiles(folder: string, rule: PickRule): Promise<{ path: string; mtimeMs: number }[]> {
  const extensions = rule.extensions.map(normalizeExtension);
  const needle = rule.nameContains?.trim().toLowerCase();
  const entries = await readdir(folder, { withFileTypes: true });
  const found: { path: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".") || entry.name.startsWith("~$")) continue;
    if (extensions.length > 0 && !extensions.includes(extname(entry.name).toLowerCase())) continue;
    if (needle && !entry.name.toLowerCase().includes(needle)) continue;
    const full = join(folder, entry.name);
    const info = await stat(full);
    found.push({ path: full, mtimeMs: info.mtimeMs });
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  const skip = Math.max(0, rule.skip ?? 0);
  return found.slice(skip, skip + Math.max(1, rule.newest));
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function fingerprint(path: string): Promise<FileFingerprint> {
  const info = await stat(path);
  return { path, size: info.size, mtimeMs: info.mtimeMs, sha256: await sha256File(path) };
}

/** Same files with the same content. mtime is ignored on purpose: a re-save with identical bytes is not new work. */
export function sameInputs(a: FileFingerprint[], b: FileFingerprint[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const key = (f: FileFingerprint) => `${f.path}|${f.sha256}`;
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.every((k, i) => k === right[i]);
}
