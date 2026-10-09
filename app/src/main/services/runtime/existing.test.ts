import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeStatus, Settings } from "../../../shared/contracts";
import { parseArg } from "../../ipc-schema";
import type { PinnedModel } from "./discover";
import { createRuntimeService, type RuntimeDeps } from "./index";

// Real GGUF header bytes (same shape the reader parses); the weights are padding. The "engine" is an empty file: nothing is launched.
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const gstr = (s: string) => Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)]);
const kvStr = (k: string, v: string) => Buffer.concat([gstr(k), u32(8), gstr(v)]);
const kvU32 = (k: string, v: number) => Buffer.concat([gstr(k), u32(4), u32(v)]);
function gguf(arch: string, name: string, size: number): Buffer {
  const kvs = [kvStr("general.architecture", arch), kvStr("general.type", "model"), kvStr("general.name", name), kvU32(`${arch}.context_length`, 32768), kvStr("tokenizer.chat_template", "{{ x }}")];
  const head = Buffer.concat([Buffer.from("GGUF"), u32(3), u64(0), u64(kvs.length), ...kvs]);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length))]);
}

process.setMaxListeners(40);
let root: string;
let home: string;
let modelDir: string;
let settings: Settings;
let events: RuntimeStatus[];
let logs: string[];

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const exactBody = gguf("qwen35", "Qwen3.5 4B", 6000);
const catalog: PinnedModel[] = [{ id: "qwen3.5-4b", label: "Qwen3.5 4B", bytes: exactBody.length, sha256: sha(exactBody), memoryBytes: 8000 }];

function put(rel: string, body: Buffer): string {
  const p = join(home, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
  return p;
}
function engine(present: boolean): void {
  const exe = join(modelDir, "runtime", "b10909-cuda13.3", "llama-server.exe");
  if (present) {
    mkdirSync(dirname(exe), { recursive: true });
    writeFileSync(exe, "");
  }
}
function service() {
  const deps: RuntimeDeps = {
    paths: { dataDir: join(root, "data"), modelDir, resourcesDir: join(root, "res"), logFile: join(root, "log.txt") },
    emit: (event, payload) => {
      if (event === "runtime:status") events.push(payload as RuntimeStatus);
    },
    log: (m) => logs.push(m),
    getSettings: () => settings,
    updateSettings: (patch) => {
      settings = { ...settings, ...patch };
      return settings;
    },
  };
  return createRuntimeService(deps, {
    platform: "win32",
    arch: "x64",
    forceRuntime: "cuda",
    machine: () => ({ ramBytes: 16 * 1024 ** 3 }),
    discover: { home, env: {}, catalog, minBytes: 1000, windowTokens: 1 },
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nonon-existing-"));
  home = join(root, "home");
  modelDir = join(root, "models");
  mkdirSync(home, { recursive: true });
  mkdirSync(modelDir, { recursive: true });
  settings = { onboarded: false, companionName: "Non", character: "non", reducedMotion: false, activeWorkspaceId: null, modelId: null, backgroundRoutines: false, idleUnloadSeconds: 300 };
  events = [];
  logs = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe("using an AI that is already on the computer", () => {
  it("offers a found file, uses it in place, and does not touch it", async () => {
    engine(true);
    const file = put("Downloads/Llama-3.1-8B-Instruct-Q4_K_M.gguf", gguf("llama", "Llama 3.1 8B Instruct", 7000));
    const before = readFileSync(file);
    const rt = service();
    expect(rt.status().phase).toBe("not-installed");

    const found = await rt.discover();
    expect(found).toHaveLength(1);
    expect(found[0]).not.toHaveProperty("path");
    const status = await rt.useExisting(found[0]!.id);

    expect(status).toMatchObject({ phase: "ready", modelId: "custom", modelLabel: "Llama 3.1 8B Instruct" });
    expect(rt.isReady()).toBe(true);
    expect(settings.customModel).toMatchObject({ path: file, kind: "compatible", label: "Llama 3.1 8B Instruct" });
    expect(settings.modelId).toBe("custom");
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(logs.some((l) => l.includes(file))).toBe(true);
  });

  it("treats an exact match like the pinned model installed at that path", async () => {
    engine(true);
    const file = put("Downloads/renamed.gguf", exactBody);
    const rt = service();
    const [found] = await rt.discover();
    expect(found).toMatchObject({ kind: "exact", modelId: "qwen3.5-4b" });
    const status = await rt.useExisting(found!.id);
    expect(status).toMatchObject({ phase: "ready", modelId: "qwen3.5-4b" });
    expect(settings.modelId).toBe("qwen3.5-4b");
    expect(settings.customModel).toMatchObject({ kind: "exact", modelId: "qwen3.5-4b", path: file });
  });

  it("does not make a custom entry for NONON's own pinned file in NONON's own folder", async () => {
    engine(true);
    writeFileSync(join(modelDir, "Qwen3.5-4B-Q4_K_M.gguf"), exactBody);
    const rt = service();
    const found = await rt.discover();
    expect(found[0]).toMatchObject({ kind: "exact", where: "NONON's own folder" });
    const status = await rt.useExisting(found[0]!.id);
    expect(status.modelId).toBe("qwen3.5-4b");
    expect(settings.customModel).toBeUndefined();
  });

  it("only accepts ids from the last search", async () => {
    engine(true);
    put("Downloads/ok.gguf", gguf("qwen3", "Ok", 5000));
    const rt = service();
    await expect(rt.useExisting("0".repeat(40))).rejects.toThrow(/no longer on the list/);
    const found = await rt.discover();
    await expect(rt.useExisting(createHash("sha1").update("C:\\Windows\\System32\\evil.gguf").digest("hex"))).rejects.toThrow(/no longer on the list/);
    await expect(rt.useExisting(found[0]!.id)).resolves.toBeTruthy();
    expect(settings.customModel?.path).toContain("ok.gguf");
  });

  it("the window cannot send a path: the channel takes only a 40-character id, and settings:update ignores customModel", () => {
    expect(() => parseArg("runtime:use-existing", { id: "C:\\models\\x.gguf" })).toThrow();
    expect(() => parseArg("runtime:use-existing", { id: "../../x" })).toThrow();
    expect(() => parseArg("runtime:use-existing", { id: "a".repeat(40), path: "C:\\x.gguf" })).not.toThrow();
    expect(parseArg("runtime:use-existing", { id: "a".repeat(40), path: "C:\\x.gguf" })).toEqual({ id: "a".repeat(40) });
    expect(parseArg("settings:update", { customModel: { path: "C:\\x.gguf", label: "x", kind: "exact", bytes: 1 }, reducedMotion: true })).toEqual({ reducedMotion: true });
  });

  it("forgetting stops using the file and leaves it where it is", async () => {
    engine(true);
    const file = put("Downloads/keep.gguf", gguf("qwen3", "Keep Me", 5000));
    const before = readFileSync(file);
    const rt = service();
    await rt.useExisting((await rt.discover())[0]!.id);
    expect(rt.status().phase).toBe("ready");

    const after = await rt.forgetExisting();
    expect(after.phase).toBe("not-installed");
    expect(after.modelLabel).toBeUndefined();
    expect(settings.customModel).toBeUndefined();
    expect(settings.modelId).toBeNull();
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("returns to not installed, with a plain message, when the chosen file disappears", async () => {
    engine(true);
    const file = put("Downloads/gone.gguf", gguf("qwen3", "Gone Soon", 5000));
    const rt = service();
    await rt.useExisting((await rt.discover())[0]!.id);
    expect(rt.status().phase).toBe("ready");

    rmSync(file);
    // A fresh service reads settings the way the app does after a restart.
    const again = service();
    expect(again.status()).toMatchObject({ phase: "not-installed" });
    expect(again.status().detail).toMatch(/Gone Soon.*no longer where it was/);
    expect(again.isReady()).toBe(false);
    await expect(again.start()).rejects.toThrow(/not installed/);
    expect(await again.discover()).toEqual([]);
  });

  it("falls back to NONON's own downloaded AI if the chosen file disappears", async () => {
    engine(true);
    writeFileSync(join(modelDir, "Qwen3.5-4B-Q4_K_M.gguf"), exactBody);
    const file = put("Downloads/gone.gguf", gguf("qwen3", "Gone Soon", 5000));
    const rt = service();
    const found = await rt.discover();
    await rt.useExisting(found.find((f) => f.kind === "compatible")!.id);
    expect(rt.status().modelId).toBe("custom");
    rmSync(file);
    expect(service().status()).toMatchObject({ phase: "ready", modelId: "qwen3.5-4b" });
  });

  it("a file the person chose in the dialog goes through the same checks, and says no in plain words", async () => {
    engine(true);
    const rt = service();
    const bad = put("Downloads/search-only.gguf", gguf("nomic-bert", "Nomic", 5000));
    await expect(rt.useFile(bad)).rejects.toThrow(/searching, not for writing/);
    await expect(rt.useFile(join(home, "readme.txt"))).rejects.toThrow(/\.gguf/);
    const good = put("Downloads/fine.gguf", gguf("qwen3", "Fine", 5000));
    const ok = await rt.useFile(good);
    expect(ok).toMatchObject({ phase: "ready", modelId: "custom", modelLabel: "Fine" });
    expect(settings.customModel?.path).toBe(good);
  });

  it("downloading NONON's own AI afterwards replaces the chosen file in settings", async () => {
    engine(true);
    put("Downloads/ok.gguf", gguf("qwen3", "Ok", 5000));
    const rt = service();
    await rt.useExisting((await rt.discover())[0]!.id);
    writeFileSync(join(modelDir, "Qwen3.5-4B-Q4_K_M.gguf"), exactBody);
    await rt.install("qwen3.5-4b");
    expect(settings.customModel).toBeUndefined();
    expect(rt.status()).toMatchObject({ phase: "ready", modelId: "qwen3.5-4b" });
  });
});

describe("the AI engine", () => {
  it("still needs a one-time download when it is missing, and says so", async () => {
    engine(false);
    // The network is blocked: the engine request never answers until it is cancelled.
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    put("Downloads/ok.gguf", gguf("qwen3", "Ok", 5000));
    const rt = service();
    const found = await rt.discover();
    const status = await rt.useExisting(found[0]!.id);
    expect(rt.status().detail).toMatch(/AI engine \(about 30 to 150 MB\)|helper files/);
    expect(["downloading-runtime", "not-installed"]).toContain(status.phase);
    // Wait until the download has begun, then cancel it: the chosen file stays chosen.
    await vi.waitFor(() => expect(rt.status().phase).toBe("downloading-runtime"), { timeout: 20000, interval: 50 });
    rt.cancel();
    await vi.waitFor(() => expect(rt.status().phase).toBe("not-installed"), { timeout: 20000, interval: 50 });
    expect(settings.customModel?.path).toContain("ok.gguf");
    expect(rt.status().detail).toMatch(/Choose the AI again|engine/);
    expect(events.some((e) => e.phase === "downloading-runtime")).toBe(true);
  });

  it("skips the engine download when the engine is already there", async () => {
    engine(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    put("Downloads/ok.gguf", gguf("qwen3", "Ok", 5000));
    const rt = service();
    const status = await rt.useExisting((await rt.discover())[0]!.id);
    expect(status.phase).toBe("ready");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
