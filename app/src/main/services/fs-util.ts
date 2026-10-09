import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import type { FileFingerprint } from "../../shared/contracts";

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((ok, fail) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => ok())
      .on("error", fail);
  });
  return hash.digest("hex");
}

export async function fingerprint(path: string): Promise<FileFingerprint> {
  const s = await stat(path);
  return { path: resolve(path), size: s.size, mtimeMs: s.mtimeMs, sha256: await sha256File(path) };
}

export function sameFingerprint(a: FileFingerprint | null, b: FileFingerprint | null): boolean {
  if (!a || !b) return a === b;
  return a.sha256 === b.sha256 && a.size === b.size;
}

/** True when `child` is `parent` or inside it. Case-insensitive on Windows and macOS. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  if (rel === "") return true;
  if (rel.startsWith("..") || resolve(rel) === rel) return false;
  return !rel.split(sep).includes("..");
}

export function safeName(name: string): string {
  const base = basename(name).replace(/[<>:"/\|?*\u0000-\u001f]/g, "_").trim();
  return base.length > 0 ? base : "file";
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const nowIso = (): string => new Date().toISOString();
