import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { homedir, totalmem } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { DiscoveredModel } from "../../../shared/contracts";
import { CONTEXT_TOKENS, MODELS } from "./catalog";

/**
 * Finds AI files (GGUF) the person already has, so a fresh install does not offer a 3 to 6 GB download for
 * something that is already on the drive. Nothing here writes, moves or loads a file: it lists a few known
 * folders, reads the first few megabytes of each candidate (the header), and hashes only a file whose size
 * matches a pinned model exactly. No Electron imports, so vitest runs it as is.
 *
 * Tests only: NONON_EXTRA_MODEL_DIRS (folders separated by ; on Windows, : elsewhere) adds folders to scan.
 */

export interface PinnedModel {
  id: string;
  label: string;
  bytes: number;
  sha256: string;
  /** Weights plus the 16K window, used for the fit check of an exact match. */
  memoryBytes: number;
}

export interface FileHandleLike {
  read(buf: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface DiscoverFs {
  readdir(path: string): Promise<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }[]>;
  stat(path: string): Promise<{ size: number; mtimeMs: number; isDirectory(): boolean; isFile(): boolean }>;
  realpath(path: string): Promise<string>;
  open(path: string): Promise<FileHandleLike>;
  readText(path: string, maxBytes: number): Promise<string>;
}

export const realFs: DiscoverFs = {
  readdir: (p) => nodeFs.readdir(p, { withFileTypes: true }),
  stat: (p) => nodeFs.stat(p),
  realpath: (p) => nodeFs.realpath(p),
  open: (p) => nodeFs.open(p, "r"),
  async readText(p, maxBytes) {
    const h = await nodeFs.open(p, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await h.read(buf, 0, maxBytes, 0);
      return buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await h.close();
    }
  },
};

export interface DiscoverOptions {
  /** NONON's own models folder. */
  modelDir: string;
  ramBytes: number;
  platform?: NodeJS.Platform;
  home?: string;
  env?: Record<string, string | undefined>;
  fs?: DiscoverFs;
  catalog?: readonly PinnedModel[];
  /** Time for listing folders and reading headers. Hashing a matching file has its own budget. */
  budgetMs?: number;
  hashBudgetMs?: number;
  minBytes?: number;
  maxResults?: number;
  includeUnknown?: boolean;
  signal?: AbortSignal;
  /** path|size|mtime -> sha256, so the same file is not hashed twice in a session. */
  hashCache?: Map<string, string>;
  windowTokens?: number;
}

export interface DiscoveredFile extends DiscoveredModel {
  path: string;
}

export type SkipReason =
  | "not-gguf"
  | "too-small"
  | "embedding"
  | "projector"
  | "too-big"
  | "split-part"
  | "no-template"
  | "unknown-arch"
  | "short-context"
  | "unreadable"
  | "missing"
  | "not-a-model";

export interface Skipped {
  path: string;
  reason: SkipReason;
  detail?: string;
}

export interface DiscoveryReport {
  models: DiscoveredFile[];
  skipped: Skipped[];
  scanMs: number;
  hashMs: number;
  totalMs: number;
  timedOut: boolean;
  foldersScanned: { where: string; dir: string; files: number }[];
  hashed: { path: string; ms: number; match: boolean }[];
}

const MIN_BYTES = 300_000_000;
const MAX_RESULTS = 20;
const FIT_SHARE = 0.7;
const MIN_CONTEXT = 8192;
const MAX_META_BYTES = 64 * 1024 * 1024;
const MAX_DIRS_PER_ROOT = 400;
const MAX_ENTRIES_PER_DIR = 3000;
const MAX_FILES_PER_ROOT = 300;
const SKIP_DIRS = new Set(["node_modules", ".git", "blobs", "refs", ".locks", "$recycle.bin", "system volume information"]);

const ARCH_REJECT = new Set(["bert", "nomic-bert", "nomic-bert-moe", "jina-bert-v2", "jina-bert-v3", "modern-bert", "neo-bert", "clip", "mmproj", "t5encoder", "wavtokenizer-dec", "whisper", "sd", "gte"]);
const ARCH_OK = [/^qwen2(moe)?$/, /^qwen3/, /^qwen35/, /^llama$/, /^gemma/, /^phi3$/, /^mistral/, /^granite/, /^smollm/, /^olmo/, /^deepseek2$/];
const NAME_REJECT = /(mmproj|projector|embed|rerank)/i;
const SHARD = /-(\d{5})-of-(\d{5})\.gguf$/i;

const gib = (n: number) => Math.round((n / 1024 ** 3) * 10) / 10;
const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

// ---------------------------------------------------------------- GGUF header

class Bad extends Error {}

const SCALAR_SIZE: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
const T_STRING = 8;
const T_ARRAY = 9;

/** Reads forward through a file in growing chunks; a skip just moves the position, so unused bytes are never read. */
class Reader {
  private buf: Buffer = Buffer.alloc(0);
  private start = 0;
  pos = 0;
  bytesRead = 0;
  private chunk = 16 * 1024;
  constructor(private readonly h: FileHandleLike) {}

  private async fill(n: number): Promise<void> {
    if (this.pos + n > MAX_META_BYTES) throw new Bad("header too large");
    const want = Math.max(n, this.chunk);
    this.chunk = Math.min(this.chunk * 2, 1024 * 1024);
    const b = Buffer.allocUnsafe(want);
    const { bytesRead } = await this.h.read(b, 0, want, this.pos);
    this.bytesRead += bytesRead;
    this.buf = b.subarray(0, bytesRead);
    this.start = this.pos;
    if (bytesRead < n) throw new Bad("file ends early");
  }
  private async need(n: number): Promise<number> {
    if (this.pos < this.start || this.pos + n > this.start + this.buf.length) await this.fill(n);
    return this.pos - this.start;
  }
  async bytes(n: number): Promise<Buffer> {
    const o = await this.need(n);
    const out = this.buf.subarray(o, o + n);
    this.pos += n;
    return out;
  }
  async u32(): Promise<number> {
    const o = await this.need(4);
    this.pos += 4;
    return this.buf.readUInt32LE(o);
  }
  async u64(): Promise<number> {
    const o = await this.need(8);
    this.pos += 8;
    const v = this.buf.readBigUInt64LE(o);
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Bad("number too large");
    return Number(v);
  }
  skip(n: number): void {
    this.pos += n;
  }
  /** Walks `count` length-prefixed strings. Works inside the buffer and only reads again when it runs out. */
  async skipStrings(count: number): Promise<void> {
    let left = count;
    while (left > 0) {
      while (left > 0) {
        const o = this.pos - this.start;
        if (this.pos < this.start || o + 8 > this.buf.length) break;
        const len = Number(this.buf.readBigUInt64LE(o));
        if (len > 64 * 1024 * 1024) throw new Bad("string too long");
        this.pos += 8 + len;
        left -= 1;
        // A string that runs past the buffer is jumped over, not read.
        if (o + 8 + len >= this.buf.length) break;
      }
      if (left > 0) await this.need(8);
    }
  }
}

export interface GgufInfo {
  version: number;
  arch: string | null;
  type: string | null;
  name: string | null;
  sizeLabel: string | null;
  contextLength: number | null;
  hasChatTemplate: boolean;
  blockCount: number | null;
  headCount: number | null;
  headCountKv: number | null;
  embeddingLength: number | null;
  keyLength: number | null;
  bytesRead: number;
  /** True when parsing stopped early because the file is not a candidate. */
  stoppedEarly: boolean;
}

const WANT_NUM = [".context_length", ".block_count", ".attention.head_count_kv", ".attention.head_count", ".embedding_length", ".attention.key_length"];

/** Reads the metadata of a GGUF file without loading its weights. Throws Bad for anything that is not a sane GGUF. */
export async function readGgufHeader(fs: DiscoverFs, path: string): Promise<GgufInfo> {
  const h = await fs.open(path);
  try {
    const r = new Reader(h);
    const magic = (await r.bytes(4)).toString("latin1");
    if (magic !== "GGUF") throw new Bad("not-gguf");
    const version = await r.u32();
    if (version < 2 || version > 3) throw new Bad("version");
    await r.u64();
    const kvCount = await r.u64();
    if (kvCount > 100_000) throw new Bad("kv count");

    const str: Record<string, string> = {};
    const num: Record<string, number> = {};
    let hasChatTemplate = false;
    let stoppedEarly = false;
    let arch: string | null = null;

    for (let i = 0; i < kvCount; i++) {
      const keyLen = await r.u64();
      if (keyLen === 0 || keyLen > 1024) throw new Bad("key");
      const key = (await r.bytes(keyLen)).toString("utf8");
      const type = await r.u32();
      const wantsNum = WANT_NUM.some((s) => key.endsWith(s));

      if (type === T_STRING) {
        const len = await r.u64();
        if (len > 64 * 1024 * 1024) throw new Bad("string");
        if (key === "tokenizer.chat_template") {
          hasChatTemplate = len > 0;
          r.skip(len);
        } else if ((key === "general.architecture" || key === "general.type" || key === "general.name" || key === "general.size_label") && len <= 4096) {
          str[key] = (await r.bytes(len)).toString("utf8");
          if (key === "general.architecture") {
            arch = str[key] ?? null;
            if (arch && ARCH_REJECT.has(arch.toLowerCase())) {
              stoppedEarly = true;
              break;
            }
          }
        } else {
          r.skip(len);
        }
      } else if (type === T_ARRAY) {
        const elem = await r.u32();
        const count = await r.u64();
        if (elem === T_STRING) await r.skipStrings(count);
        else {
          const size = SCALAR_SIZE[elem];
          if (size === undefined) throw new Bad("nested array");
          if (wantsNum && count > 0 && count <= 1024) {
            const bytes = await r.bytes(count * size);
            let max = 0;
            for (let k = 0; k < count; k++) max = Math.max(max, readScalar(bytes, k * size, elem));
            num[key] = max;
          } else r.skip(count * size);
        }
      } else {
        const size = SCALAR_SIZE[type];
        if (size === undefined) throw new Bad("type");
        if (wantsNum) {
          const bytes = await r.bytes(size);
          num[key] = readScalar(bytes, 0, type);
        } else r.skip(size);
      }

      // An unfamiliar family is listed by name only, so stop once the general.* keys are behind us.
      if (arch && !ARCH_OK.some((re) => re.test(arch ?? "")) && !key.startsWith("general.") && i > 0) {
        stoppedEarly = true;
        break;
      }
    }

    const a = arch ?? "";
    return {
      version,
      arch,
      type: str["general.type"] ?? null,
      name: str["general.name"] ?? null,
      sizeLabel: str["general.size_label"] ?? null,
      contextLength: num[`${a}.context_length`] ?? null,
      hasChatTemplate,
      blockCount: num[`${a}.block_count`] ?? null,
      headCount: num[`${a}.attention.head_count`] ?? null,
      headCountKv: num[`${a}.attention.head_count_kv`] ?? null,
      embeddingLength: num[`${a}.embedding_length`] ?? null,
      keyLength: num[`${a}.attention.key_length`] ?? null,
      bytesRead: r.bytesRead,
      stoppedEarly,
    };
  } finally {
    await h.close().catch(() => undefined);
  }
}

function readScalar(b: Buffer, o: number, type: number): number {
  switch (type) {
    case 0: return b.readUInt8(o);
    case 1: return b.readInt8(o);
    case 2: return b.readUInt16LE(o);
    case 3: return b.readInt16LE(o);
    case 4: return b.readUInt32LE(o);
    case 5: return b.readInt32LE(o);
    case 6: return b.readFloatLE(o);
    case 7: return b.readUInt8(o);
    case 10: return Number(b.readBigUInt64LE(o));
    case 11: return Number(b.readBigInt64LE(o));
    case 12: return b.readDoubleLE(o);
    default: return 0;
  }
}

/** Memory the 16K window needs with an 8-bit cache. A guess from the header; hybrid models need less, so it errs high. */
export function windowBytes(info: GgufInfo, fileBytes: number, tokens: number): number {
  const heads = info.headCount ?? 0;
  const kvHeads = info.headCountKv ?? heads;
  const headDim = info.keyLength ?? (heads > 0 && info.embeddingLength ? info.embeddingLength / heads : 0);
  if (info.blockCount && kvHeads && headDim) return Math.round(2 * info.blockCount * kvHeads * headDim * tokens * 1.0625);
  return Math.min(Math.round(fileBytes * 0.15), 2_000_000_000);
}

// ---------------------------------------------------------------- naming

const QUANT_TAIL = /[-_.](?:UD[-_.])?(?:I?Q\d(?:_[A-Z0-9]+)*|F16|BF16|F32|MXFP4(?:_MOE)?)$/i;

export function prettyLabel(info: Pick<GgufInfo, "name" | "sizeLabel">, fileName: string): string {
  let base = info.name?.trim() ?? "";
  if (!base) {
    base = fileName.replace(/\.gguf$/i, "").replace(/-\d{5}-of-\d{5}$/i, "");
    for (let i = 0; i < 3; i++) base = base.replace(QUANT_TAIL, "");
    base = base.replace(/-GGUF$/i, "");
  }
  if (!/\s/.test(base)) base = base.replace(/[-_]+/g, " ");
  base = base.replace(/\s+/g, " ").trim();
  const size = info.sizeLabel?.trim();
  if (size && !base.toLowerCase().includes(size.toLowerCase()) && !/\d(?:\.\d+)?\s*[bm](?![a-z])/i.test(base)) base = `${base} ${size}`;
  return base || fileName;
}

// ---------------------------------------------------------------- folders to look in

interface Root {
  dir: string;
  where: string;
  depth: number;
  ollama?: boolean;
  /** Only descend into these names at depth 1 (cuts the Hugging Face cache down to its models). */
  skipDirs?: Set<string>;
}

async function lmStudioDownloads(fs: DiscoverFs, home: string): Promise<string | null> {
  try {
    const text = await fs.readText(join(home, ".lmstudio", "settings.json"), 512 * 1024);
    const folder = (JSON.parse(text) as { downloadsFolder?: unknown }).downloadsFolder;
    return typeof folder === "string" && isAbsolute(folder) ? folder : null;
  } catch {
    return null;
  }
}

async function buildRoots(o: Required<Pick<DiscoverOptions, "modelDir" | "platform" | "home" | "env" | "fs">>): Promise<Root[]> {
  const { modelDir, platform, home, env, fs } = o;
  const roots: Root[] = [{ dir: modelDir, where: "NONON's own folder", depth: 1 }];
  for (const d of (env.NONON_EXTRA_MODEL_DIRS ?? "").split(platform === "win32" ? ";" : ":").map((s) => s.trim()).filter(Boolean)) {
    roots.push({ dir: d, where: "a folder added for testing", depth: 3 });
  }

  roots.push({ dir: join(home, ".lmstudio", "models"), where: "LM Studio", depth: 4 });
  roots.push({ dir: join(home, ".cache", "lm-studio", "models"), where: "LM Studio", depth: 4 });
  const lmDownloads = await lmStudioDownloads(fs, home);
  if (lmDownloads) roots.push({ dir: lmDownloads, where: "LM Studio", depth: 4 });

  roots.push({ dir: env.OLLAMA_MODELS?.trim() || join(home, ".ollama", "models"), where: "Ollama", depth: 0, ollama: true });

  const hf = new Set<string>();
  if (env.HF_HUB_CACHE) hf.add(env.HF_HUB_CACHE);
  if (env.HF_HOME) hf.add(join(env.HF_HOME, "hub"));
  hf.add(join(home, ".cache", "huggingface", "hub"));
  for (const dir of hf) roots.push({ dir, where: "Hugging Face", depth: 5 });

  if (platform === "win32") {
    const appData = env.APPDATA ?? join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    roots.push({ dir: join(appData, "Jan", "data", "llamacpp", "models"), where: "Jan", depth: 3 });
    roots.push({ dir: join(appData, "Jan", "data", "models"), where: "Jan", depth: 3 });
    roots.push({ dir: join(local, "nomic.ai", "GPT4All"), where: "GPT4All", depth: 1 });
    roots.push({ dir: join(local, "llama.cpp"), where: "llama.cpp", depth: 1 });
  } else if (platform === "darwin") {
    const support = join(home, "Library", "Application Support");
    roots.push({ dir: join(support, "Jan", "data", "llamacpp", "models"), where: "Jan", depth: 3 });
    roots.push({ dir: join(support, "nomic.ai", "GPT4All"), where: "GPT4All", depth: 1 });
    roots.push({ dir: join(home, "Library", "Caches", "llama.cpp"), where: "llama.cpp", depth: 1 });
  } else {
    roots.push({ dir: join(home, ".local", "share", "nomic.ai", "GPT4All"), where: "GPT4All", depth: 1 });
    roots.push({ dir: join(home, ".cache", "llama.cpp"), where: "llama.cpp", depth: 1 });
  }
  roots.push({ dir: join(home, "jan", "models"), where: "Jan", depth: 3 });
  roots.push({ dir: join(home, ".cache", "gpt4all"), where: "GPT4All", depth: 1 });
  roots.push({ dir: join(home, "models"), where: "your models folder", depth: 3 });
  roots.push({ dir: join(home, "Downloads"), where: "your Downloads folder", depth: 2 });
  roots.push({ dir: join(home, "Documents"), where: "your Documents folder", depth: 2 });
  if (env.OneDrive) roots.push({ dir: join(env.OneDrive, "Documents"), where: "your Documents folder", depth: 2 });
  return roots;
}

// ---------------------------------------------------------------- walking

interface Candidate {
  path: string;
  where: string;
  /** Ollama blobs have no readable name, so the manifest's model:tag stands in. */
  hint?: string;
}

interface Clock {
  expired(): boolean;
}

async function walk(fs: DiscoverFs, root: Root, seen: Set<string>, clock: Clock, signal?: AbortSignal): Promise<Candidate[]> {
  const found: Candidate[] = [];
  let top: string;
  try {
    top = await fs.realpath(root.dir);
  } catch {
    return found;
  }
  const queue: { dir: string; depth: number }[] = [{ dir: root.dir, depth: 0 }];
  let dirs = 0;
  while (queue.length && dirs < MAX_DIRS_PER_ROOT && found.length < MAX_FILES_PER_ROOT) {
    if (clock.expired() || signal?.aborted) break;
    const { dir, depth } = queue.shift() as { dir: string; depth: number };
    let real: string;
    try {
      real = dir === root.dir ? top : await fs.realpath(dir);
    } catch {
      continue;
    }
    // The same folder reached twice (a link back up the tree, or two roots that overlap) is read once.
    if (seen.has(real)) continue;
    seen.add(real);
    dirs += 1;
    let entries: Awaited<ReturnType<DiscoverFs["readdir"]>>;
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const e of entries.slice(0, MAX_ENTRIES_PER_DIR)) {
      const full = join(dir, e.name);
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try {
          const s = await fs.stat(full);
          isDir = s.isDirectory();
          isFile = s.isFile();
        } catch {
          continue;
        }
      }
      if (isFile && /\.gguf$/i.test(e.name)) found.push({ path: full, where: root.where });
      else if (isDir && depth < root.depth && !SKIP_DIRS.has(e.name.toLowerCase())) queue.push({ dir: full, depth: depth + 1 });
    }
  }
  return found;
}

/** Ollama keeps weights in blobs/sha256-<digest> and names them in manifests/<host>/<namespace>/<model>/<tag>. */
async function walkOllama(fs: DiscoverFs, root: Root, seen: Set<string>, clock: Clock, signal?: AbortSignal): Promise<Candidate[]> {
  const manifests = join(root.dir, "manifests");
  try {
    await fs.realpath(manifests);
  } catch {
    return [];
  }
  const files: { path: string; parts: string[] }[] = [];
  const queue: { dir: string; parts: string[] }[] = [{ dir: manifests, parts: [] }];
  let dirs = 0;
  while (queue.length && dirs < MAX_DIRS_PER_ROOT) {
    if (clock.expired() || signal?.aborted) break;
    const { dir, parts } = queue.shift() as { dir: string; parts: string[] };
    let real: string;
    try {
      real = await fs.realpath(dir);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    dirs += 1;
    try {
      for (const e of (await fs.readdir(dir)).slice(0, MAX_ENTRIES_PER_DIR)) {
        if (e.isDirectory() && parts.length < 5) queue.push({ dir: join(dir, e.name), parts: [...parts, e.name] });
        else if (e.isFile()) files.push({ path: join(dir, e.name), parts: [...parts, e.name] });
      }
    } catch {
      /* unreadable folder */
    }
  }

  const out: Candidate[] = [];
  for (const f of files.slice(0, MAX_FILES_PER_ROOT)) {
    if (clock.expired() || signal?.aborted) break;
    try {
      const json = JSON.parse(await fs.readText(f.path, 256 * 1024)) as { layers?: { mediaType?: unknown; digest?: unknown }[] };
      const layer = json.layers?.find((l) => l.mediaType === "application/vnd.ollama.image.model");
      const m = typeof layer?.digest === "string" ? /^sha256:([0-9a-f]{64})$/.exec(layer.digest) : null;
      if (!m) continue;
      // parts = [registry host, namespace, model..., tag]; the host is never part of the label.
      const [, ns, ...rest] = f.parts;
      const tag = rest.pop() ?? "latest";
      const model = rest.join("/") || ns || "model";
      const prefix = ns && ns !== "library" && rest.length ? `${ns}/` : "";
      out.push({ path: join(root.dir, "blobs", `sha256-${m[1]}`), where: root.where, hint: `${prefix}${model}:${tag}` });
    } catch {
      /* not a manifest */
    }
  }
  return out;
}

// ---------------------------------------------------------------- hashing

async function sha256File(fs: DiscoverFs, path: string, deadline: number, signal?: AbortSignal): Promise<string | null> {
  const h = await fs.open(path);
  try {
    const hash = createHash("sha256");
    const buf = Buffer.allocUnsafe(8 * 1024 * 1024);
    let pos = 0;
    for (;;) {
      if (signal?.aborted || Date.now() > deadline) return null;
      const { bytesRead } = await h.read(buf, 0, buf.length, pos);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
      pos += bytesRead;
    }
    return hash.digest("hex");
  } finally {
    await h.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- one file

interface Ctx {
  fs: DiscoverFs;
  catalog: readonly PinnedModel[];
  ramBytes: number;
  minBytes: number;
  includeUnknown: boolean;
  windowTokens: number;
  hashBudgetMs: number;
  hashCache: Map<string, string>;
  signal?: AbortSignal;
  hashed: DiscoveryReport["hashed"];
}

interface Outcome {
  file?: DiscoveredFile;
  skipped?: Skipped;
  /** Size matches a pinned model: hashing is left for after the folder scan so it cannot eat the scan's time. */
  pending?: Candidate;
}

const skip = (path: string, reason: SkipReason, detail?: string): Outcome => ({ skipped: { path, reason, detail } });

async function inspect(c: Ctx, cand: Candidate, hashNow: boolean): Promise<Outcome> {
  const path = resolve(cand.path);
  const fileName = basename(cand.path);
  let size: number;
  let mtimeMs: number;
  try {
    const s = await c.fs.stat(cand.path);
    if (!s.isFile()) return skip(path, "not-a-model", "not a file");
    size = s.size;
    mtimeMs = s.mtimeMs;
  } catch {
    return skip(path, "missing");
  }

  const shard = SHARD.exec(fileName);
  let total = size;
  if (shard) {
    if (Number(shard[1]) !== 1) return skip(path, "split-part", "only the first part is listed");
    // The first part is listed with the size of all its parts, since the engine loads them together.
    const count = Number(shard[2]);
    total = 0;
    for (let i = 1; i <= count; i++) {
      const part = cand.path.replace(SHARD, `-${String(i).padStart(5, "0")}-of-${shard[2]}.gguf`);
      try {
        total += (await c.fs.stat(part)).size;
      } catch {
        return skip(path, "unreadable", "a part of this split file is missing");
      }
    }
  }

  const label = cand.hint ?? fileName;
  if (NAME_REJECT.test(label)) return skip(path, /mmproj|projector/i.test(label) ? "projector" : "embedding", label);

  const pin = c.catalog.find((m) => m.bytes === size && !shard);
  if (pin) {
    if (pin.memoryBytes > c.ramBytes * FIT_SHARE) return skip(path, "too-big", `${pin.label} needs about ${gib(pin.memoryBytes)} GB`);
    const key = `${path}|${size}|${mtimeMs}`;
    let digest = c.hashCache.get(key) ?? null;
    if (!digest && !hashNow) return { pending: cand };
    if (!digest) {
      const t0 = Date.now();
      digest = await sha256File(c.fs, cand.path, t0 + c.hashBudgetMs, c.signal).catch(() => null);
      c.hashed.push({ path, ms: Date.now() - t0, match: digest === pin.sha256 });
      if (digest) c.hashCache.set(key, digest);
    }
    if (digest === pin.sha256) {
      return {
        file: {
          id: sha1(path),
          path,
          label: pin.label,
          bytes: size,
          sizeGb: gib(size),
          where: cand.where,
          kind: "exact",
          modelId: pin.id,
          fileName,
        },
      };
    }
    // Same size, different content: judge it by its header like any other file.
  }

  if (size < c.minBytes) return skip(path, "too-small", `${gib(size)} GB`);
  if (total > c.ramBytes * FIT_SHARE) return skip(path, "too-big", `${gib(total)} GB`);

  let info: GgufInfo;
  try {
    info = await readGgufHeader(c.fs, cand.path);
  } catch (e) {
    return skip(path, e instanceof Bad && e.message === "not-gguf" ? "not-gguf" : "unreadable", e instanceof Error ? e.message : String(e));
  }
  const arch = info.arch?.toLowerCase() ?? "";
  if (!arch) return skip(path, "unreadable", "no architecture");
  if (ARCH_REJECT.has(arch)) return skip(path, arch === "clip" || arch === "mmproj" ? "projector" : "embedding", arch);
  if (info.type && info.type !== "model") return skip(path, "not-a-model", `type ${info.type}`);

  const kind: DiscoveredModel["kind"] = ARCH_OK.some((re) => re.test(arch)) ? "compatible" : "unknown";
  if (kind === "unknown") {
    if (!c.includeUnknown) return skip(path, "unknown-arch", arch);
  } else {
    if (!info.hasChatTemplate) return skip(path, "no-template", arch);
    if (info.contextLength !== null && info.contextLength < MIN_CONTEXT) return skip(path, "short-context", String(info.contextLength));
    if (total + windowBytes(info, total, c.windowTokens) > c.ramBytes * FIT_SHARE) return skip(path, "too-big", `${gib(total)} GB plus its working memory`);
  }

  return {
    file: {
      id: sha1(path),
      path,
      label: prettyLabel(info, cand.hint ? `${cand.hint}.gguf` : fileName),
      bytes: total,
      sizeGb: gib(total),
      where: cand.where,
      kind,
      fileName,
      ...(info.contextLength ? { contextTokens: info.contextLength } : {}),
    },
  };
}

// ---------------------------------------------------------------- ordering

/** How far a file's size is from what this much memory handles comfortably. Smaller is better. */
export function fitDistance(bytes: number, ramBytes: number): number {
  const ideal = Math.min(Math.max(ramBytes * 0.25, 3e9), 9e9);
  return Math.abs(Math.log(bytes / ideal));
}

function order(files: DiscoveredFile[], ramBytes: number): DiscoveredFile[] {
  const rank = { exact: 0, compatible: 1, unknown: 2 } as const;
  return [...files].sort((a, b) => rank[a.kind] - rank[b.kind] || fitDistance(a.bytes, ramBytes) - fitDistance(b.bytes, ramBytes) || a.label.localeCompare(b.label));
}

function context(o: DiscoverOptions): { c: Ctx; platform: NodeJS.Platform; home: string; env: Record<string, string | undefined> } {
  return {
    platform: o.platform ?? process.platform,
    home: o.home ?? homedir(),
    env: o.env ?? process.env,
    c: {
      fs: o.fs ?? realFs,
      catalog: o.catalog ?? MODELS,
      ramBytes: o.ramBytes > 0 ? o.ramBytes : totalmem(),
      minBytes: o.minBytes ?? MIN_BYTES,
      includeUnknown: o.includeUnknown ?? false,
      windowTokens: o.windowTokens ?? CONTEXT_TOKENS,
      hashBudgetMs: o.hashBudgetMs ?? 120_000,
      hashCache: o.hashCache ?? new Map(),
      signal: o.signal,
      hashed: [],
    },
  };
}

async function pool<T>(items: T[], size: number, stop: () => boolean, fn: (t: T) => Promise<void>): Promise<boolean> {
  let next = 0;
  let cut = false;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        if (stop()) {
          cut = true;
          return;
        }
        await fn(items[next++] as T);
      }
    }),
  );
  return cut;
}

/** The full report: what was found, what was skipped and why, and how long each part took. */
export async function discoverReport(o: DiscoverOptions): Promise<DiscoveryReport> {
  const t0 = Date.now();
  const { c, platform, home, env } = context(o);
  const deadline = t0 + (o.budgetMs ?? 4000);
  const clock: Clock = { expired: () => Date.now() > deadline };
  const roots = await buildRoots({ modelDir: o.modelDir, platform, home, env, fs: c.fs });

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const foldersScanned: DiscoveryReport["foldersScanned"] = [];
  for (const root of roots) {
    if (clock.expired() || c.signal?.aborted) break;
    const found = root.ollama ? await walkOllama(c.fs, root, seen, clock, c.signal) : await walk(c.fs, root, seen, clock, c.signal);
    foldersScanned.push({ where: root.where, dir: root.dir, files: found.length });
    candidates.push(...found);
  }

  // The same file listed under two names (a link, a second copy of the same download) is shown once, at the better place.
  const results = new Array<Outcome | undefined>(candidates.length);
  const realSeen = new Set<string>();
  const unique: { cand: Candidate; index: number }[] = [];
  for (const [index, cand] of candidates.entries()) {
    try {
      const real = await c.fs.realpath(cand.path);
      if (realSeen.has(real)) continue;
      realSeen.add(real);
    } catch {
      continue;
    }
    unique.push({ cand, index });
  }

  const pending: { cand: Candidate; index: number }[] = [];
  const cut = await pool(unique, 4, () => clock.expired() || !!c.signal?.aborted, async ({ cand, index }) => {
    const out = await inspect(c, cand, false);
    if (out.pending) pending.push({ cand, index });
    else results[index] = out;
  });
  const scanMs = Date.now() - t0;

  const h0 = Date.now();
  await pool(pending, 2, () => !!c.signal?.aborted, async ({ cand, index }) => {
    results[index] = await inspect(c, cand, true);
  });
  const hashMs = pending.length ? Date.now() - h0 : 0;

  const files: DiscoveredFile[] = [];
  const skipped: Skipped[] = [];
  const dup = new Set<string>();
  for (const r of results) {
    if (!r) continue;
    if (r.skipped) skipped.push(r.skipped);
    if (!r.file) continue;
    const key = `${r.file.fileName.toLowerCase()}|${r.file.bytes}`;
    if (dup.has(key)) continue;
    dup.add(key);
    files.push(r.file);
  }

  const models = order(files, c.ramBytes).slice(0, o.maxResults ?? MAX_RESULTS);
  return { models, skipped, scanMs, hashMs, totalMs: Date.now() - t0, timedOut: cut || scanMs > (o.budgetMs ?? 4000), foldersScanned, hashed: c.hashed };
}

export async function discoverModels(o: DiscoverOptions): Promise<DiscoveredFile[]> {
  return (await discoverReport(o)).models;
}

// ---------------------------------------------------------------- one chosen file

const PLAIN: Record<SkipReason, string> = {
  "not-gguf": "That file is not an AI file NONON can use. Choose one that ends in .gguf.",
  "too-small": "That file is too small to be a whole AI. Choose a bigger one.",
  embedding: "That file is made for searching, not for writing. Choose an AI that can chat.",
  projector: "That file is only a helper for pictures. Choose the main AI file instead.",
  "too-big": "That AI is too big for the memory in this computer. Choose a smaller one.",
  "split-part": "That file is only one part of a bigger AI. Choose the first part, the one with 00001 in its name.",
  "no-template": "NONON cannot chat with that AI because it has no chat instructions built in. Choose another one.",
  "unknown-arch": "NONON's AI helper may not know how to run that kind of AI, so it is not offered. Choose another one.",
  "short-context": "That AI can only read short texts, which is too little for documents. Choose another one.",
  unreadable: "NONON could not read that file. It may be damaged or only partly downloaded.",
  missing: "NONON could not find that file. It may have been moved or deleted.",
  "not-a-model": "That file is not a whole AI NONON can use. Choose another one.",
};

export function plainSkipReason(reason: SkipReason): string {
  return PLAIN[reason];
}

/** Checks one file the person picked, with the same rules discovery uses. */
export async function inspectModelFile(path: string, o: DiscoverOptions): Promise<{ ok: true; file: DiscoveredFile } | { ok: false; message: string; reason: SkipReason }> {
  const { c } = context({ ...o, includeUnknown: false });
  if (!/\.gguf$/i.test(path)) return { ok: false, reason: "not-gguf", message: PLAIN["not-gguf"] };
  const out = await inspect(c, { path, where: "a file you chose" }, true);
  if (out.file) return { ok: true, file: out.file };
  const reason = out.skipped?.reason ?? "unreadable";
  return { ok: false, reason, message: PLAIN[reason] };
}
