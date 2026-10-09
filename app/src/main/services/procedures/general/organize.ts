import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { lstat, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { ChangeProposalDraft, Check, ProcedureDef, ProcedureOutcome } from "../../../../shared/contracts";
import { extractDocument } from "../doc-common/extract";
import { DATA_RULES, makeLlm, PLAIN_WRITING, type Llm } from "../doc-common/llm";
import { clip, looksLikeInjection } from "../doc-common/text";
import { cleanCategory, classifyByRules, dateInName, DUPLICATES, normaliseName, refuseMove, type GroupBy } from "./organize-rules";

const MAX_FILES = 500;
const AI_BATCH = 20;
const AI_MAX_CATEGORIES = 8;
const BASE_CATEGORIES = ["Invoices", "Contracts", "Reports", "Notes", "Letters", "Meetings", "Study", "Documents"];

export interface ScanFile {
  abs: string;
  name: string;
  size: number;
  mtimeMs: number;
  inSamples: boolean;
}

export interface Scan {
  files: ScanFile[];
  leftInPlace: { rel: string; reason: string }[];
  truncated: boolean;
}

const JUNK = /^(?:thumbs\.db|desktop\.ini|~\$.*|.*\.tmp|.*\.crdownload|.*\.part)$/i;

/** Top-level files plus the files directly inside Samples. Other folders are the user's own and stay untouched. */
export async function scanFolder(folder: string): Promise<Scan> {
  const files: ScanFile[] = [];
  const leftInPlace: Scan["leftInPlace"] = [];
  const root = resolve(folder);
  const take = async (dir: string, inSamples: boolean) => {
    const names = (await readdir(dir)).sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const abs = join(dir, name);
      const rel = relative(root, abs).split(sep).join("/");
      if (name.startsWith(".")) {
        leftInPlace.push({ rel, reason: "hidden file" });
        continue;
      }
      const st = await lstat(abs);
      if (st.isSymbolicLink()) {
        leftInPlace.push({ rel, reason: "shortcut or link" });
        continue;
      }
      if (st.isDirectory()) {
        if (!inSamples && name.toLowerCase() === "samples") await take(abs, true);
        else if (!inSamples && name.toLowerCase() === "nonon output") leftInPlace.push({ rel, reason: "made by NONON earlier" });
        else if (!inSamples && name.toLowerCase() === "sorted") leftInPlace.push({ rel, reason: "a folder that is already sorted" });
        else leftInPlace.push({ rel, reason: "your own folder, left as it is" });
        continue;
      }
      if (!st.isFile()) continue;
      if (JUNK.test(name)) {
        leftInPlace.push({ rel, reason: "temporary or system file" });
        continue;
      }
      files.push({ abs, name, size: st.size, mtimeMs: st.mtimeMs, inSamples });
    }
  };
  await take(root, false);
  const truncated = files.length > MAX_FILES;
  return { files: files.slice(0, MAX_FILES), leftInPlace, truncated };
}

async function sha256(path: string): Promise<string> {
  const h = createHash("sha256");
  await new Promise<void>((ok, fail) => {
    createReadStream(path).on("data", (c) => h.update(c)).on("end", () => ok()).on("error", fail);
  });
  return h.digest("hex");
}

/** Files with identical bytes: the first (preferring ones outside Samples) is kept in place of the others. */
export async function findDuplicates(files: ScanFile[]): Promise<Map<string, string>> {
  const bySize = new Map<number, ScanFile[]>();
  for (const f of files) bySize.set(f.size, [...(bySize.get(f.size) ?? []), f]);
  const dupOf = new Map<string, string>();
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    const byHash = new Map<string, ScanFile[]>();
    for (const f of group) {
      const h = await sha256(f.abs);
      byHash.set(h, [...(byHash.get(h) ?? []), f]);
    }
    for (const same of byHash.values()) {
      if (same.length < 2) continue;
      const ordered = [...same].sort((a, b) => Number(a.inSamples) - Number(b.inSamples) || a.name.length - b.name.length || a.name.localeCompare(b.name));
      for (const extra of ordered.slice(1)) dupOf.set(extra.abs, ordered[0]!.abs);
    }
  }
  return dupOf;
}

const CategorySchema = z.object({
  assignments: z.array(z.object({ id: z.number().int(), category: z.string().max(40) })).max(AI_BATCH),
});

/** The model only picks a folder name for files the rules cannot place. It never sees paths and never moves anything. */
async function suggestCategories(llm: Llm, ambiguous: ScanFile[]): Promise<{ map: Map<string, string>; failed: number }> {
  const map = new Map<string, string>();
  let failed = 0;
  const used = new Set<string>();
  for (let i = 0; i < ambiguous.length; i += AI_BATCH) {
    const batch = ambiguous.slice(i, i + AI_BATCH);
    const items: { id: number; name: string; start?: string }[] = [];
    for (const [j, f] of batch.entries()) {
      const item: { id: number; name: string; start?: string } = { id: j + 1, name: f.name };
      if (f.size < 2_000_000 && /\.(txt|md|docx|pdf)$/i.test(f.name)) {
        const r = await extractDocument(f.abs);
        if (r.ok) {
          const start = clip(r.doc.lines.filter((l) => l.trim()).slice(0, 4).join(" "), 220);
          if (!looksLikeInjection(start)) item.start = start;
        }
      }
      items.push(item);
    }
    const res = await llm.json(
      CategorySchema,
      [
        {
          role: "system",
          content: `You suggest a folder name for each file from its name and, if given, the first words inside. ${DATA_RULES} ${PLAIN_WRITING} Reply with a category for every id.`,
        },
        {
          role: "user",
          content: `Choose one folder name per file. Prefer one of: ${BASE_CATEGORIES.join(", ")}. Use another short plain name (one or two words) only if none fits. Use "Documents" when unsure.\n\nFiles (JSON): ${JSON.stringify(items)}`,
        },
      ],
      `folder categories ${i / AI_BATCH + 1}`,
      { maxTokens: 900 },
    );
    if (!res.ok) {
      failed += 1;
      continue;
    }
    for (const a of res.value.assignments) {
      const file = batch[a.id - 1];
      const cat = cleanCategory(a.category);
      if (!file || !cat) continue;
      if (!BASE_CATEGORIES.includes(cat) && !used.has(cat) && used.size >= AI_MAX_CATEGORIES) continue;
      used.add(cat);
      map.set(file.abs, cat);
    }
  }
  return { map, failed };
}

export interface PlannedMove {
  from: string;
  to: string;
  fromRel: string;
  toRel: string;
  category: string;
  reason: string;
  source: "rule" | "ai" | "duplicate";
  renamed: boolean;
}
export interface Refused {
  rel: string;
  reason: string;
}

export function planMoves(opts: {
  folder: string;
  files: ScanFile[];
  groupBy: GroupBy;
  aiCategory: Map<string, string>;
  dupOf: Map<string, string>;
  exists?: (p: string) => boolean;
}): { moves: PlannedMove[]; refused: Refused[] } {
  const root = resolve(opts.folder);
  const exists = opts.exists ?? existsSync;
  const claimed = new Set<string>();
  const moves: PlannedMove[] = [];
  const refused: Refused[] = [];
  const rel = (p: string) => relative(root, p).split(sep).join("/");

  for (const f of opts.files) {
    const rules = classifyByRules(f.name);
    const ai = !rules.confident ? opts.aiCategory.get(f.abs) : undefined;
    const isDup = opts.dupOf.has(f.abs);
    let category = isDup ? DUPLICATES : (ai ?? rules.category);
    const source: PlannedMove["source"] = isDup ? "duplicate" : ai ? "ai" : "rule";
    let reason = isDup ? `same file as ${basename(opts.dupOf.get(f.abs)!)}` : ai ? `the AI suggested this folder for "${f.name}"` : rules.reason;

    let year = "";
    if (opts.groupBy === "type-year" && category !== DUPLICATES) {
      const d = dateInName(f.name);
      year = String(d?.year ?? new Date(f.mtimeMs).getUTCFullYear());
      reason += d ? `, year ${year} from the file name` : `, year ${year} from when it was last changed`;
    }
    if (!category) category = "Other";

    const newName = normaliseName(f.name);
    const dir = join(root, "Sorted", category, ...(year ? [year] : []));
    let target = join(dir, newName);
    let n = 1;
    while ((exists(target) || claimed.has(target.toLowerCase())) && n < 99) {
      n += 1;
      const ext = extname(newName);
      target = join(dir, `${basename(newName, ext)} (${n})${ext}`);
    }
    const why = refuseMove({ folder: root, from: f.abs, to: target, claimed, exists });
    if (why) {
      refused.push({ rel: rel(f.abs), reason: why });
      continue;
    }
    claimed.add(target.toLowerCase());
    moves.push({ from: f.abs, to: target, fromRel: rel(f.abs), toRel: rel(target), category, reason, source, renamed: basename(target) !== f.name });
  }
  return { moves, refused };
}

const MEDIA = new Set(["Images", "Screenshots", "Audio", "Video"]);
const OTHER = new Set(["Archives", "Installers", "Other", DUPLICATES]);

/** At most three proposals, each a coherent group a person can approve or reject on its own. */
export function toProposals(folder: string, moves: PlannedMove[], groupBy: GroupBy): ChangeProposalDraft[] {
  const groups: { key: string; title: string; why: string; moves: PlannedMove[] }[] = [
    { key: "docs", title: "Documents and records", why: "Invoices, contracts, documents, spreadsheets and presentations", moves: [] },
    { key: "media", title: "Pictures, audio and video", why: "Images, screenshots, audio and video files", moves: [] },
    { key: "other", title: "Archives, installers and exact copies", why: "Archives, installers, files that are exact copies, and anything else", moves: [] },
  ];
  for (const m of moves) {
    const g = MEDIA.has(m.category) ? groups[1]! : OTHER.has(m.category) ? groups[2]! : groups[0]!;
    g.moves.push(m);
  }
  const drafts: ChangeProposalDraft[] = [];
  for (const g of groups) {
    if (g.moves.length === 0) continue;
    const checks: Check[] = [
      { id: "no-overwrite", label: "No file is overwritten", status: "pass", detail: "Every new spot was empty when the plan was made. If two files share a name, one gets (2) or (3) added." },
      { id: "inside-folder", label: "Everything stays inside this project's folder", status: "pass" },
      { id: "no-delete", label: "Nothing is deleted", status: "pass", detail: "Files are only moved or renamed. You can undo it afterwards." },
    ];
    drafts.push({
      target: resolve(folder),
      edits: g.moves.map((m) => ({ op: "rename-move" as const, from: m.from, to: m.to })),
      reason: `${g.why}: ${g.moves.length} file${g.moves.length === 1 ? "" : "s"} into the Sorted folder${groupBy === "type-year" ? ", by type and year" : ", by type"}.`,
      preview: {
        title: `${g.title} (${g.moves.length})`,
        before: [["Current location"], ...g.moves.map((m) => [m.fromRel])],
        after: [["New location"], ...g.moves.map((m) => [m.toRel])],
      },
      checks,
    });
  }
  return drafts;
}

export function planMarkdown(moves: PlannedMove[], refused: Refused[], left: Scan["leftInPlace"]): string {
  const lines = ["# Folder organization plan", "", "Nothing has been moved yet. Below is every change I suggest. Nothing happens until you say OK.", "", "| From | To | Why |", "| --- | --- | --- |"];
  for (const m of moves) lines.push(`| ${m.fromRel} | ${m.toRel} | ${m.reason} |`);
  if (refused.length > 0) lines.push("", "## Left out", "", ...refused.map((r) => `- ${r.rel}: ${r.reason}`));
  if (left.length > 0) lines.push("", "## Not touched", "", ...left.map((l) => `- ${l.rel}: ${l.reason}`));
  return `${lines.join("\n")}\n`;
}

export const organizeFolderReview: ProcedureDef = {
  id: "organize-folder-review",
  pack: "general",
  title: "Tidy a folder (review first)",
  summary: "Get a plan to sort the loose files in your project's folder into neat folders. You see every move before anything changes.",
  supports:
    "Point it at your project's folder. You get a list of exact moves into Sorted folders by file type (and by year if you choose), with tidier file names. Nothing moves until you say OK, and you can undo it afterwards.",
  limits: [
    "Files inside your own folders, hidden files, shortcuts and the NONON Output folder are left alone.",
    "It never overwrites or deletes a file, and never moves anything outside your project's folder. If two files share a name, one gets (2) or (3) added.",
    "Files that are exact copies go to Sorted/Possible duplicates. Nothing is deleted.",
    "Looks at up to 500 files at a time. If you have more, run it again after you approve the first moves. Sorting uses the file name and file type. The AI only suggests a folder for files NONON cannot place.",
  ],
  inputs: [
    {
      key: "groupBy",
      label: "Sort by",
      kind: "choice",
      optional: true,
      options: [
        { value: "type", label: "File type only" },
        { value: "type-year", label: "File type and year" },
      ],
      help: "Default: file type only.",
    },
  ],
  revision: "1",
  async run(ctx): Promise<ProcedureOutcome> {
    const folder = ctx.workspace.folder;
    if (!folder) return { kind: "unsupported", reason: "This project has no folder yet.", suggestion: "Choose a folder for the project first." };
    const st = await stat(folder).catch(() => null);
    if (!st?.isDirectory()) return { kind: "unsupported", reason: "The project's folder could not be opened. It may have been moved or deleted.", suggestion: "Choose the folder again. Nothing was changed." };

    const groupBy: GroupBy = (ctx.text.groupBy ?? ctx.answers.groupBy) === "type-year" ? "type-year" : "type";
    ctx.step("Looking at the folder");
    const scan = await scanFolder(folder);
    if (scan.files.length === 0) {
      return { kind: "done", summary: "There are no loose files here to sort.", outputs: [], proposals: [], checks: [{ id: "files", label: "No loose files found", status: "pass" }], report: { moves: [], leftInPlace: scan.leftInPlace } };
    }

    const llm = makeLlm(ctx.ai, ctx.signal);
    ctx.step("Looking for exact copies");
    const dupOf = await findDuplicates(scan.files);
    const ambiguous = scan.files.filter((f) => !dupOf.has(f.abs) && !classifyByRules(f.name).confident);
    let ai = { map: new Map<string, string>(), failed: 0 };
    if (ambiguous.length > 0) {
      ctx.step("Suggesting folders for unclear files", `${ambiguous.length} file${ambiguous.length === 1 ? "" : "s"}`);
      ai = await suggestCategories(llm, ambiguous);
    }

    ctx.step("Planning the moves");
    const { moves, refused } = planMoves({ folder, files: scan.files, groupBy, aiCategory: ai.map, dupOf });
    const proposals = toProposals(folder, moves, groupBy);

    const outputs = moves.length > 0 ? [await ctx.writeOutput("Folder organization plan.md", planMarkdown(moves, refused, scan.leftInPlace), "md", "Proposed moves")] : [];

    const checks: Check[] = [
      { id: "exact-list", label: `${moves.length} exact move${moves.length === 1 ? "" : "s"} listed; nothing has been changed yet`, status: "pass" },
      { id: "safe-moves", label: "No move overwrites a file, leaves your project's folder, or empties out one of your own folders", status: "pass" },
    ];
    if (refused.length > 0) checks.push({ id: "refused", label: `${refused.length} file${refused.length === 1 ? " was" : "s were"} left out of the plan`, status: "warn", detail: refused.map((r) => `${r.rel}: ${r.reason}`).join("; ") });
    if (dupOf.size > 0) checks.push({ id: "duplicates", label: `${dupOf.size} exact cop${dupOf.size === 1 ? "y" : "ies"} grouped in "${DUPLICATES}"`, status: "pass", detail: "Nothing is deleted; you decide which to keep." });
    if (ambiguous.length > 0) {
      checks.push(
        ai.failed > 0
          ? { id: "ai-folders", label: "The AI could not suggest folders for some unclear files, so they go in the folder for their file type", status: "warn" }
          : { id: "ai-folders", label: `The AI suggested folders for ${ai.map.size} of ${ambiguous.length} unclear files`, status: "pass", detail: "Based on the file name and the first words inside; you review every one." },
      );
    }
    if (scan.truncated) checks.push({ id: "limit", label: `Only the first ${MAX_FILES} files were planned`, status: "warn", detail: "Run it again after you approve these moves." });

    return {
      kind: "done",
      summary:
        moves.length === 0
          ? "Nothing needs moving. The files here are already where they belong."
          : `I suggest ${moves.length} move${moves.length === 1 ? "" : "s"}, in ${proposals.length} group${proposals.length === 1 ? "" : "s"}. Nothing has been changed yet. Look over the list and approve what you want.`,
      outputs,
      proposals,
      checks,
      report: {
        groupBy,
        moves: moves.map((m) => ({ from: m.fromRel, to: m.toRel, category: m.category, reason: m.reason, source: m.source, renamed: m.renamed })),
        refused,
        leftInPlace: scan.leftInPlace,
        llm: { calls: llm.stats.calls, retries: llm.stats.retries, failures: llm.stats.failures, ms: llm.stats.ms },
      },
    };
  },
};
