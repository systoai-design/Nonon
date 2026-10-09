import { createHash, randomBytes } from "node:crypto";
import * as fsp from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { FileFingerprint } from "../../../shared/contracts";
import { EditError, errCode, plainFsError } from "./errors";

export const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** Case-insensitive key on Windows and macOS so two spellings of one path share a lock. */
export function pathKey(p: string): string {
  const r = resolve(p);
  return process.platform === "linux" ? r : r.toLowerCase();
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fsp.lstat(p);
    return true;
  } catch (e) {
    const c = errCode(e);
    if (c === "ENOENT" || c === "ENOTDIR") return false;
    throw e;
  }
}

export interface Snapshot {
  bytes: Buffer;
  fp: FileFingerprint;
}

/** Reads a file once and fingerprints those exact bytes, so the check and the edit see the same content. */
export async function readSnapshot(path: string): Promise<Snapshot | null> {
  let st;
  try {
    st = await fsp.stat(path);
  } catch (e) {
    const c = errCode(e);
    if (c === "ENOENT" || c === "ENOTDIR") return null;
    throw e;
  }
  if (!st.isFile()) throw new EditError(`${path} is a folder, not a file.`);
  const bytes = await fsp.readFile(path);
  return { bytes, fp: { path: resolve(path), size: bytes.length, mtimeMs: st.mtimeMs, sha256: sha256(bytes) } };
}

export async function fingerprintOrNull(path: string): Promise<FileFingerprint | null> {
  return (await readSnapshot(path))?.fp ?? null;
}

export interface Io {
  rename(from: string, to: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  attempts: number;
  baseDelayMs: number;
}

export const defaultIo: Io = {
  rename: (a, b) => fsp.rename(a, b),
  sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)),
  attempts: 6,
  baseDelayMs: 40,
};

// Windows reports a file held open by Excel, a virus scanner or a sync client as one of these; they usually clear within a second.
const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);

async function withRetry(fn: () => Promise<void>, io: Io): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fn();
      return;
    } catch (e) {
      const c = errCode(e);
      if (!c || !RETRYABLE.has(c) || attempt + 1 >= io.attempts) throw e;
      await io.sleep(io.baseDelayMs * 2 ** attempt);
    }
  }
}

const tmpNameFor = (dest: string): string => join(dirname(dest), `.${basename(dest)}.nonon-${randomBytes(4).toString("hex")}.tmp`);

async function writeTemp(dest: string, bytes: Uint8Array, mode: number | undefined): Promise<string> {
  const tmp = tmpNameFor(dest);
  const fh = await fsp.open(tmp, "wx", mode ?? 0o644);
  try {
    await fh.writeFile(bytes);
    await fh.sync();
  } finally {
    await fh.close();
  }
  return tmp;
}

/** Writes beside the destination, then renames over it, so a crash leaves either the old or the new file, never half of one. */
export async function atomicWrite(dest: string, bytes: Uint8Array, io: Io = defaultIo): Promise<void> {
  await fsp.mkdir(dirname(dest), { recursive: true });
  let mode: number | undefined;
  try {
    mode = (await fsp.stat(dest)).mode & 0o777;
  } catch {
    mode = undefined;
  }
  const tmp = await writeTemp(dest, bytes, mode);
  try {
    await withRetry(() => io.rename(tmp, dest), io);
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    throw new EditError(plainFsError(e, dest));
  }
}

/**
 * Moves src to dest without ever replacing an existing dest. fs.rename replaces silently (on Windows too),
 * so link-then-unlink gives a real "fail if exists"; filesystems without hard links fall back to check-then-rename.
 */
export async function moveNoOverwrite(src: string, dest: string, io: Io = defaultIo): Promise<void> {
  await fsp.mkdir(dirname(dest), { recursive: true });
  try {
    await fsp.link(src, dest);
  } catch (e) {
    if (errCode(e) === "EEXIST") throw new EditError(`${dest} already exists, so NONON will not replace it.`);
    if (await exists(dest)) throw new EditError(`${dest} already exists, so NONON will not replace it.`);
    try {
      await withRetry(() => io.rename(src, dest), io);
    } catch (e2) {
      throw new EditError(plainFsError(e2, src));
    }
    return;
  }
  try {
    await withRetry(() => fsp.unlink(src), io);
  } catch (e) {
    await fsp.rm(dest, { force: true });
    throw new EditError(plainFsError(e, src));
  }
}

/** Creates a brand-new file; refuses if the path is already taken. */
export async function createNew(dest: string, bytes: Uint8Array, io: Io = defaultIo): Promise<void> {
  await fsp.mkdir(dirname(dest), { recursive: true });
  const tmp = await writeTemp(dest, bytes, undefined);
  try {
    await moveNoOverwrite(tmp, dest, io);
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    throw e instanceof EditError ? e : new EditError(plainFsError(e, dest));
  }
}

/** Saves bytes to a new file (never over an existing one) and proves the copy by hash. */
export async function saveVerifiedCopy(dest: string, bytes: Uint8Array): Promise<string> {
  const want = sha256(bytes);
  await fsp.mkdir(dirname(dest), { recursive: true });
  await fsp.writeFile(dest, bytes, { flag: "wx" });
  const got = sha256(await fsp.readFile(dest));
  if (got !== want) {
    await fsp.rm(dest, { force: true });
    throw new EditError("NONON could not make a safe copy of the file first, so it did not change anything.");
  }
  return want;
}
