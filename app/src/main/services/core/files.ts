import { constants, cpSync, existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { copyFile, open, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { FileEntry } from "../../../shared/contracts";
import { isInside, safeName } from "../fs-util";

export const SUPPORTED_EXTENSIONS = [".csv", ".xlsx", ".txt", ".md", ".docx", ".pdf"];
export const OUTPUT_DIR_NAME = "NONON Output";
const MAX_DEPTH = 3;
const MAX_ENTRIES = 5000;
const SKIP_DIRS = new Set(["node_modules", OUTPUT_DIR_NAME.toLowerCase()]);

export const extOf = (path: string): string => extname(path).toLowerCase();
export const isSupported = (path: string): boolean => SUPPORTED_EXTENSIONS.includes(extOf(path));

/** Canonical path even when the leaf does not exist yet: resolves the nearest existing ancestor and re-appends the rest. */
export function realPathLoose(path: string): string {
  let cur = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync.native(cur), ...tail.slice().reverse());
    } catch (e) {
      const parent = dirname(cur);
      if (parent === cur) throw e;
      tail.push(basename(cur));
      cur = parent;
    }
  }
}

/** True when `path` really lives under `folder` after symlinks and junctions are followed. */
export function isReallyInside(folder: string, path: string): boolean {
  try {
    return isInside(realPathLoose(folder), realPathLoose(path));
  } catch {
    return false;
  }
}

async function entryFor(path: string): Promise<FileEntry | null> {
  try {
    const s = await stat(path);
    if (!s.isFile()) return null;
    const name = basename(path);
    return { path, name, ext: extOf(name), size: s.size, mtimeMs: s.mtimeMs, supported: isSupported(name) };
  } catch {
    return null;
  }
}

/** Recursive listing to depth 3. Skips dotfiles, node_modules, our own output folder and anything that escapes through a link. */
export async function listFolder(root: string): Promise<FileEntry[]> {
  const realRoot = await realpath(root);
  const out: FileEntry[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (out.length >= MAX_ENTRIES) return;
    let names;
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      if (out.length >= MAX_ENTRIES) return;
      if (d.name.startsWith(".")) continue;
      const full = join(dir, d.name);
      if (d.isSymbolicLink()) {
        // A linked file is listed only if its real location is still inside the folder; linked folders are never entered.
        const target = await realpath(full).catch(() => null);
        if (!target || !isInside(realRoot, target)) continue;
        const entry = await entryFor(full);
        if (entry) out.push(entry);
        continue;
      }
      if (d.isDirectory()) {
        if (SKIP_DIRS.has(d.name.toLowerCase())) continue;
        if (depth < MAX_DEPTH) await walk(full, depth + 1);
      } else if (d.isFile()) {
        const entry = await entryFor(full);
        if (entry) out.push(entry);
      }
    }
  }

  await walk(resolve(root), 1);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Copies `from` into `to` without ever replacing a file that is already there. */
export function copyTreeNoOverwrite(from: string, to: string): number {
  if (!existsSync(from) || !statSync(from).isDirectory()) return 0;
  mkdirSync(to, { recursive: true });
  let copied = 0;
  cpSync(from, to, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (src, dest) => {
      if (statSync(src).isDirectory()) return true;
      if (existsSync(dest)) return false;
      copied += 1;
      return true;
    },
  });
  return copied;
}

/** Creates `dir/name` exclusively; on a clash tries "name (2).ext", "name (3).ext". Returns the path actually written. */
export async function writeNewFile(dir: string, name: string, data: string | Uint8Array): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const clean = safeName(name);
  const ext = extname(clean);
  const stem = ext ? clean.slice(0, -ext.length) : clean;
  for (let n = 1; n < 10000; n += 1) {
    const candidate = join(dir, n === 1 ? clean : `${stem} (${n})${ext}`);
    let handle;
    try {
      handle = await open(candidate, "wx");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw e;
    }
    try {
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
    return candidate;
  }
  throw new Error("Too many files with the same name in the output folder.");
}

/** Copies `src` into `dir` under a name that is not taken yet. Returns the destination. */
export async function copyNewFile(src: string, dir: string, name: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const clean = safeName(name);
  const ext = extname(clean);
  const stem = ext ? clean.slice(0, -ext.length) : clean;
  for (let n = 1; n < 10000; n += 1) {
    const candidate = join(dir, n === 1 ? clean : `${stem} (${n})${ext}`);
    try {
      await copyFile(src, candidate, constants.COPYFILE_EXCL);
      return candidate;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw e;
    }
  }
  throw new Error("Too many files with the same name in the output folder.");
}
