import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverModels, discoverReport, fitDistance, inspectModelFile, prettyLabel, realFs, type DiscoverFs, type DiscoverOptions, type PinnedModel } from "./discover";

// ---- a tiny GGUF writer: real header bytes, so the reader is tested against the real format ----

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
const kvStrArray = (k: string, n: number) => {
  const items = Buffer.concat(Array.from({ length: n }, (_, i) => gstr(`tok${i}`)));
  return Buffer.concat([gstr(k), u32(9), u32(8), u64(n), items]);
};
const kvI32Array = (k: string, n: number) => Buffer.concat([gstr(k), u32(9), u32(5), u64(n), Buffer.alloc(n * 4)]);

interface Spec {
  arch?: string;
  type?: string;
  name?: string;
  sizeLabel?: string;
  template?: boolean;
  ctx?: number;
  tokens?: number;
  /** Where the file is padded to, standing in for the weights. */
  size?: number;
  cut?: number;
}

function gguf(s: Spec = {}): Buffer {
  const arch = s.arch ?? "qwen3";
  const kvs: Buffer[] = [kvStr("general.architecture", arch), kvStr("general.type", s.type ?? "model")];
  if (s.name !== undefined) kvs.push(kvStr("general.name", s.name));
  if (s.sizeLabel) kvs.push(kvStr("general.size_label", s.sizeLabel));
  kvs.push(kvU32(`${arch}.context_length`, s.ctx ?? 32768), kvU32(`${arch}.block_count`, 32), kvU32(`${arch}.attention.head_count`, 32), kvU32(`${arch}.attention.head_count_kv`, 8), kvU32(`${arch}.embedding_length`, 4096));
  if (s.tokens) kvs.push(kvStrArray("tokenizer.ggml.tokens", s.tokens), kvI32Array("tokenizer.ggml.token_type", s.tokens));
  if (s.template !== false) kvs.push(kvStr("tokenizer.chat_template", "{% for m in messages %}{{ m.content }}{% endfor %}"));
  const head = Buffer.concat([Buffer.from("GGUF"), u32(3), u64(0), u64(kvs.length), ...kvs]);
  const whole = s.size && s.size > head.length ? Buffer.concat([head, Buffer.alloc(s.size - head.length)]) : head;
  return s.cut ? whole.subarray(0, s.cut) : whole;
}

// ---- a counting fs, to prove how much of each file is read ----

function countingFs(): { fs: DiscoverFs; read: Map<string, number> } {
  const read = new Map<string, number>();
  const fs: DiscoverFs = {
    ...realFs,
    async open(p) {
      const h = await realFs.open(p);
      return {
        async read(buf, off, len, pos) {
          const r = await h.read(buf, off, len, pos);
          read.set(p, (read.get(p) ?? 0) + r.bytesRead);
          return r;
        },
        close: () => h.close(),
      };
    },
  };
  return { fs, read };
}

const GB = 1024 ** 3;
let home: string;
let modelDir: string;
const put = (rel: string, bytes: Buffer) => {
  const full = join(home, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
  return full;
};
const opts = (over: Partial<DiscoverOptions> = {}): DiscoverOptions => ({ modelDir, ramBytes: 16 * GB, platform: "win32", home, env: {}, catalog: [], minBytes: 1000, ...over });
const find = async (over: Partial<DiscoverOptions> = {}) => discoverModels(opts(over));

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "nonon-disc-"));
  modelDir = join(home, "nonon-models");
  mkdirSync(modelDir, { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("folders it knows", () => {
  it("finds LM Studio models as <publisher>/<repo>/file.gguf", async () => {
    const p = put(".lmstudio/models/bartowski/Qwen2.5-14B-Instruct-GGUF/Qwen2.5-14B-Instruct-Q4_K_M.gguf", gguf({ arch: "qwen2", name: "Qwen2.5 14B Instruct", sizeLabel: "14B", size: 5000 }));
    const [m] = await find();
    expect(m).toMatchObject({ where: "LM Studio", kind: "compatible", label: "Qwen2.5 14B Instruct", path: p, fileName: "Qwen2.5-14B-Instruct-Q4_K_M.gguf" });
    expect(m?.id).toBe(createHash("sha1").update(p).digest("hex"));
  });

  it("follows the downloads folder chosen inside LM Studio's own settings", async () => {
    const lm = join(home, "elsewhere", "LM Models");
    mkdirSync(join(lm, "unsloth", "Repo"), { recursive: true });
    writeFileSync(join(lm, "unsloth", "Repo", "Llama-3.1-8B-Instruct-Q4_K_M.gguf"), gguf({ arch: "llama", name: "Llama 3.1 8B Instruct", size: 4000 }));
    put(".lmstudio/settings.json", Buffer.from(JSON.stringify({ downloadsFolder: lm })));
    const models = await find();
    expect(models.map((m) => [m.label, m.where])).toEqual([["Llama 3.1 8B Instruct", "LM Studio"]]);
  });

  it("finds Ollama models through the manifest and the blob, and labels them model:tag", async () => {
    const root = join(home, ".ollama", "models");
    const digest = "a".repeat(64);
    mkdirSync(join(root, "blobs"), { recursive: true });
    writeFileSync(join(root, "blobs", `sha256-${digest}`), gguf({ arch: "llama", name: "Llama 3.1 8B Instruct", size: 6000 }));
    const manifest = (d: string) => JSON.stringify({ layers: [{ mediaType: "application/vnd.ollama.image.template", digest: `sha256:${"b".repeat(64)}` }, { mediaType: "application/vnd.ollama.image.model", digest: `sha256:${d}` }] });
    mkdirSync(join(root, "manifests", "registry.ollama.ai", "library", "llama3.1"), { recursive: true });
    writeFileSync(join(root, "manifests", "registry.ollama.ai", "library", "llama3.1", "8b"), manifest(digest));
    const models = await find();
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ where: "Ollama", kind: "compatible", fileName: `sha256-${digest}` });
  });

  it("labels an Ollama model by its manifest tag when the file has no name inside", async () => {
    const root = join(home, "custom-ollama");
    const digest = "c".repeat(64);
    mkdirSync(join(root, "blobs"), { recursive: true });
    mkdirSync(join(root, "manifests", "registry.ollama.ai", "someone", "mymodel"), { recursive: true });
    writeFileSync(join(root, "blobs", `sha256-${digest}`), gguf({ arch: "qwen3", size: 6000 }));
    writeFileSync(join(root, "manifests", "registry.ollama.ai", "someone", "mymodel", "q4"), JSON.stringify({ layers: [{ mediaType: "application/vnd.ollama.image.model", digest: `sha256:${digest}` }] }));
    const [m] = await find({ env: { OLLAMA_MODELS: root } });
    expect(m?.label).toBe("someone/mymodel:q4");
  });

  it("ignores an Ollama manifest whose digest tries to leave the blobs folder, and an embedding model", async () => {
    const root = join(home, ".ollama", "models");
    mkdirSync(join(root, "manifests", "registry.ollama.ai", "library", "evil"), { recursive: true });
    writeFileSync(join(root, "manifests", "registry.ollama.ai", "library", "evil", "latest"), JSON.stringify({ layers: [{ mediaType: "application/vnd.ollama.image.model", digest: "sha256:../../../../secret" }] }));
    const digest = "d".repeat(64);
    mkdirSync(join(root, "blobs"), { recursive: true });
    writeFileSync(join(root, "blobs", `sha256-${digest}`), gguf({ arch: "nomic-bert", size: 6000 }));
    mkdirSync(join(root, "manifests", "registry.ollama.ai", "library", "nomic-embed-text"), { recursive: true });
    writeFileSync(join(root, "manifests", "registry.ollama.ai", "library", "nomic-embed-text", "latest"), JSON.stringify({ layers: [{ mediaType: "application/vnd.ollama.image.model", digest: `sha256:${digest}` }] }));
    expect(await find()).toEqual([]);
  });

  it("finds Hugging Face cache snapshots, even though the files are links to blobs", async () => {
    const snap = join(home, ".cache", "huggingface", "hub", "models--unsloth--Qwen3-8B-GGUF", "snapshots", "abc123");
    const blobs = join(home, ".cache", "huggingface", "hub", "models--unsloth--Qwen3-8B-GGUF", "blobs");
    mkdirSync(snap, { recursive: true });
    mkdirSync(blobs, { recursive: true });
    writeFileSync(join(blobs, "f00d"), gguf({ arch: "qwen3", name: "Qwen3 8B", size: 5000 }));
    try {
      symlinkSync(join(blobs, "f00d"), join(snap, "Qwen3-8B-Q4_K_M.gguf"), "file");
    } catch {
      writeFileSync(join(snap, "Qwen3-8B-Q4_K_M.gguf"), gguf({ arch: "qwen3", name: "Qwen3 8B", size: 5000 }));
    }
    const models = await find();
    expect(models.map((m) => [m.label, m.where])).toEqual([["Qwen3 8B", "Hugging Face"]]);
  });

  it("finds a .gguf in Downloads and Documents (two folders deep) but not deeper", async () => {
    put("Downloads/model.gguf", gguf({ arch: "gemma3", name: "Gemma 3 4B", size: 3000 }));
    put("Documents/stuff/more/Qwen3-4B-Q4_K_M.gguf", gguf({ arch: "qwen3", name: "Qwen3 4B", size: 3000 }));
    put("Documents/a/b/c/too-deep.gguf", gguf({ arch: "qwen3", name: "Too Deep", size: 3000 }));
    const models = await find();
    expect(models.map((m) => [m.label, m.where]).sort()).toEqual([["Gemma 3 4B", "your Downloads folder"], ["Qwen3 4B", "your Documents folder"]]);
  });

  it("finds NONON's own folder, Jan and a ~/models folder", async () => {
    writeFileSync(join(modelDir, "mine.gguf"), gguf({ arch: "qwen3", name: "Mine", size: 3000 }));
    put("jan/models/janmodel/model.gguf", gguf({ arch: "llama", name: "Jan Model", size: 3000 }));
    put("models/other.gguf", gguf({ arch: "phi3", name: "Phi 3 Mini", size: 3000 }));
    const where = (await find()).map((m) => m.where).sort();
    expect(where).toEqual(["Jan", "NONON's own folder", "your models folder"]);
  });

  it("scans folders listed in NONON_EXTRA_MODEL_DIRS", async () => {
    const extra = join(home, "install-test");
    mkdirSync(extra);
    writeFileSync(join(extra, "x.gguf"), gguf({ arch: "qwen3", name: "Extra", size: 3000 }));
    expect((await find({ env: { NONON_EXTRA_MODEL_DIRS: extra } })).map((m) => m.label)).toEqual(["Extra"]);
  });
});

describe("what it keeps and what it skips", () => {
  it("skips embedding models, picture projectors, non-chat files and files with no chat template", async () => {
    put("Downloads/bert.gguf", gguf({ arch: "bert", size: 3000, tokens: 50 }));
    put("Downloads/nomic.gguf", gguf({ arch: "nomic-bert", size: 3000 }));
    put("Downloads/mmproj-Model-BF16.gguf", gguf({ arch: "clip", size: 3000 }));
    put("Downloads/clip-named-plain.gguf", gguf({ arch: "clip", size: 3000 }));
    put("Downloads/bge-embed-model.gguf", gguf({ arch: "qwen3", size: 3000 }));
    put("Downloads/no-template.gguf", gguf({ arch: "qwen3", template: false, size: 3000 }));
    put("Downloads/lora.gguf", gguf({ arch: "qwen3", type: "adapter", size: 3000 }));
    put("Downloads/short.gguf", gguf({ arch: "llama", ctx: 2048, size: 3000 }));
    const good = put("Downloads/good.gguf", gguf({ arch: "qwen3", name: "Good", size: 3000 }));
    const report = await discoverReport(opts());
    expect(report.models.map((m) => m.path)).toEqual([good]);
    const why = Object.fromEntries(report.skipped.map((s) => [s.path.split(/[\\/]/).pop(), s.reason]));
    expect(why).toMatchObject({
      "bert.gguf": "embedding",
      "nomic.gguf": "embedding",
      "mmproj-Model-BF16.gguf": "projector",
      "clip-named-plain.gguf": "projector",
      "bge-embed-model.gguf": "embedding",
      "no-template.gguf": "no-template",
      "lora.gguf": "not-a-model",
      "short.gguf": "short-context",
    });
  });

  it("skips files under the minimum size without opening them", async () => {
    const small = put("Downloads/small.gguf", gguf({ arch: "qwen3", name: "Small", size: 500 }));
    const { fs, read } = countingFs();
    expect(await find({ fs })).toEqual([]);
    expect(read.get(small)).toBeUndefined();
  });

  it("skips an AI that is too big for this computer's memory, without opening it", async () => {
    const big = put("Downloads/big.gguf", gguf({ arch: "qwen3", name: "Big", size: 20_000 }));
    const { fs, read } = countingFs();
    const report = await discoverReport(opts({ fs, ramBytes: 25_000 }));
    expect(report.models).toEqual([]);
    expect(report.skipped[0]?.reason).toBe("too-big");
    expect(read.get(big)).toBeUndefined();
  });

  it("counts the working memory of the window, not just the file", async () => {
    // 3000-byte file fits in 70% of 5000, but its 16K window (estimated from the header) does not.
    put("Downloads/needs-window.gguf", gguf({ arch: "qwen3", name: "Window", size: 3000 }));
    const report = await discoverReport(opts({ ramBytes: 5000 }));
    expect(report.models).toEqual([]);
    expect(report.skipped[0]).toMatchObject({ reason: "too-big" });
  });

  it("skips truncated and garbage files and keeps going", async () => {
    put("Downloads/truncated.gguf", gguf({ arch: "qwen3", name: "T", tokens: 500, cut: 1500 }));
    put("Downloads/garbage.gguf", Buffer.from("this is not a model ".repeat(200)));
    put("Downloads/zeros.gguf", Buffer.alloc(4000));
    put("Downloads/bad-count.gguf", Buffer.concat([Buffer.from("GGUF"), u32(3), u64(0), u64(5_000_000), Buffer.alloc(3000)]));
    put("Downloads/bad-version.gguf", Buffer.concat([Buffer.from("GGUF"), u32(99), Buffer.alloc(3000)]));
    const ok = put("Downloads/ok.gguf", gguf({ arch: "qwen3", name: "Ok", size: 3000 }));
    const report = await discoverReport(opts());
    expect(report.models.map((m) => m.path)).toEqual([ok]);
    expect(report.skipped).toHaveLength(5);
    expect(report.skipped.some((s) => s.reason === "not-gguf")).toBe(true);
    expect(report.skipped.some((s) => s.reason === "unreadable")).toBe(true);
  });

  it("lists only the first part of a split model, sized as all parts together", async () => {
    put("Downloads/Big-00001-of-00002.gguf", gguf({ arch: "qwen3", name: "Big Split", size: 3000 }));
    put("Downloads/Big-00002-of-00002.gguf", Buffer.alloc(4000));
    put("Downloads/Lonely-00001-of-00002.gguf", gguf({ arch: "qwen3", name: "Lonely", size: 3000 }));
    const report = await discoverReport(opts());
    expect(report.models).toHaveLength(1);
    expect(report.models[0]).toMatchObject({ label: "Big Split", bytes: 7000 });
    expect(report.skipped.map((s) => s.reason).sort()).toEqual(["split-part", "unreadable"]);
  });

  it("lists an unfamiliar architecture only when asked, as unknown", async () => {
    put("Downloads/odd.gguf", gguf({ arch: "mamba2", name: "Odd One", size: 3000 }));
    expect(await find()).toEqual([]);
    const [m] = await find({ includeUnknown: true });
    expect(m).toMatchObject({ kind: "unknown", label: "Odd One" });
  });

  it("accepts the common families the bundled engine runs", async () => {
    for (const [i, arch] of ["qwen2", "qwen2moe", "qwen3", "qwen3moe", "qwen35", "qwen35moe", "llama", "gemma3", "gemma4", "phi3", "mistral3", "granite", "smollm3", "olmo2", "deepseek2"].entries()) {
      put(`Downloads/m${i}.gguf`, gguf({ arch, name: `Model ${arch}`, size: 3000 }));
    }
    expect(await find()).toHaveLength(15);
  });
});

describe("exact matches", () => {
  const body = gguf({ arch: "qwen35", name: "Qwen3.5 4B", sizeLabel: "4B", size: 9000 });
  const pin = (over: Partial<PinnedModel> = {}): PinnedModel => ({ id: "fake-4b", label: "Qwen3.5 4B", bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), memoryBytes: 12_000, ...over });

  it("calls a file exact only when size and SHA-256 both match a pinned model", async () => {
    const p = put("Downloads/anything-renamed.gguf", body);
    const report = await discoverReport(opts({ catalog: [pin()] }));
    expect(report.models).toHaveLength(1);
    expect(report.models[0]).toMatchObject({ kind: "exact", modelId: "fake-4b", label: "Qwen3.5 4B", path: p });
    expect(report.hashed).toHaveLength(1);
    expect(report.hashed[0]?.match).toBe(true);
  });

  it("treats a file of the same size but different content as compatible, not exact", async () => {
    const other = Buffer.from(body);
    other[other.length - 1] = 7;
    put("Downloads/lookalike.gguf", other);
    const report = await discoverReport(opts({ catalog: [pin()] }));
    expect(report.models[0]).toMatchObject({ kind: "compatible" });
    expect(report.hashed[0]?.match).toBe(false);
  });

  it("hashes only files whose size matches, and each at most once per session", async () => {
    put("Downloads/other-size.gguf", gguf({ arch: "qwen3", name: "Other", size: body.length + 10 }));
    const exact = put("Downloads/exact.gguf", body);
    const { fs, read } = countingFs();
    const hashCache = new Map<string, string>();
    await discoverModels(opts({ fs, catalog: [pin()], hashCache }));
    const afterFirst = read.get(exact) ?? 0;
    expect(afterFirst).toBe(body.length);
    await discoverModels(opts({ fs, catalog: [pin()], hashCache }));
    expect(read.get(exact)).toBe(afterFirst);
    expect(hashCache.size).toBe(1);
  });

  it("can be cancelled while hashing, and then does not claim an exact match", async () => {
    put("Downloads/exact.gguf", body);
    const ac = new AbortController();
    ac.abort();
    const models = await discoverModels(opts({ catalog: [pin()], signal: ac.signal }));
    expect(models.find((m) => m.kind === "exact")).toBeUndefined();
  });

  it("puts exact matches first, ahead of files that suit the computer better", async () => {
    put("Downloads/exact.gguf", body);
    put("Downloads/mid.gguf", gguf({ arch: "qwen3", name: "Mid", size: 2_000 }));
    const models = await find({ catalog: [pin()], windowTokens: 1 });
    expect(models.map((m) => m.kind)).toEqual(["exact", "compatible"]);
  });

  it("prefers a 4B to a 14B file on 16 GB of memory, and the reverse on 32 GB", () => {
    const small = 2_740_937_888;
    const mid = 8_370_000_000;
    expect(fitDistance(small, 16 * GB)).toBeLessThan(fitDistance(mid, 16 * GB));
    expect(fitDistance(5_680_522_464, 16 * GB)).toBeLessThan(fitDistance(small, 16 * GB));
    expect(fitDistance(mid, 32 * GB)).toBeLessThan(fitDistance(small, 32 * GB));
    expect(fitDistance(small, 8 * GB)).toBeLessThan(fitDistance(mid, 8 * GB));
  });
});

describe("safety and speed", () => {
  it("never reads a whole file: a big header is read, a 50 MB file is not", async () => {
    const big = put("Downloads/with-vocab.gguf", gguf({ arch: "qwen3", name: "Vocab", tokens: 60_000, size: 50_000_000 }));
    const { fs, read } = countingFs();
    const [m] = await find({ fs, minBytes: 1_000_000, ramBytes: 64 * GB });
    expect(m?.label).toBe("Vocab");
    const headerSize = gguf({ arch: "qwen3", name: "Vocab", tokens: 60_000 }).length;
    expect(read.get(big)).toBeLessThanOrEqual(headerSize + 1024 * 1024);
    expect(read.get(big)).toBeLessThan(50_000_000 / 4);
  });

  it("reads almost nothing from a non-candidate", async () => {
    const files = [
      put("Downloads/embed-arch.gguf", gguf({ arch: "bert", tokens: 80_000, size: 5_000_000 })),
      put("Downloads/text.gguf", Buffer.from("hello ".repeat(1_000_000))),
      put("Downloads/projector.gguf", gguf({ arch: "clip", tokens: 80_000, size: 5_000_000 })),
      put("Downloads/unknown.gguf", gguf({ arch: "mamba2", tokens: 80_000, size: 5_000_000 })),
    ];
    const { fs, read } = countingFs();
    await find({ fs, minBytes: 1_000_000, ramBytes: 64 * GB });
    for (const f of files) expect(read.get(f) ?? 0).toBeLessThanOrEqual(64 * 1024);
  });

  it("does not follow a link back up the tree forever, and lists each file once", async () => {
    const dir = join(home, "Downloads", "loop");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "m.gguf"), gguf({ arch: "qwen3", name: "Loop", size: 3000 }));
    try {
      symlinkSync(join(home, "Downloads"), join(dir, "again"), "junction");
      symlinkSync(dir, join(home, "Downloads", "self"), "junction");
    } catch {
      return; // the platform refused to make a link; nothing to test
    }
    const t0 = Date.now();
    const models = await find();
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(models.map((m) => m.label)).toEqual(["Loop"]);
  });

  it("follows a link to a folder (a junction is how many people move their models), once", async () => {
    const real = join(home, "bigdrive", "LM Models");
    mkdirSync(join(real, "pub", "repo"), { recursive: true });
    writeFileSync(join(real, "pub", "repo", "m.gguf"), gguf({ arch: "qwen3", name: "Moved", size: 3000 }));
    mkdirSync(join(home, ".lmstudio"), { recursive: true });
    try {
      symlinkSync(real, join(home, ".lmstudio", "models"), "junction");
    } catch {
      return;
    }
    expect((await find()).map((m) => [m.label, m.where])).toEqual([["Moved", "LM Studio"]]);
  });

  it("stops at its time budget instead of walking a huge or slow folder tree", async () => {
    let calls = 0;
    const slow: DiscoverFs = {
      ...realFs,
      async readdir(p) {
        calls += 1;
        await new Promise((r) => setTimeout(r, 40));
        // Every folder has 3 sub-folders, forever.
        return ["a", "b", "c"].map((name) => ({ name, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false }));
      },
      async realpath(p) {
        return p;
      },
    };
    mkdirSync(join(home, "Downloads"), { recursive: true });
    const t0 = Date.now();
    const report = await discoverReport(opts({ fs: slow, budgetMs: 250 }));
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(report.timedOut).toBe(true);
    expect(calls).toBeGreaterThan(0);
  });

  it("returns at most 20 results", async () => {
    for (let i = 0; i < 25; i++) put(`Downloads/m${i}.gguf`, gguf({ arch: "qwen3", name: `Model ${i}`, size: 3000 + i }));
    expect(await find()).toHaveLength(20);
  });

  it("never changes a file it looks at", async () => {
    const p = put("Downloads/keep.gguf", gguf({ arch: "qwen3", name: "Keep", size: 3000 }));
    const before = [readFileSync(p), statSync(p).mtimeMs] as const;
    await find();
    expect(readFileSync(p).equals(before[0])).toBe(true);
    expect(statSync(p).mtimeMs).toBe(before[1]);
  });

  it("lists the same file once when two folders reach it", async () => {
    const real = put("Downloads/dup.gguf", gguf({ arch: "qwen3", name: "Dup", size: 3000 }));
    put("models/dup.gguf", readFileSync(real));
    expect(await find()).toHaveLength(1);
  });
});

describe("naming", () => {
  it("builds a plain name from the file's own name and size", () => {
    expect(prettyLabel({ name: "Qwen2.5 14B Instruct", sizeLabel: "14B" }, "x.gguf")).toBe("Qwen2.5 14B Instruct");
    expect(prettyLabel({ name: "Llama 3.1 Instruct", sizeLabel: "8B" }, "x.gguf")).toBe("Llama 3.1 Instruct 8B");
    expect(prettyLabel({ name: null, sizeLabel: null }, "Qwen3.8-27B-UD-Q4_K_M.gguf")).toBe("Qwen3.8 27B");
    expect(prettyLabel({ name: null, sizeLabel: null }, "gemma-4-E4B-it-Q4_K_M.gguf")).toBe("gemma 4 E4B it");
    expect(prettyLabel({ name: "Gemma-4-E4B-it", sizeLabel: "4B" }, "x.gguf")).toBe("Gemma 4 E4B it");
    expect(prettyLabel({ name: "Gemma 4 E4B", sizeLabel: "7.5B" }, "x.gguf")).toBe("Gemma 4 E4B");
    expect(prettyLabel({ name: null, sizeLabel: null }, "Model-Q8_0-00001-of-00003.gguf")).toBe("Model");
  });
});

describe("one chosen file", () => {
  it("accepts a good file and says why it refuses the rest, in plain words", async () => {
    const good = put("Downloads/good.gguf", gguf({ arch: "qwen3", name: "Good", size: 3000 }));
    const ok = await inspectModelFile(good, opts());
    expect(ok).toMatchObject({ ok: true, file: { label: "Good", kind: "compatible" } });

    const cases: [string, Buffer | string, RegExp][] = [
      ["notes.txt", "hello", /\.gguf/],
      ["emb.gguf", gguf({ arch: "bert", size: 3000 }), /searching/],
      ["mmproj-x.gguf", gguf({ arch: "clip", size: 3000 }), /pictures/],
      ["junk.gguf", Buffer.from("x".repeat(3000)), /not an AI file/],
      ["cut.gguf", Buffer.concat([gguf({ arch: "qwen3" }).subarray(0, 70), Buffer.alloc(3000)]), /damaged|partly/],
      ["tiny.gguf", gguf({ arch: "qwen3", size: 100 }), /too small/],
      ["odd.gguf", gguf({ arch: "mamba2", size: 3000 }), /may not know/],
    ];
    for (const [name, content, re] of cases) {
      const p = put(`Downloads/${name}`, Buffer.isBuffer(content) ? content : Buffer.from(content));
      const r = await inspectModelFile(p, opts());
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.message, name).toMatch(re);
    }
    const missing = await inspectModelFile(join(home, "Downloads", "nope.gguf"), opts());
    expect(missing).toMatchObject({ ok: false, reason: "missing" });
    const huge = await inspectModelFile(good, opts({ ramBytes: 2000 }));
    expect(huge).toMatchObject({ ok: false, reason: "too-big" });
  });

  it("recognises a chosen file as exact when it is NONON's own file stored elsewhere", async () => {
    const body = gguf({ arch: "qwen35", size: 4000 });
    const p = put("Downloads/mine.gguf", body);
    const catalog: PinnedModel[] = [{ id: "fake-4b", label: "Qwen3.5 4B", bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), memoryBytes: 5000 }];
    expect(await inspectModelFile(p, opts({ catalog }))).toMatchObject({ ok: true, file: { kind: "exact", modelId: "fake-4b" } });
  });
});
