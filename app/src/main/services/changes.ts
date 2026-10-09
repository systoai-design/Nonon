import { mkdirSync, readdirSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { Check, ChangeEdit, ChangeFileRecord, ChangePreview, ChangeProposal, ChangeProposalDraft, Task, Workspace } from "../../shared/contracts";
import { applyCsvEdit, type EditResult } from "./changes/csv";
import { EditError, plainFsError } from "./changes/errors";
import { atomicWrite, createNew, defaultIo, exists, moveNoOverwrite, pathKey, readSnapshot, saveVerifiedCopy, sha256, type Io, type Snapshot } from "./changes/fsio";
import { checkPreview } from "./changes/preview";
import { applyXlsxEdit, verifyWrittenXlsx } from "./changes/xlsx";
import { newId, nowIso, safeName, sameFingerprint } from "./fs-util";
import type { AppCtx, ChangeService } from "./types";

const STALE_MESSAGE = "This file changed after NONON prepared the change. Nothing was changed. Ask for the change again to use the latest file.";

/** Plain words for a change's internal status, used inside error sentences. */
const STATUS_WORDS: Record<string, string> = {
  staged: "waiting for your OK",
  applying: "being made right now",
  applied: "already made",
  partial: "only partly made",
  failed: "not made because of a problem",
  stale: "out of date",
  rejected: "declined",
  recovered: "already undone",
};
const statusWords = (status: string): string => STATUS_WORDS[status] ?? status;

export interface ChangeServiceOptions {
  /** Test seam for the Windows rename retry; production uses the real filesystem. */
  io?: Io;
}

type Step = { index: number; edit: ChangeEdit; path: string; input: Buffer | null; result: EditResult | null };

const clone = <T>(v: T): T => structuredClone(v);

function editPaths(edit: ChangeEdit): string[] {
  return edit.op === "rename-move" ? [edit.from, edit.to] : [edit.path];
}

function describeEdit(edit: ChangeEdit): string {
  switch (edit.op) {
    case "create-file":
      return `Create ${basename(edit.path)}`;
    case "csv-set-cells": {
      const n = edit.cells.length;
      const k = edit.appendColumns?.length ?? 0;
      const parts = [n > 0 ? `update ${n} cell${n === 1 ? "" : "s"}` : "", k > 0 ? `add ${k} column${k === 1 ? "" : "s"}` : ""].filter(Boolean);
      return `${(parts.join(" and ") || "update").replace(/^./, (c) => c.toUpperCase())} in ${basename(edit.path)}`;
    }
    case "xlsx-set-cells": {
      const n = edit.cells.length;
      const k = edit.appendColumns?.length ?? 0;
      const parts = [n > 0 ? `update ${n} cell${n === 1 ? "" : "s"}` : "", k > 0 ? `add ${k} column${k === 1 ? "" : "s"}` : ""].filter(Boolean);
      return `${(parts.join(" and ") || "update").replace(/^./, (c) => c.toUpperCase())} in sheet "${edit.sheet}" of ${basename(edit.path)}`;
    }
    case "rename-move":
      return `Move ${basename(edit.from)} to ${edit.to}`;
  }
}

/** A folder-organizing proposal names the folder as its target; every moved file is fingerprinted on its own record instead. */
async function isFolder(path: string): Promise<boolean> {
  try {
    return (await fsp.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** After a move is undone, drop the now-empty folders the move created (rmdir only succeeds on an empty folder), never the project folder itself. */
async function removeEmptyParents(from: string, ws: Workspace | undefined): Promise<void> {
  const root = ws?.folder ? resolve(ws.folder) : null;
  if (!root) return;
  let dir = dirname(resolve(from));
  while (dir !== root && dir.startsWith(root)) {
    try {
      await fsp.rmdir(dir);
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

async function nearestExistingIsFolder(path: string): Promise<boolean> {
  let p = resolve(path, "..");
  for (;;) {
    try {
      return (await fsp.stat(p)).isDirectory();
    } catch {
      const up = resolve(p, "..");
      if (up === p) return false;
      p = up;
    }
  }
}

/** Runs one content edit against the bytes the file would have at that point. Shared by stage (dry run) and apply. */
async function transform(edit: ChangeEdit, current: Buffer | null): Promise<EditResult> {
  switch (edit.op) {
    case "create-file": {
      if (current !== null) throw new EditError(`${basename(edit.path)} already exists, so NONON will not replace it.`);
      if (typeof edit.text !== "string") throw new EditError("The text for the new file is missing.");
      return {
        bytes: Buffer.from(edit.text, "utf8"),
        notes: [],
        preview: { title: `New file: ${basename(edit.path)}`, after: edit.text.length > 2000 ? `${edit.text.slice(0, 2000)}...` : edit.text },
      };
    }
    case "csv-set-cells":
      if (current === null) throw new EditError(`${basename(edit.path)} was not found.`);
      return applyCsvEdit(current, edit, basename(edit.path));
    case "xlsx-set-cells":
      if (current === null) throw new EditError(`${basename(edit.path)} was not found.`);
      return applyXlsxEdit(current, edit, basename(edit.path));
    case "rename-move":
      throw new EditError("NONON cannot change what is inside a file by moving it.");
  }
}

export function createChangeService(ctx: AppCtx, options: ChangeServiceOptions = {}): ChangeService {
  const io = options.io ?? defaultIo;
  const cache = new Map<string, ChangeProposal>();
  const locks = new Map<string, Promise<void>>();

  const changesDir = ctx.store.path("changes");
  mkdirSync(changesDir, { recursive: true });
  for (const f of readdirSync(changesDir)) {
    if (!f.endsWith(".json")) continue;
    const p = ctx.store.read<ChangeProposal | null>(`changes/${f}`, null);
    if (p?.id) cache.set(p.id, p);
  }
  for (const p of cache.values()) {
    if (p.status === "applying") {
      // The app died mid-apply. Each write is atomic, so the file is whole, but we cannot know which steps landed.
      p.status = "failed";
      p.error = `NONON closed while it was making this change, so it is not certain what was saved. ${p.recoveryPath ? `Your earlier version is saved at ${p.recoveryPath}.` : "Check the file."}`;
      save(p);
    }
  }

  function save(p: ChangeProposal): void {
    ctx.store.write(`changes/${p.id}.json`, p);
  }

  function publish(p: ChangeProposal): ChangeProposal {
    save(p);
    ctx.emit("change:updated", clone(p));
    return clone(p);
  }

  async function withLocks<T>(paths: string[], fn: () => Promise<T>): Promise<T> {
    const keys = [...new Set(paths.map(pathKey))].sort();
    const releases: (() => void)[] = [];
    for (const k of keys) {
      const prev = locks.get(k) ?? Promise.resolve();
      let release!: () => void;
      const mine = new Promise<void>((ok) => {
        release = ok;
      });
      const tail = prev.then(() => mine);
      locks.set(k, tail);
      await prev;
      releases.push(() => {
        release();
        if (locks.get(k) === tail) locks.delete(k);
      });
    }
    try {
      return await fn();
    } finally {
      for (const r of releases) r();
    }
  }

  const lockPaths = (p: ChangeProposal): string[] => [p.target, ...(p.files ?? []).flatMap((f) => [f.path, ...(f.movedTo ? [f.movedTo] : [])])];

  /** One place for the autoApply policy. It is workspace-scoped and explicit, and it never covers send, delete,
   *  commands or provider use (no such edit exists here). Moving a user's file is also always reviewed by a person. */
  function mayAutoApply(ws: Workspace, p: ChangeProposal): boolean {
    if (!ws.autoApply || p.status !== "staged") return false;
    if (p.edits.some((e) => e.op === "rename-move")) return false;
    return p.checks.length > 0 && p.checks.every((c) => c.status === "pass");
  }

  // ------------------------------------------------------------------ stage

  function resolveInside(ws: Workspace, path: string): string {
    const abs = isAbsolute(path) ? resolve(path) : resolve(ws.folder ?? "", path);
    ctx.svc.workspaces.assertInside(ws.id, abs);
    return abs;
  }

  function normaliseDraft(ws: Workspace, draft: ChangeProposalDraft): ChangeProposalDraft {
    const edits = draft.edits.map((e): ChangeEdit => {
      if (e.op === "rename-move") return { ...e, from: resolveInside(ws, e.from), to: resolveInside(ws, e.to) };
      return { ...e, path: resolveInside(ws, e.path) };
    });
    return { ...draft, target: resolveInside(ws, draft.target), edits, checks: [...(draft.checks ?? [])] };
  }

  async function stageOne(task: Task, ws: Workspace, draft: ChangeProposalDraft): Promise<ChangeProposal> {
    const checks: Check[] = [...draft.checks];
    const add = (c: Check): void => {
      checks.push(c);
    };

    let targetSnap: Snapshot | null = null;
    const folderTarget = await isFolder(draft.target);
    try {
      if (!folderTarget) targetSnap = await readSnapshot(draft.target);
    } catch (e) {
      add({ id: "target", label: "The file can be read", status: "fail", detail: plainFsError(e, basename(draft.target)) });
    }
    if (folderTarget && draft.edits.every((e) => e.op === "rename-move")) {
      add({ id: "target", label: "Every file is checked on its own", status: "pass", detail: "NONON notes each file before moving it, and stops if any file has changed." });
    } else if (!checks.some((c) => c.id === "target")) {
      add({
        id: "target",
        label: targetSnap ? "Original file noted" : "The file does not exist yet",
        status: "pass",
        ...(targetSnap ? { detail: "NONON noted the file as it is now. It will stop if the file changes before you say OK." } : {}),
      });
    }

    // A path is either renamed, created, or edited in place. Mixing them has no safe order.
    const roles = new Map<string, Set<string>>();
    const roleOf = (path: string, role: string): void => {
      const k = pathKey(path);
      (roles.get(k) ?? roles.set(k, new Set()).get(k)!).add(role);
    };
    const opCount = new Map<string, number>();
    for (const e of draft.edits) {
      if (e.op === "rename-move") {
        roleOf(e.from, "move");
        roleOf(e.to, "move");
        opCount.set(pathKey(e.from), (opCount.get(pathKey(e.from)) ?? 0) + 1);
        opCount.set(pathKey(e.to), (opCount.get(pathKey(e.to)) ?? 0) + 1);
      } else {
        roleOf(e.path, e.op === "create-file" ? "create" : "edit");
        opCount.set(pathKey(e.path), (opCount.get(pathKey(e.path)) ?? 0) + 1);
      }
    }
    const conflicted = [...roles.entries()].filter(([k, r]) => r.size > 1 || ((r.has("move") || r.has("create")) && (opCount.get(k) ?? 0) > 1));
    if (conflicted.length > 0) {
      add({ id: "edits-conflict", label: "Changes do not overlap", status: "fail", detail: "Two changes use the same file in a way NONON cannot do safely. For example, making a file and then editing it, or moving it and then editing it." });
    }
    if (draft.edits.length === 0) add({ id: "edits-empty", label: "There is something to change", status: "fail", detail: "There are no changes in this one." });
    if (!folderTarget && !draft.edits.some((e) => editPaths(e).some((p) => pathKey(p) === pathKey(draft.target)))) {
      add({ id: "target-in-edits", label: "Changes are for the chosen file", status: "warn", detail: "None of the changes are for the file this change was meant for." });
    }

    const records: ChangeFileRecord[] = [];
    const state = new Map<string, Buffer | null | "failed">();
    const previews: ChangePreview[] = [];
    for (let i = 0; i < draft.edits.length; i++) {
      const edit = draft.edits[i]!;
      const id = `edit-${i}`;
      const label = describeEdit(edit);
      try {
        if (edit.op === "rename-move") {
          const from = await readSnapshot(edit.from);
          if (!from) throw new EditError(`${basename(edit.from)} was not found.`);
          if (pathKey(edit.from) === pathKey(edit.to)) throw new EditError("The new name is the same as the old one.");
          if (await exists(edit.to)) throw new EditError(`${edit.to} already exists, so NONON will not replace it.`);
          if (!(await nearestExistingIsFolder(edit.to))) throw new EditError(`A file is in the way of the folder path ${edit.to}.`);
          records.push({ path: edit.from, kind: "moved", base: from.fp, movedTo: edit.to });
          previews.push({ title: `Move ${basename(edit.from)}`, before: edit.from, after: edit.to });
          add({ id, label, status: "pass" });
          continue;
        }
        const k = pathKey(edit.path);
        const prior = state.get(k);
        if (prior === "failed") throw new EditError("An earlier change to this same file could not be checked.");
        let current: Buffer | null;
        if (prior !== undefined) current = prior;
        else {
          const snap = await readSnapshot(edit.path);
          current = snap?.bytes ?? null;
          if (edit.op === "create-file" && !(await nearestExistingIsFolder(edit.path))) {
            throw new EditError(`A file is in the way of the folder path ${edit.path}.`);
          }
          records.push({ path: edit.path, kind: edit.op === "create-file" ? "created" : "modified", base: snap?.fp ?? null });
        }
        const result = await transform(edit, current);
        state.set(k, result.bytes);
        previews.push(result.preview);
        add({ id, label, status: "pass" });
        if (result.notes.length > 0) add({ id: `${id}-notes`, label: `${label}: worth a look`, status: "warn", detail: result.notes.join(" ") });
      } catch (e) {
        if (edit.op !== "rename-move") state.set(pathKey(edit.path), "failed");
        if (!(e instanceof EditError)) ctx.log(`change check failed: ${e instanceof Error ? e.message : String(e)}`);
        const detail = e instanceof EditError ? e.plain : "NONON could not read this file. Check that it is not open in another program.";
        add({ id, label, status: "fail", detail });
      }
    }

    let preview: ChangePreview | undefined;
    const given = draft.preview === undefined || draft.preview === null ? null : checkPreview(draft.preview);
    if (given?.ok) preview = given.preview;
    else {
      preview = previews[0];
      if (given && !given.ok) add({ id: "preview", label: "The preview can be shown", status: preview ? "warn" : "fail", detail: `${given.error}${preview ? " NONON made a new preview from the real file instead." : ""}` });
    }
    if (!preview) preview = { title: draft.edits[0] ? describeEdit(draft.edits[0]) : "Change" };

    const proposal: ChangeProposal = {
      ...draft,
      preview,
      checks,
      id: newId("chg"),
      taskId: task.id,
      workspaceId: ws.id,
      procedureRevision: task.procedureRevision,
      base: targetSnap?.fp ?? null,
      createdAt: nowIso(),
      status: "staged",
      files: records,
    };
    cache.set(proposal.id, proposal);
    return proposal;
  }

  async function stage(task: Task, drafts: ChangeProposalDraft[]): Promise<ChangeProposal[]> {
    const ws = ctx.svc.workspaces.get(task.workspaceId);
    if (!ws) throw new Error("This project no longer exists.");
    // Every path is checked before anything is recorded, so one bad draft cannot leave a half-staged batch.
    const normalised = drafts.map((d) => normaliseDraft(ws, d));
    const staged: ChangeProposal[] = [];
    for (const d of normalised) staged.push(await stageOne(task, ws, d));
    const out: ChangeProposal[] = [];
    for (const p of staged) {
      publish(p);
      if (mayAutoApply(ws, p)) {
        try {
          out.push(await apply(p.id));
        } catch (e) {
          ctx.log(`autoApply failed for ${p.id}: ${e instanceof Error ? e.message : String(e)}`);
          out.push(clone(cache.get(p.id)!));
        }
      } else out.push(clone(p));
    }
    return out;
  }

  // ------------------------------------------------------------------ apply

  function finishFailed(p: ChangeProposal, status: "failed" | "stale", error: string): ChangeProposal {
    p.status = status;
    p.error = error;
    return publish(p);
  }

  async function apply(id: string): Promise<ChangeProposal> {
    const p = cache.get(id);
    if (!p) throw new Error("That change was not found.");
    if (p.status === "applied") throw new Error("This change was already made.");
    if (p.status !== "staged") throw new Error(`NONON cannot make this change now. It is ${statusWords(p.status)}.`);

    const blocker = p.checks.find((c) => c.status === "fail");
    if (blocker) {
      p.error = `NONON did not make this change. Nothing was changed. Problem: ${blocker.label}.${blocker.detail ? ` ${blocker.detail}` : ""}`;
      return publish(p);
    }

    // Set before any await so a second click cannot start a second apply.
    p.status = "applying";
    delete p.error;
    publish(p);
    try {
      return await withLocks(lockPaths(p), () => doApply(p));
    } catch (e) {
      ctx.log(`change ${p.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      return finishFailed(p, "failed", "Something went wrong while making this change. Check the file before you try again.");
    }
  }

  async function doApply(p: ChangeProposal): Promise<ChangeProposal> {
    const ws = ctx.svc.workspaces.get(p.workspaceId);
    if (!ws) return finishFailed(p, "failed", "This project no longer exists, so nothing was changed.");
    try {
      resolveInside(ws, p.target);
      for (const e of p.edits) for (const path of editPaths(e)) resolveInside(ws, path);
    } catch (e) {
      return finishFailed(p, "failed", `${e instanceof Error ? e.message : String(e)} Nothing was changed.`);
    }

    // 1. Re-check everything against the disk right now, under the lock.
    const files = p.files ?? [];
    const snaps = new Map<string, Snapshot | null>();
    let stale = false;
    try {
      const target = (await isFolder(p.target)) ? null : await readSnapshot(p.target);
      if (!sameFingerprint(p.base, target?.fp ?? null)) stale = true;
      for (const f of files) {
        const snap = await readSnapshot(f.path);
        snaps.set(pathKey(f.path), snap);
        if (!sameFingerprint(f.base, snap?.fp ?? null)) stale = true;
        if (f.movedTo && (await exists(f.movedTo))) stale = true;
      }
    } catch (e) {
      return finishFailed(p, "failed", `${plainFsError(e, basename(p.target))} Nothing was changed.`);
    }
    if (stale) return finishFailed(p, "stale", STALE_MESSAGE);

    // 2. Dry-run every edit in memory so unsupported content is refused before the first byte is written.
    const steps: Step[] = [];
    const virtual = new Map<string, Buffer | null>();
    for (const f of files) virtual.set(pathKey(f.path), snaps.get(pathKey(f.path))?.bytes ?? null);
    for (let i = 0; i < p.edits.length; i++) {
      const edit = p.edits[i]!;
      if (edit.op === "rename-move") {
        steps.push({ index: i, edit, path: edit.from, input: null, result: null });
        continue;
      }
      const k = pathKey(edit.path);
      const input = virtual.get(k) ?? null;
      try {
        const result = await transform(edit, input);
        virtual.set(k, result.bytes);
        steps.push({ index: i, edit, path: edit.path, input, result });
      } catch (e) {
        p.editResults = p.edits.map((_, index) => ({ index, ok: false, ...(index === i ? { error: e instanceof EditError ? e.plain : String(e) } : { error: "Not tried." }) }));
        return finishFailed(p, "failed", `${e instanceof EditError ? e.plain : String(e)} Nothing was changed.`);
      }
    }

    // 3. Recovery copies, each proven identical by checksum, before anything is written.
    const recDir = join(ctx.paths.dataDir, "recovery", p.id);
    try {
      let n = 0;
      for (const f of files) {
        const snap = snaps.get(pathKey(f.path));
        if (!snap) continue;
        const dest = join(recDir, `${n++}-${safeName(f.path)}`);
        const sum = await saveVerifiedCopy(dest, snap.bytes);
        if (sum !== f.base?.sha256) throw new EditError("The safe copy of your original did not come out right.");
        f.recoveryPath = dest;
      }
    } catch (e) {
      return finishFailed(p, "failed", `${e instanceof EditError ? e.plain : plainFsError(e, recDir)} Nothing was changed.`);
    }
    const targetRecord = files.find((f) => pathKey(f.path) === pathKey(p.target)) ?? files.find((f) => f.recoveryPath);
    if (targetRecord?.recoveryPath) p.recoveryPath = targetRecord.recoveryPath;
    save(p);

    // 4. Write one edit at a time, stopping at the first failure so the report stays exact.
    const results: { index: number; ok: boolean; error?: string }[] = [];
    let failedAt = -1;
    for (const step of steps) {
      try {
        await writeStep(step, files);
        results.push({ index: step.index, ok: true });
      } catch (e) {
        failedAt = step.index;
        results.push({ index: step.index, ok: false, error: e instanceof EditError ? e.plain : plainFsError(e, basename(step.path)) });
        break;
      }
    }
    for (let i = results.length; i < p.edits.length; i++) results.push({ index: i, ok: false, error: "Not tried because an earlier step failed." });
    p.editResults = results;

    if (failedAt < 0) {
      const moved = files.find((f) => pathKey(f.path) === pathKey(p.target) && f.movedTo);
      const fpRecord = files.find((f) => pathKey(f.path) === pathKey(p.target));
      const applied = fpRecord?.applied ?? (moved ? moved.applied : undefined);
      if (applied) p.appliedFingerprint = applied;
      else {
        const any = files.find((f) => f.applied);
        if (any?.applied) p.appliedFingerprint = any.applied;
      }
      p.appliedAt = nowIso();
      p.status = "applied";
      delete p.error;
      return publish(p);
    }

    const done = results.filter((r) => r.ok).length;
    const total = p.edits.length;
    const notDone = results.filter((r) => !r.ok).map((r) => r.index + 1);
    const why = results.find((r) => !r.ok)?.error ?? "an unknown problem";
    const saved = p.recoveryPath ? ` Your original is saved at ${p.recoveryPath}.` : "";
    if (done === 0) {
      return finishFailed(p, "failed", `Step ${failedAt + 1} of ${total} failed: ${why} Nothing was changed.${saved}`);
    }
    p.status = "partial";
    p.error = `Only ${done} of ${total} steps were done. Step ${failedAt + 1} failed: ${why} Not done: step${notDone.length === 1 ? "" : "s"} ${notDone.join(", ")}.${saved}`;
    return publish(p);
  }

  async function writeStep(step: Step, files: ChangeFileRecord[]): Promise<void> {
    const { edit } = step;
    const record = files.find((f) => pathKey(f.path) === pathKey(step.path));
    if (!record) throw new EditError("NONON lost track of this file. Nothing more was changed.");

    if (edit.op === "rename-move") {
      await moveNoOverwrite(edit.from, edit.to, io);
      const after = await readSnapshot(edit.to);
      if (!after || after.fp.sha256 !== record.base?.sha256) {
        if (after) record.applied = after.fp;
        throw new EditError("The moved file does not look the same as the original, so NONON is not sure it is safe. Check it before you go on.");
      }
      record.applied = after.fp;
      return;
    }

    const bytes = step.result!.bytes;
    if (edit.op === "create-file") await createNew(edit.path, bytes, io);
    else await atomicWrite(edit.path, bytes, io);

    const after = await readSnapshot(edit.path);
    if (!after || after.fp.sha256 !== sha256(bytes)) {
      if (after) record.applied = after.fp;
      throw new EditError("The saved file is not what NONON meant to write, so NONON is not sure it is right. Your earlier version is kept in the backup folder.");
    }
    record.applied = after.fp;

    if (edit.op === "xlsx-set-cells" && step.input) {
      const problem = await verifyWrittenXlsx(step.input, after.bytes, edit);
      if (problem) {
        try {
          await atomicWrite(edit.path, step.input, io);
          const restored = await readSnapshot(edit.path);
          if (!restored || sha256(restored.bytes) !== sha256(step.input)) throw new Error("restore mismatch");
          record.applied = restored.fp;
          throw new EditError(`NONON checked the saved spreadsheet and found a problem (${problem}), so it put your original back.`);
        } catch (e) {
          if (e instanceof EditError) throw e;
          throw new EditError(`NONON found a problem with the saved spreadsheet (${problem}) and could not put the original back, so the file may be damaged. Your original is kept in the backup folder.`);
        }
      }
    }
  }

  // ------------------------------------------------------------------ reject / recover

  function reject(id: string): ChangeProposal {
    const p = cache.get(id);
    if (!p) throw new Error("That change was not found.");
    if (p.status !== "staged" && p.status !== "stale") throw new Error(`NONON cannot decline this change now. It is ${statusWords(p.status)}.`);
    p.status = "rejected";
    delete p.error;
    return publish(p);
  }

  async function recover(id: string): Promise<ChangeProposal> {
    const p = cache.get(id);
    if (!p) throw new Error("That change was not found.");
    if (p.status !== "applied" && p.status !== "partial" && p.status !== "failed") {
      throw new Error(`NONON cannot undo this change. It is ${statusWords(p.status)}.`);
    }
    if (!(p.files ?? []).some((f) => f.applied)) throw new Error("This change did not save anything, so there is nothing to undo.");
    return withLocks(lockPaths(p), () => doRecover(p));
  }

  async function doRecover(p: ChangeProposal): Promise<ChangeProposal> {
    const ws = ctx.svc.workspaces.get(p.workspaceId);
    const written = (p.files ?? []).filter((f) => f.applied);
    type Plan = { f: ChangeFileRecord; action: "restore" | "delete" | "move-back" | "none" };
    const plan: Plan[] = [];

    for (const f of written) {
      const applied = f.applied!;
      if (f.kind === "moved") {
        const cur = f.movedTo ? await readSnapshot(f.movedTo) : null;
        if (!cur || !sameFingerprint(cur.fp, applied)) {
          return refuse(p, `The moved file was changed or removed after NONON moved it, so NONON will not move it back.${saved(f)}`);
        }
        if (await exists(f.path)) {
          return refuse(p, `Something new is now at the original location ${f.path}, so NONON will not move the file back over it.${saved(f)}`);
        }
        plan.push({ f, action: "move-back" });
        continue;
      }
      const cur = await readSnapshot(f.path);
      if (f.kind === "created") {
        if (!cur) plan.push({ f, action: "none" });
        else if (!sameFingerprint(cur.fp, applied)) return refuse(p, `You changed ${basename(f.path)} after NONON created it, so NONON will not delete it.`);
        else plan.push({ f, action: "delete" });
        continue;
      }
      if (!cur || !sameFingerprint(cur.fp, applied)) {
        return refuse(p, `You changed this file after NONON made the change, so NONON will not overwrite it.${saved(f)}`);
      }
      plan.push({ f, action: "restore" });
    }

    // Prove every recovery copy is intact before touching any file.
    const originals = new Map<string, Buffer>();
    for (const { f, action } of plan) {
      if (action !== "restore") continue;
      try {
        const bytes = await fsp.readFile(f.recoveryPath ?? "");
        if (sha256(bytes) !== f.base?.sha256) throw new Error("damaged");
        originals.set(pathKey(f.path), bytes);
      } catch {
        return refuse(p, `The saved copy of ${basename(f.path)} is missing or damaged, so NONON did not change anything.${saved(f)}`);
      }
    }

    try {
      for (const { f, action } of plan.slice().reverse()) {
        if (action === "restore") {
          await atomicWrite(f.path, originals.get(pathKey(f.path))!, io);
          const back = await readSnapshot(f.path);
          if (!back || back.fp.sha256 !== f.base?.sha256) throw new EditError(`${basename(f.path)} did not come back exactly as it was.`);
        } else if (action === "delete") await fsp.unlink(f.path);
        else if (action === "move-back") {
          await moveNoOverwrite(f.movedTo!, f.path, io);
          await removeEmptyParents(f.movedTo!, ws);
        }
      }
    } catch (e) {
      p.status = "partial";
      p.error = `NONON could not undo everything: ${e instanceof EditError ? e.plain : plainFsError(e, basename(p.target))} Your earlier versions are saved in ${join(ctx.paths.dataDir, "recovery", p.id)}.`;
      return publish(p);
    }
    p.status = "recovered";
    delete p.error;
    return publish(p);
  }

  const saved = (f: ChangeFileRecord): string => (f.recoveryPath ? ` Your earlier version is saved at ${f.recoveryPath}.` : "");

  function refuse(p: ChangeProposal, error: string): ChangeProposal {
    p.error = error;
    return publish(p);
  }

  return {
    stage,
    list(filter) {
      return [...cache.values()]
        .filter((p) => (!filter.workspaceId || p.workspaceId === filter.workspaceId) && (!filter.taskId || p.taskId === filter.taskId))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .map(clone);
    },
    get(id) {
      const p = cache.get(id);
      return p ? clone(p) : undefined;
    },
    apply,
    reject,
    recover,
  };
}
