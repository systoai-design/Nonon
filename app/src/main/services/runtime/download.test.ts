import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOWED_PREFIXES, MODELS, RUNTIME_CUDA, RUNTIME_METAL, RUNTIME_VULKAN, runtimeCandidates, unsupportedReason } from "./catalog";
import { assertPinnedUrl, DownloadCancelled, extractArchive, fetchPinned, isHttps } from "./download";

describe("catalog pins", () => {
  const pins = [RUNTIME_VULKAN, RUNTIME_CUDA, RUNTIME_CUDA.extra!, RUNTIME_METAL, ...MODELS];
  it("only points at approved hosts and carries a size and SHA-256", () => {
    for (const p of pins) {
      expect(ALLOWED_PREFIXES.some((x) => p.url.startsWith(x))).toBe(true);
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(p.bytes).toBeGreaterThan(1_000_000);
    }
  });
  it("offers exactly the two models", () => {
    expect(MODELS.map((m) => m.id)).toEqual(["qwen3.5-4b", "qwen3.5-9b"]);
    expect(MODELS.every((m) => m.licence === "Apache-2.0")).toBe(true);
  });
  it("picks engines per platform and refuses unsupported ones", () => {
    expect(runtimeCandidates("win32", "x64", true).map((r) => r.id)).toEqual(["cuda", "vulkan"]);
    expect(runtimeCandidates("win32", "x64", false).map((r) => r.id)).toEqual(["vulkan"]);
    expect(runtimeCandidates("darwin", "arm64", false).map((r) => r.id)).toEqual(["metal"]);
    expect(runtimeCandidates("darwin", "x64", false)).toEqual([]);
    expect(runtimeCandidates("linux", "x64", false)).toEqual([]);
    expect(unsupportedReason("darwin", "x64")).toMatch(/Intel/);
    expect(unsupportedReason("linux", "x64")).toBeTruthy();
    expect(unsupportedReason("win32", "x64")).toBeUndefined();
  });
});

describe("assertPinnedUrl", () => {
  it("rejects anything off the list", () => {
    expect(() => assertPinnedUrl("https://example.com/model.gguf")).toThrow(/approved list/);
    expect(() => assertPinnedUrl("http://github.com/ggml-org/llama.cpp/releases/download/x")).toThrow();
    expect(() => assertPinnedUrl(RUNTIME_VULKAN.url)).not.toThrow();
  });
});

describe("fetchPinned (mocked network)", () => {
  let dir = "";
  const payload = Buffer.from("0123456789".repeat(1000));
  const pin = {
    url: "https://huggingface.co/unsloth/test/resolve/abc/file.gguf",
    bytes: payload.length,
    sha256: createHash("sha256").update(payload).digest("hex"),
  };
  const hooks = () => ({ signal: new AbortController().signal, onProgress: () => {}, onVerifying: () => {} });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nonon-dl-"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it("resumes with a Range request and keeps the file only when the checksum matches", async () => {
    const dest = join(dir, "file.gguf");
    writeFileSync(`${dest}.part`, payload.subarray(0, 4000));
    let range = "";
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      range = (init.headers as Record<string, string>).range ?? "";
      return new Response(payload.subarray(4000), { status: 206 });
    });
    await fetchPinned(pin, dest, hooks());
    expect(range).toBe("bytes=4000-");
    expect(readFileSync(dest).equals(payload)).toBe(true);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("restarts from zero when the server ignores Range", async () => {
    const dest = join(dir, "file.gguf");
    writeFileSync(`${dest}.part`, payload.subarray(0, 4000));
    vi.stubGlobal("fetch", async () => new Response(payload, { status: 200 }));
    await fetchPinned(pin, dest, hooks());
    expect(statSync(dest).size).toBe(payload.length);
  });

  it("throws away a download whose checksum is wrong", async () => {
    const dest = join(dir, "file.gguf");
    vi.stubGlobal("fetch", async () => new Response(Buffer.from("x".repeat(payload.length)), { status: 200 }));
    await expect(fetchPinned(pin, dest, hooks())).rejects.toThrow(/did not download correctly/);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("verifies a complete .part without downloading again", async () => {
    const dest = join(dir, "file.gguf");
    writeFileSync(`${dest}.part`, payload);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await fetchPinned(pin, dest, hooks());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(existsSync(dest)).toBe(true);
  });

  it("keeps the partial file when cancelled", async () => {
    const dest = join(dir, "file.gguf");
    const ac = new AbortController();
    vi.stubGlobal("fetch", async () => {
      const body = new ReadableStream({
        start(c) {
          c.enqueue(payload.subarray(0, 3000));
          ac.abort();
          c.error(new Error("aborted"));
        },
      });
      return new Response(body, { status: 200 });
    });
    await expect(fetchPinned(pin, dest, { ...hooks(), signal: ac.signal })).rejects.toBeInstanceOf(DownloadCancelled);
    expect(existsSync(`${dest}.part`)).toBe(true);
    expect(existsSync(dest)).toBe(false);
  });

  it("refuses an address that is not approved before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchPinned({ ...pin, url: "https://evil.example/x.gguf" }, join(dir, "x"), hooks())).rejects.toThrow(/approved/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("a redirect that leaves https", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nonon-dl-"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it("recognises https only", () => {
    expect(isHttps("https://cdn.example/x")).toBe(true);
    expect(isHttps("http://cdn.example/x")).toBe(false);
    expect(isHttps("")).toBe(false);
  });

  it("is refused before any bytes are kept", async () => {
    const payload = Buffer.from("abc".repeat(100));
    const pin = { url: "https://huggingface.co/unsloth/test/resolve/abc/f.gguf", bytes: payload.length, sha256: createHash("sha256").update(payload).digest("hex") };
    vi.stubGlobal("fetch", async () => {
      const r = new Response(payload, { status: 200 });
      Object.defineProperty(r, "redirected", { value: true });
      Object.defineProperty(r, "url", { value: "http://cdn.example/f.gguf" });
      return r;
    });
    const dest = join(dir, "f.gguf");
    await expect(fetchPinned(pin, dest, { signal: new AbortController().signal, onProgress: () => {}, onVerifying: () => {} })).rejects.toThrow(/not secure/);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });
});

// Real bsdtar (the Windows built-in tar.exe), real zip: proves a hostile archive cannot write outside the target folder.
describe.skipIf(process.platform !== "win32")("unpacking the engine archive", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nonon-zip-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps entries that climb out of the folder from landing outside it", async () => {
    const z = new JSZip();
    z.file("ok/llama-server.exe", "fine");
    z.file("../escaped-1.txt", "x");
    z.file("sub/../../escaped-2.txt", "x");
    z.file("..\escaped-3.txt", "x");
    z.file("/escaped-4.txt", "x");
    const archive = join(dir, "evil.zip");
    writeFileSync(archive, await z.generateAsync({ type: "nodebuffer" }));
    const into = join(dir, "a", "b");
    mkdirSync(into, { recursive: true });
    await extractArchive(archive, into).catch(() => undefined);
    // Nothing may appear next to, or above, the target folder.
    expect(readdirSync(join(dir, "a")).sort()).toEqual(["b"]);
    expect(readdirSync(dir).filter((n) => n.startsWith("escaped"))).toEqual([]);
    expect(existsSync(join(into, "ok", "llama-server.exe"))).toBe(true);
  });
});
