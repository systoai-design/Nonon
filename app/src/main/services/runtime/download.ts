import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ALLOWED_PREFIXES, type Pin } from "./catalog";

export class DownloadCancelled extends Error {
  constructor() {
    super("Download paused.");
    this.name = "DownloadCancelled";
  }
}

export function assertPinnedUrl(url: string): void {
  if (!ALLOWED_PREFIXES.some((p) => url.startsWith(p))) throw new Error(`NONON will not download from this address because it is not on the approved list: ${url}`);
}

export function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export interface FetchHooks {
  onProgress(done: number, total: number): void;
  onVerifying(): void;
  signal: AbortSignal;
}

/**
 * Downloads one pinned file to `dest`. A partial `<dest>.part` is resumed with a Range request.
 * The file only gets its final name after size and SHA-256 match the pin, so existing means whole.
 */
export async function fetchPinned(pin: Pin, dest: string, hooks: FetchHooks): Promise<void> {
  assertPinnedUrl(pin.url);
  const part = `${dest}.part`;
  let start = existsSync(part) ? statSync(part).size : 0;
  if (start > pin.bytes) {
    rmSync(part, { force: true });
    start = 0;
  }

  if (start < pin.bytes) {
    const response = await fetch(pin.url, {
      headers: start > 0 ? { range: `bytes=${start}-` } : {},
      signal: hooks.signal,
    }).catch((e: unknown) => {
      if (hooks.signal.aborted) throw new DownloadCancelled();
      throw new Error(`NONON could not reach the download site. Check your internet connection, then press install again. (${e instanceof Error ? e.message : String(e)})`);
    });
    if (!response.ok || !response.body) throw new Error(`The download site said no (error ${response.status}). Nothing was installed. Try again in a few minutes.`);
    // GitHub and Hugging Face hand big files to a CDN by redirect. The hash below is what proves the bytes, but a redirect off https must not be followed.
    if (response.redirected && !isHttps(response.url)) {
      void response.body.cancel().catch(() => undefined);
      throw new Error("The download site sent NONON somewhere that is not secure, so nothing was installed.");
    }
    // A server that ignores Range sends the whole file again.
    if (start > 0 && response.status !== 206) {
      rmSync(part, { force: true });
      start = 0;
    }
    let done = start;
    const out = createWriteStream(part, { flags: start > 0 ? "a" : "w" });
    try {
      for await (const chunk of Readable.fromWeb(response.body as never) as AsyncIterable<Buffer>) {
        if (!out.write(chunk)) await once(out, "drain");
        done += chunk.length;
        hooks.onProgress(done, pin.bytes);
      }
    } catch (e) {
      if (hooks.signal.aborted) throw new DownloadCancelled();
      throw new Error(`The download stopped part way. Press install again and it will carry on from where it stopped. (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      out.end();
      await once(out, "close");
    }
  }

  const size = statSync(part).size;
  if (size < pin.bytes) throw new Error("The download stopped before the end. Press install again and it will carry on from where it stopped.");
  hooks.onVerifying();
  if (size !== pin.bytes || (await hashFile(part)) !== pin.sha256) {
    rmSync(part, { force: true });
    throw new Error("The file did not download correctly, so NONON deleted it. Press install to try again.");
  }
  renameSync(part, dest);
}

/** Windows 10+ ships bsdtar, which reads zip; macOS tar reads the .tar.gz. No native dependency needed. */
export async function extractArchive(archive: string, into: string): Promise<void> {
  const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "/usr/bin/tar";
  const child = spawn(tar, ["-xf", archive, "-C", into], { windowsHide: true, stdio: "ignore" });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`NONON could not unpack the AI helper files (error ${code}). Press install to try again.`);
}
