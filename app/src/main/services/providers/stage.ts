import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import type { ChangeProposalDraft } from "../../../shared/contracts";

/** One input NONON puts into the throwaway folder. The provider never sees the original path. */
export type StageInput =
  | { name: string; content: string | Uint8Array }
  | { name: string; fromPath: string };

export interface Stage {
  dir: string;
  /** sha256 and size of every file as NONON left it. */
  baseline: Map<string, { sha256: string; size: number }>;
  /** Original text of small text inputs, so a suggested version can be shown next to it. */
  baselineText: Map<string, string>;
  cleanup(): void;
}

export interface StageDiff {
  added: string[];
  modified: string[];
  removed: string[];
}

const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const TEXT_EXT = new Set([".txt", ".md", ".csv", ".json", ".html", ".htm", ".xml", ".yaml", ".yml", ".tsv", ".log", ".rtf", ".ics", ".eml"]);
const MAX_TEXT_BYTES = 1024 * 1024;

function sha(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** A name that cannot climb out of the staged folder. */
export function safeRelativeName(name: string): string {
  const normalised = name.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalised.split("/").filter((p) => p && p !== ".");
  if (parts.length === 0 || parts.some((p) => p === "..") || isAbsolute(name) || /^[a-zA-Z]:/.test(name)) {
    throw new Error(`NONON will not copy a file with this name: ${name}`);
  }
  return parts.join("/");
}

function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(root, full, out);
    else if (entry.isFile()) out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

export function createStage(root: string, inputs: StageInput[] = []): Stage {
  mkdirSync(root, { recursive: true });
  const dir = join(root, `turn-${randomUUID().slice(0, 12)}`);
  mkdirSync(dir, { recursive: true });
  let total = 0;
  const baseline = new Map<string, { sha256: string; size: number }>();
  const baselineText = new Map<string, string>();
  try {
    for (const input of inputs) {
      const rel = safeRelativeName(input.name);
      const dest = join(dir, ...rel.split("/"));
      mkdirSync(dirname(dest), { recursive: true });
      if ("fromPath" in input) {
        total += statSync(input.fromPath).size;
        if (total > MAX_TOTAL_BYTES) throw new Error("The files for this step are too large to send. Use fewer or smaller files.");
        copyFileSync(input.fromPath, dest);
      } else {
        const bytes = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : Buffer.from(input.content);
        total += bytes.byteLength;
        if (total > MAX_TOTAL_BYTES) throw new Error("The files for this step are too large to send. Use fewer or smaller files.");
        writeFileSync(dest, bytes);
      }
      const data = readFileSync(dest);
      baseline.set(rel, { sha256: sha(data), size: data.byteLength });
      if (isTextFile(rel, data)) baselineText.set(rel, data.toString("utf8"));
    }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    dir,
    baseline,
    baselineText,
    cleanup() {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          rmSync(dir, { recursive: true, force: true });
          return;
        } catch {
          // A just-killed program can still hold a handle for a moment on Windows.
          const until = Date.now() + 200;
          while (Date.now() < until) {
            /* brief spin: cleanup is sync by design so a finally block cannot leak the folder */
          }
        }
      }
    },
  };
}

/** Removes leftover turn folders from a crashed run. Only touches folders this module creates. */
export function sweepStages(root: string, olderThanMs = 60 * 60 * 1000): number {
  if (!existsSync(root)) return 0;
  let removed = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("turn-")) continue;
    const full = join(root, entry.name);
    try {
      if (Date.now() - statSync(full).mtimeMs > olderThanMs) {
        rmSync(full, { recursive: true, force: true });
        removed++;
      }
    } catch {
      /* in use; the next sweep gets it */
    }
  }
  return removed;
}

export function diffStage(stage: Stage): StageDiff {
  const now = new Map<string, string>();
  for (const rel of walk(stage.dir)) now.set(rel, sha(readFileSync(join(stage.dir, ...rel.split("/")))));
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  for (const [rel, hash] of now) {
    const before = stage.baseline.get(rel);
    if (!before) added.push(rel);
    else if (before.sha256 !== hash) modified.push(rel);
  }
  for (const rel of stage.baseline.keys()) if (!now.has(rel)) removed.push(rel);
  return { added: added.sort(), modified: modified.sort(), removed: removed.sort() };
}

export function readStaged(stage: Stage, rel: string): Buffer {
  return readFileSync(join(stage.dir, ...rel.split("/")));
}

function isTextFile(rel: string, data: Buffer): boolean {
  if (data.byteLength > MAX_TEXT_BYTES) return false;
  if (!TEXT_EXT.has(extname(rel).toLowerCase())) return false;
  return !data.includes(0);
}

export interface ProposalContext {
  /** Folder under the workspace where NONON may create files. Originals are never the target of a write. */
  outputDir: string;
  /** Original absolute path for each staged input name, when it came from the user's files. */
  originals?: Record<string, string>;
}

/**
 * Turns what a provider did to the staged copy into suggestions. Everything becomes a NEW file in the output folder;
 * nothing here can overwrite an original, and binary or deleted files are reported, not applied.
 */
export function diffToProposals(stage: Stage, diff: StageDiff, ctx: ProposalContext): ChangeProposalDraft[] {
  const drafts: ChangeProposalDraft[] = [];
  const skipped: { id: string; label: string; detail: string }[] = [];
  for (const rel of [...diff.added, ...diff.modified]) {
    const data = readStaged(stage, rel);
    const isNew = diff.added.includes(rel);
    if (!isTextFile(rel, data)) {
      skipped.push({ id: `skip-${rel}`, label: "Not shown as a suggestion", detail: `${rel} is not a plain text file, so it was left out.` });
      continue;
    }
    const text = data.toString("utf8");
    const original = ctx.originals?.[rel];
    const ext = extname(rel);
    const stem = basename(rel, ext);
    const target = join(ctx.outputDir, isNew ? basename(rel) : `${stem} (suggested)${ext}`);
    const before = !isNew ? stage.baselineText.get(rel) : undefined;
    drafts.push({
      target: original ?? target,
      edits: [{ op: "create-file", path: target, text }],
      reason: isNew ? `The connected AI wrote a new file, ${basename(rel)}.` : `The connected AI suggested changes to ${basename(rel)}. Your original stays as it is.`,
      preview: { title: isNew ? `New file: ${basename(rel)}` : `Suggested version of ${basename(rel)}`, ...(before !== undefined ? { before } : {}), after: text },
      checks: [{ id: "staged-copy", label: "Made in a temporary copy", status: "pass", detail: "Your original files were not touched." }],
    });
  }
  for (const rel of diff.removed) {
    skipped.push({ id: `removed-${rel}`, label: "Deletion ignored", detail: `The online AI removed ${rel} from its temporary copy. Nothing was deleted from your files.` });
  }
  if (skipped.length && drafts.length) drafts[0]?.checks.push(...skipped.map((s) => ({ ...s, status: "warn" as const })));
  return drafts;
}
