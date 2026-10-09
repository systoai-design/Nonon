import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ChangeEdit, ChangeProposal, ChangeProposalDraft, Task, Workspace } from "../../shared/contracts";
import type { Events } from "../../shared/ipc";
import { createChangeService } from "./changes";
import { atomicWrite, defaultIo, type Io } from "./changes/fsio";
import { verifyWrittenXlsx } from "./changes/xlsx";
import { isInside } from "./fs-util";
import { createStore } from "./store";
import type { AppCtx, ChangeService } from "./types";

// Real temp files, real exceljs / papaparse / jszip. Only the workspace service is a stand-in
// (it belongs to another workstream); it enforces the same "inside the folder" rule with the shared isInside helper.

const root = mkdtempSync(join(tmpdir(), "nonon-changes-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const sha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

interface Rig {
  dir: string;
  folder: string;
  data: string;
  ws: Workspace;
  events: ChangeProposal[];
  ctx: AppCtx;
  svc: ChangeService;
  task: Task;
  remake(io?: Io): ChangeService;
}

let n = 0;
function rig(autoApply = false): Rig {
  const dir = join(root, `case${++n}`);
  const folder = join(dir, "ws");
  const data = join(dir, "data");
  mkdirSync(folder, { recursive: true });
  const ws: Workspace = { id: "w1", name: "Test", folder, pack: "bookkeeping", policy: "local-only", autoApply, createdAt: new Date().toISOString() };
  const events: ChangeProposal[] = [];
  const ctx = {
    paths: { dataDir: data, modelDir: join(dir, "models"), resourcesDir: join(dir, "res"), logFile: join(dir, "log.txt") },
    store: createStore(data),
    emit: <K extends keyof Events>(event: K, payload: Events[K]) => {
      if (event === "change:updated") events.push(payload as ChangeProposal);
    },
    log: () => undefined,
    recentLog: () => [],
    getSettings: () => ({}) as never,
    updateSettings: () => ({}) as never,
    svc: {
      workspaces: {
        get: (id: string) => (id === ws.id ? ws : undefined),
        assertInside: (_id: string, path: string) => {
          if (!isInside(folder, path)) throw new Error("That file is outside the workspace folder.");
        },
      },
    },
  } as unknown as AppCtx;
  const task = { id: "t1", workspaceId: "w1", procedureId: "p", procedureRevision: "rev-7" } as Task;
  const r: Rig = { dir, folder, data, ws, events, ctx, svc: createChangeService(ctx), task, remake: (io) => createChangeService(ctx, io ? { io } : {}) };
  return r;
}

const draft = (target: string, edits: ChangeEdit[], extra: Partial<ChangeProposalDraft> = {}): ChangeProposalDraft =>
  ({ target, edits, reason: "test", preview: undefined, checks: [], ...extra }) as unknown as ChangeProposalDraft;

async function stageOne(r: Rig, d: ChangeProposalDraft): Promise<ChangeProposal> {
  const [p] = await r.svc.stage(r.task, [d]);
  return p!;
}

// ---------------------------------------------------------------- fixtures

async function makeBudget(path: string, opts: { formulaCache?: boolean } = {}): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Budget", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [{ width: 30 }, { width: 12 }, { width: 40 }];
  ws.addRow(["Item", "Amount", "Note"]);
  ws.addRow(["Rent", 1200, "monthly"]);
  ws.addRow(["Food", 400, "weekly shop"]);
  ws.addRow(["Total", { formula: "B2+B3", ...(opts.formulaCache === false ? {} : { result: 1600 }) } as never, ""]);
  ws.addRow([]);
  ws.addRow(["Footer text spans three columns"]);
  ws.mergeCells("A6:C6");
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).height = 24;
  const other = wb.addWorksheet("Other");
  other.addRow(["keep", "me"]);
  other.addRow([1, 2]);
  await wb.xlsx.writeFile(path);
}

async function addZipEntry(path: string, entry: string, content = "x"): Promise<void> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  zip.file(entry, content);
  writeFileSync(path, await zip.generateAsync({ type: "nodebuffer" }));
}

const budgetEdit = (path: string, extra: Partial<Extract<ChangeEdit, { op: "xlsx-set-cells" }>> = {}): ChangeEdit => ({
  op: "xlsx-set-cells",
  path,
  sheet: "Budget",
  cells: [{ address: "B3", value: 450 }],
  ...extra,
});

const csvText = "id,name,amount\r\n1,Ana,10\r\n2,Ben,20\r\n3,Cy,30\r\n";

// ---------------------------------------------------------------- tests

describe("stage and reject never touch the original", () => {
  it("csv original is byte-identical after stage and after reject", async () => {
    const r = rig();
    const file = join(r.folder, "a.csv");
    writeFileSync(file, csvText);
    const before = sha(file);
    const p = await stageOne(r, draft(file, [{ op: "csv-set-cells", path: file, cells: [{ row: 2, col: 2, value: "99" }] }]));
    expect(p.status).toBe("staged");
    expect(p.base?.sha256).toBe(before);
    expect(p.procedureRevision).toBe("rev-7");
    expect(p.checks.every((c) => c.status === "pass")).toBe(true);
    expect(sha(file)).toBe(before);
    const rej = r.svc.reject(p.id);
    expect(rej.status).toBe("rejected");
    expect(sha(file)).toBe(before);
    expect(r.events.map((e) => e.status)).toEqual(["staged", "rejected"]);
  });

  it("xlsx original is byte-identical after stage and reject", async () => {
    const r = rig();
    const file = join(r.folder, "b.xlsx");
    await makeBudget(file);
    const before = sha(file);
    const p = await stageOne(r, draft(file, [budgetEdit(file)]));
    expect(p.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(sha(file)).toBe(before);
    r.svc.reject(p.id);
    expect(sha(file)).toBe(before);
  });

  it("refuses paths outside the workspace and stages nothing", async () => {
    const r = rig();
    const inside = join(r.folder, "ok.csv");
    writeFileSync(inside, csvText);
    const outside = join(r.dir, "elsewhere.csv");
    writeFileSync(outside, csvText);
    await expect(
      r.svc.stage(r.task, [
        draft(inside, [{ op: "csv-set-cells", path: inside, cells: [{ row: 1, col: 1, value: "x" }] }]),
        draft(outside, [{ op: "csv-set-cells", path: outside, cells: [{ row: 1, col: 1, value: "x" }] }]),
      ]),
    ).rejects.toThrow(/outside/);
    expect(r.svc.list({})).toEqual([]);
    expect(r.events).toEqual([]);
  });
});

describe("stale proposals", () => {
  it("detects an edit made between stage and apply and writes nothing", async () => {
    const r = rig();
    const file = join(r.folder, "a.csv");
    writeFileSync(file, csvText);
    const p = await stageOne(r, draft(file, [{ op: "csv-set-cells", path: file, cells: [{ row: 1, col: 2, value: "11" }] }]));
    writeFileSync(file, csvText.replace("Ana", "Anna"));
    const edited = sha(file);
    const res = await r.svc.apply(p.id);
    expect(res.status).toBe("stale");
    expect(res.error).toMatch(/changed after NONON prepared the change\. Nothing was changed/);
    expect(sha(file)).toBe(edited);
    expect(existsSync(join(r.data, "recovery", p.id))).toBe(false);
    await expect(r.svc.apply(p.id)).rejects.toThrow();
  });

  it("is stale when a create target appears after staging", async () => {
    const r = rig();
    const file = join(r.folder, "new.txt");
    const p = await stageOne(r, draft(file, [{ op: "create-file", path: file, text: "mine" }]));
    writeFileSync(file, "theirs");
    const res = await r.svc.apply(p.id);
    expect(res.status).toBe("stale");
    expect(readFileSync(file, "utf8")).toBe("theirs");
  });
});

describe("csv editing", () => {
  it("preserves BOM, CRLF, delimiter and trailing newline, and quotes correctly", async () => {
    const r = rig();
    const file = join(r.folder, "semi.csv");
    const original = "\uFEFFid;name;note\r\n1;Ana;plain\r\n2;Ben;\"has; semi\"\r\n";
    writeFileSync(file, original, "utf8");
    const p = await stageOne(
      r,
      draft(file, [
        {
          op: "csv-set-cells",
          path: file,
          cells: [
            { row: 1, col: 2, value: 'say "hi"; ok' },
            { row: 2, col: 1, value: "line1\nline2" },
          ],
          appendColumns: [{ header: "paid", values: ["yes", "no"] }],
        },
      ]),
    );
    expect(p.checks.filter((c) => c.status === "fail")).toEqual([]);
    const res = await r.svc.apply(p.id);
    expect(res.status).toBe("applied");
    const out = readFileSync(file);
    expect(out.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const text = out.toString("utf8").slice(1);
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.startsWith("id;name;note;paid\r\n")).toBe(true);
    expect(text).toContain('1;Ana;"say ""hi""; ok";yes\r\n');
    expect(text).toContain('2;"line1\nline2";"has; semi";no\r\n');
    expect(text.replace(/\r\n/g, "").includes("\r")).toBe(false);
    // The unedited cell "has; semi" kept its quoting.
    const Papa = (await import("papaparse")).default;
    const parsed = Papa.parse<string[]>(text.trimEnd(), { delimiter: ";" }).data;
    expect(parsed[1]).toEqual(["1", "Ana", 'say "hi"; ok', "yes"]);
    expect(parsed[2]).toEqual(["2", "line1\nline2", "has; semi", "no"]);
  });

  it("keeps LF files LF and files without a trailing newline without one", async () => {
    const r = rig();
    const file = join(r.folder, "lf.csv");
    writeFileSync(file, "a,b\n1,2\n3,4");
    const p = await stageOne(r, draft(file, [{ op: "csv-set-cells", path: file, cells: [{ row: 2, col: 0, value: "9" }] }]));
    await r.svc.apply(p.id);
    expect(readFileSync(file, "utf8")).toBe("a,b\n1,2\n9,4");
  });

  it("fails the stage check when a row or column is out of range, and apply refuses", async () => {
    const r = rig();
    const file = join(r.folder, "a.csv");
    writeFileSync(file, csvText);
    const before = sha(file);
    const p = await stageOne(r, draft(file, [{ op: "csv-set-cells", path: file, cells: [{ row: 40, col: 0, value: "x" }] }]));
    const bad = p.checks.find((c) => c.status === "fail");
    expect(bad?.detail).toMatch(/past the end/);
    const res = await r.svc.apply(p.id);
    expect(res.status).toBe("staged");
    expect(res.error).toMatch(/did not make this change/);
    expect(sha(file)).toBe(before);
  });

  it("refuses a file that is not UTF-8 instead of corrupting it", async () => {
    const r = rig();
    const file = join(r.folder, "latin.csv");
    writeFileSync(file, Buffer.from([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0xe9, 0x0a]));
    const p = await stageOne(r, draft(file, [{ op: "csv-set-cells", path: file, cells: [{ row: 1, col: 0, value: "x" }] }]));
    expect(p.checks.find((c) => c.status === "fail")?.detail).toMatch(/UTF-8/);
  });

  it("builds a preview with highlights when the draft has none, and replaces an invalid one", async () => {
    const r = rig();
    const file = join(r.folder, "a.csv");
    writeFileSync(file, csvText);
    const e: ChangeEdit = { op: "csv-set-cells", path: file, cells: [{ row: 2, col: 2, value: "99" }] };
    const p = await stageOne(r, draft(file, [e]));
    expect(Array.isArray(p.preview.after)).toBe(true);
    const after = p.preview.after as string[][];
    expect(after[0]).toEqual(["id", "amount"]);
    expect(after[1]).toEqual(["2", "99"]);
    expect(p.preview.highlights).toEqual([{ row: 1, col: 1 }]);
    expect((p.preview.before as string[][])[1]).toEqual(["2", "20"]);

    const bad = await stageOne(r, draft(file, [e], { preview: { title: "", after: 5 } as never }));
    expect(bad.checks.find((c) => c.id === "preview")?.status).toBe("warn");
    expect(Array.isArray(bad.preview.after)).toBe(true);

    const good = await stageOne(r, draft(file, [e], { preview: { title: "Mine", after: "text" } }));
    expect(good.preview.title).toBe("Mine");
    expect(good.checks.some((c) => c.id === "preview")).toBe(false);
  });
});

describe("apply, recovery and partial failure", () => {
  it("applies, stores a verified recovery copy, and recovery is byte-identical", async () => {
    const r = rig();
    const file = join(r.folder, "a.csv");
    writeFileSync(file, csvText);
    const before = sha(file);
    const p = await stageOne(r, draft(file, [{ op: "csv-set-cells", path: file, cells: [{ row: 1, col: 1, value: "Anne" }] }]));
    const res = await r.svc.apply(p.id);
    expect(res.status).toBe("applied");
    expect(res.editResults).toEqual([{ index: 0, ok: true }]);
    expect(res.appliedFingerprint?.sha256).toBe(sha(file));
    expect(sha(file)).not.toBe(before);
    expect(res.recoveryPath?.startsWith(join(r.data, "recovery", p.id))).toBe(true);
    expect(sha(res.recoveryPath!)).toBe(before);
    expect(readdirSync(r.folder).filter((f) => f.endsWith(".tmp"))).toEqual([]);

    await expect(r.svc.apply(p.id)).rejects.toThrow(/already made/);

    const back = await r.svc.recover(p.id);
    expect(back.status).toBe("recovered");
    expect(sha(file)).toBe(before);
    expect(r.events.map((e) => e.status)).toEqual(["staged", "applying", "applied", "recovered"]);
  });

  it("recovery refuses when the user edited the file after apply", async () => {
    const r = rig();
    const file = join(r.folder, "a.csv");
    writeFileSync(file, csvText);
    const p = await stageOne(r, draft(file, [{ op: "csv-set-cells", path: file, cells: [{ row: 1, col: 1, value: "Anne" }] }]));
    const applied = await r.svc.apply(p.id);
    writeFileSync(file, `${readFileSync(file, "utf8")}4,Dee,40\r\n`);
    const mine = sha(file);
    const res = await r.svc.recover(p.id);
    expect(res.status).toBe("applied");
    expect(res.error).toBe(`You changed this file after NONON made the change, so NONON will not overwrite it. Your earlier version is saved at ${applied.recoveryPath}.`);
    expect(sha(file)).toBe(mine);
  });

  it("reports a partial application exactly and can still recover what was applied", async () => {
    const r = rig();
    const file = join(r.folder, "a.csv");
    writeFileSync(file, csvText);
    const before = sha(file);
    const blocker = join(r.folder, "blocker");
    const doomed = join(blocker, "notes.txt");
    const p = await stageOne(
      r,
      draft(file, [
        { op: "csv-set-cells", path: file, cells: [{ row: 1, col: 1, value: "Anne" }] },
        { op: "create-file", path: doomed, text: "hello" },
        { op: "create-file", path: join(r.folder, "after.txt"), text: "never" },
      ]),
    );
    expect(p.checks.filter((c) => c.status === "fail")).toEqual([]);
    // After staging, a FILE appears where the second edit needs a folder.
    writeFileSync(blocker, "i am a file");
    const res = await r.svc.apply(p.id);
    expect(res.status).toBe("partial");
    expect(res.editResults?.map((e) => e.ok)).toEqual([true, false, false]);
    expect(res.editResults?.[1]?.error).toBeTruthy();
    expect(res.editResults?.[2]?.error).toMatch(/Not tried/);
    expect(res.error).toMatch(/Only 1 of 3 steps were done\. Step 2 failed/);
    expect(res.error).toMatch(/Not done: steps 2, 3/);
    expect(res.error).toContain(res.recoveryPath!);
    expect(existsSync(join(r.folder, "after.txt"))).toBe(false);
    expect(readFileSync(file, "utf8")).toContain("Anne");
    expect(sha(res.recoveryPath!)).toBe(before);

    const back = await r.svc.recover(p.id);
    expect(back.status).toBe("recovered");
    expect(sha(file)).toBe(before);
  });

  it("a first-step failure is `failed` and nothing was changed", async () => {
    const r = rig();
    const blocker = join(r.folder, "blocker");
    const doomed = join(blocker, "notes.txt");
    const p = await stageOne(r, draft(doomed, [{ op: "create-file", path: doomed, text: "hello" }]));
    writeFileSync(blocker, "file in the way");
    const res = await r.svc.apply(p.id);
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/Nothing was changed/);
    expect(readFileSync(blocker, "utf8")).toBe("file in the way");
  });

  it("serialises applies on one file: the second proposal is stale, not interleaved", async () => {
    const r = rig();
    const file = join(r.folder, "a.csv");
    writeFileSync(file, csvText);
    const e = (v: string): ChangeEdit => ({ op: "csv-set-cells", path: file, cells: [{ row: 1, col: 1, value: v }] });
    const a = await stageOne(r, draft(file, [e("A")]));
    const b = await stageOne(r, draft(file, [e("B")]));
    const [ra, rb] = await Promise.all([r.svc.apply(a.id), r.svc.apply(b.id)]);
    expect(ra.status).toBe("applied");
    expect(rb.status).toBe("stale");
    expect(readFileSync(file, "utf8")).toContain("1,A,10");
  });

  it("retries a rename that Windows refuses while the file is held open (injected fault, not a real lock)", async () => {
    const r = rig();
    const file = join(r.folder, "a.csv");
    writeFileSync(file, csvText);
    let fails = 2;
    const io: Io = {
      ...defaultIo,
      sleep: async () => undefined,
      rename: async (a, b) => {
        if (fails-- > 0) throw Object.assign(new Error("busy"), { code: "EBUSY" });
        return defaultIo.rename(a, b);
      },
    };
    await atomicWrite(file, Buffer.from("new"), io);
    expect(readFileSync(file, "utf8")).toBe("new");
    expect(readdirSync(r.folder).filter((f) => f.endsWith(".tmp"))).toEqual([]);

    const always: Io = { ...io, rename: async () => { throw Object.assign(new Error("busy"), { code: "EBUSY" }); } };
    await expect(atomicWrite(file, Buffer.from("other"), always)).rejects.toThrow(/open in another program/);
    expect(readFileSync(file, "utf8")).toBe("new");
    expect(readdirSync(r.folder).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("marks a change that was mid-apply when the app died as failed (uncertain), keeping the recovery path", async () => {
    const r = rig();
    const file = join(r.folder, "a.csv");
    writeFileSync(file, csvText);
    const p = await stageOne(r, draft(file, [{ op: "csv-set-cells", path: file, cells: [{ row: 1, col: 1, value: "Z" }] }]));
    const stored = r.ctx.store.read<ChangeProposal | null>(`changes/${p.id}.json`, null)!;
    stored.status = "applying";
    stored.recoveryPath = join(r.data, "recovery", p.id, "0-a.csv");
    r.ctx.store.write(`changes/${p.id}.json`, stored);
    const again = r.remake();
    const got = again.get(p.id)!;
    expect(got.status).toBe("failed");
    expect(got.error).toMatch(/not certain/);
    expect(got.error).toContain("0-a.csv");
    expect(again.list({ taskId: "t1" }).length).toBe(1);
    expect(again.list({ taskId: "other" }).length).toBe(0);
  });
});

describe("create-file and rename-move", () => {
  it("create-file refuses to overwrite and recovery deletes only an unchanged file", async () => {
    const r = rig();
    const file = join(r.folder, "new.txt");
    const p = await stageOne(r, draft(file, [{ op: "create-file", path: file, text: "hello" }]));
    expect(p.base).toBeNull();
    const res = await r.svc.apply(p.id);
    expect(res.status).toBe("applied");
    expect(readFileSync(file, "utf8")).toBe("hello");
    expect((await r.svc.recover(p.id)).status).toBe("recovered");
    expect(existsSync(file)).toBe(false);

    const existing = join(r.folder, "exists.txt");
    writeFileSync(existing, "mine");
    const q = await stageOne(r, draft(existing, [{ op: "create-file", path: existing, text: "x" }]));
    expect(q.checks.find((c) => c.status === "fail")?.detail).toMatch(/already exists/);
    expect((await r.svc.apply(q.id)).status).toBe("staged");
    expect(readFileSync(existing, "utf8")).toBe("mine");

    const f2 = join(r.folder, "n2.txt");
    const p2 = await stageOne(r, draft(f2, [{ op: "create-file", path: f2, text: "hello" }]));
    await r.svc.apply(p2.id);
    writeFileSync(f2, "hello and my notes");
    const refused = await r.svc.recover(p2.id);
    expect(refused.status).toBe("applied");
    expect(refused.error).toMatch(/will not delete it/);
    expect(readFileSync(f2, "utf8")).toBe("hello and my notes");
  });

  it("rename-move applies, recovers by moving back, and never moves back over something new", async () => {
    const r = rig();
    const from = join(r.folder, "old name.csv");
    const to = join(r.folder, "sub", "new name.csv");
    writeFileSync(from, csvText);
    const before = sha(from);
    const p = await stageOne(r, draft(from, [{ op: "rename-move", from, to }]));
    expect(p.checks.filter((c) => c.status === "fail")).toEqual([]);
    const res = await r.svc.apply(p.id);
    expect(res.status).toBe("applied");
    expect(existsSync(from)).toBe(false);
    expect(sha(to)).toBe(before);
    expect(res.appliedFingerprint?.path).toBe(resolve(to));
    expect((await r.svc.recover(p.id)).status).toBe("recovered");
    expect(sha(from)).toBe(before);
    expect(existsSync(to)).toBe(false);
    // The folder the move created is removed again once it is empty, so undo leaves the layout as it was.
    expect(existsSync(join(r.folder, "sub"))).toBe(false);

    const from2 = join(r.folder, "two.csv");
    const to2 = join(r.folder, "two-renamed.csv");
    writeFileSync(from2, csvText);
    const p2 = await stageOne(r, draft(from2, [{ op: "rename-move", from: from2, to: to2 }]));
    await r.svc.apply(p2.id);
    writeFileSync(from2, "someone made a new file here");
    const refused = await r.svc.recover(p2.id);
    expect(refused.status).toBe("applied");
    expect(refused.error).toMatch(/Something new is now at the original location/);
    expect(readFileSync(from2, "utf8")).toBe("someone made a new file here");
    expect(sha(to2)).toBe(before);
  });

  it("rename-move fails the stage check when the destination exists", async () => {
    const r = rig();
    const from = join(r.folder, "a.csv");
    const to = join(r.folder, "b.csv");
    writeFileSync(from, csvText);
    writeFileSync(to, "taken");
    const p = await stageOne(r, draft(from, [{ op: "rename-move", from, to }]));
    expect(p.checks.find((c) => c.status === "fail")?.detail).toMatch(/already exists/);
  });
});

describe("autoApply", () => {
  it("applies immediately when enabled and every check passes", async () => {
    const r = rig(true);
    const file = join(r.folder, "a.csv");
    writeFileSync(file, csvText);
    const p = await stageOne(r, draft(file, [{ op: "csv-set-cells", path: file, cells: [{ row: 1, col: 1, value: "Auto" }] }]));
    expect(p.status).toBe("applied");
    expect(readFileSync(file, "utf8")).toContain("1,Auto,10");
    expect(r.events.map((e) => e.status)).toEqual(["staged", "applying", "applied"]);
  });

  it("does not auto-apply when off, when a check warns, or for rename-move", async () => {
    const off = rig(false);
    const f1 = join(off.folder, "a.csv");
    writeFileSync(f1, csvText);
    expect((await stageOne(off, draft(f1, [{ op: "csv-set-cells", path: f1, cells: [{ row: 1, col: 1, value: "x" }] }]))).status).toBe("staged");

    const on = rig(true);
    const f2 = join(on.folder, "a.csv");
    writeFileSync(f2, csvText);
    const warned = await stageOne(on, draft(f2, [{ op: "csv-set-cells", path: f2, cells: [{ row: 1, col: 1, value: "=SUM(A1)" }] }]));
    expect(warned.checks.some((c) => c.status === "warn")).toBe(true);
    expect(warned.status).toBe("staged");

    const to = join(on.folder, "moved.csv");
    const moved = await stageOne(on, draft(f2, [{ op: "rename-move", from: f2, to }]));
    expect(moved.status).toBe("staged");
    expect(existsSync(f2)).toBe(true);
  });
});

describe("xlsx safety", () => {
  it("edits values and keeps merged cells, column widths, row height, freeze panes, formulas and other sheets", async () => {
    const r = rig();
    const file = join(r.folder, "budget.xlsx");
    await makeBudget(file);
    const p = await stageOne(r, draft(file, [budgetEdit(file, { appendColumns: [{ header: "Paid", values: ["yes", "no"] }] })]));
    expect(p.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(p.checks.some((c) => c.id === "edit-0-notes" && c.status === "warn")).toBe(true);
    const res = await r.svc.apply(p.id);
    expect(res.status).toBe("applied");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet("Budget")!;
    expect(ws.getCell("B3").value).toBe(450);
    expect(ws.getCell("B2").value).toBe(1200);
    expect(ws.getCell("D1").value).toBe("Paid");
    expect(ws.getCell("D2").value).toBe("yes");
    expect(ws.getCell("D3").value).toBe("no");
    expect((ws.model as { merges?: string[] }).merges).toEqual(["A6:C6"]);
    expect(ws.getColumn(1).width).toBe(30);
    expect(ws.getColumn(2).width).toBe(12);
    expect(ws.getColumn(3).width).toBe(40);
    expect(ws.getRow(1).height).toBe(24);
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.views[0]?.state).toBe("frozen");
    expect((ws.getCell("B4").value as { formula: string }).formula).toBe("B2+B3");
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Budget", "Other"]);
    expect(wb.getWorksheet("Other")!.getCell("A1").value).toBe("keep");
    const zip = await JSZip.loadAsync(readFileSync(file));
    expect(await zip.file("xl/workbook.xml")!.async("string")).toContain('fullCalcOnLoad="1"');

    const back = await r.svc.recover(p.id);
    expect(back.status).toBe("recovered");
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readFile(file);
    expect(wb2.getWorksheet("Budget")!.getCell("B3").value).toBe(400);
  });

  it("builds an xlsx preview with the edited cell highlighted", async () => {
    const r = rig();
    const file = join(r.folder, "budget.xlsx");
    await makeBudget(file);
    const p = await stageOne(r, draft(file, [budgetEdit(file)]));
    const after = p.preview.after as string[][];
    const before = p.preview.before as string[][];
    expect(after[0]).toEqual(["Item", "Amount"]);
    const row = after.findIndex((x) => x[0] === "Food");
    expect(after[row]).toEqual(["Food", "450"]);
    expect(before[row]).toEqual(["Food", "400"]);
    expect(p.preview.highlights).toContainEqual({ row, col: 1 });
  });

  it("refuses a workbook with a chart, with a plain reason and a way out; apply writes nothing", async () => {
    const r = rig();
    const file = join(r.folder, "chart.xlsx");
    await makeBudget(file);
    await addZipEntry(file, "xl/charts/chart1.xml", "<c:chartSpace/>");
    const before = sha(file);
    const p = await stageOne(r, draft(file, [budgetEdit(file)]));
    const bad = p.checks.find((c) => c.status === "fail");
    expect(bad?.detail).toContain("charts");
    expect(bad?.detail).toContain("Save a copy as a .csv file, or as an Excel file with only plain values, then try again.");
    const res = await r.svc.apply(p.id);
    expect(res.status).toBe("staged");
    expect(sha(file)).toBe(before);
    expect(existsSync(join(r.data, "recovery", p.id))).toBe(false);
  });

  it.each([
    ["xl/vbaProject.bin", "macros"],
    ["xl/pivotTables/pivotTable1.xml", "pivot tables"],
    ["xl/externalLinks/externalLink1.xml", "links to other workbooks"],
    ["xl/slicers/slicer1.xml", "slicers"],
    ["xl/media/image1.png", "images"],
    ["xl/drawings/drawing1.xml", "charts, shapes or images"],
  ])("refuses a workbook containing %s", async (entry, word) => {
    const r = rig();
    const file = join(r.folder, "feature.xlsx");
    await makeBudget(file);
    await addZipEntry(file, entry);
    const p = await stageOne(r, draft(file, [budgetEdit(file)]));
    expect(p.checks.find((c) => c.status === "fail")?.detail).toContain(word);
  });

  it("refuses a .xlsm by extension even before looking inside", async () => {
    const r = rig();
    const file = join(r.folder, "macro.xlsm");
    await makeBudget(file);
    const p = await stageOne(r, draft(file, [budgetEdit(file)]));
    expect(p.checks.find((c) => c.status === "fail")?.detail).toContain("macros");
  });

  it("refuses sheet protection, conditional formatting and non-list data validation", async () => {
    const r = rig();
    for (const [xml, word] of [
      ['<sheetProtection sheet="1"/>', "sheet protection"],
      ['<conditionalFormatting sqref="A1"><cfRule type="cellIs" priority="1"/></conditionalFormatting>', "conditional formatting"],
      ['<dataValidations count="1"><dataValidation type="whole" sqref="A1"/></dataValidations>', "data validation"],
    ] as const) {
      const file = join(r.folder, `f${word.length}.xlsx`);
      await makeBudget(file);
      const zip = await JSZip.loadAsync(readFileSync(file));
      const name = Object.keys(zip.files).find((f) => /^xl\/worksheets\/sheet1\.xml$/.test(f))!;
      const sheet = await zip.file(name)!.async("string");
      zip.file(name, sheet.replace("</sheetData>", `</sheetData>${xml}`));
      writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
      const p = await stageOne(r, draft(file, [budgetEdit(file)]));
      expect(p.checks.find((c) => c.status === "fail")?.detail, word).toContain(word);
    }
  });

  it("allows a simple drop-down list validation and keeps it", async () => {
    const r = rig();
    const file = join(r.folder, "list.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Budget");
    ws.addRow(["Item", "Status"]);
    ws.addRow(["Rent", "open"]);
    ws.getCell("B2").dataValidation = { type: "list", allowBlank: true, formulae: ['"open,paid"'] };
    await wb.xlsx.writeFile(file);
    const p = await stageOne(r, draft(file, [{ op: "xlsx-set-cells", path: file, sheet: "Budget", cells: [{ address: "B2", value: "paid" }] }]));
    expect(p.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect((await r.svc.apply(p.id)).status).toBe("applied");
    const out = new ExcelJS.Workbook();
    await out.xlsx.readFile(file);
    expect(out.getWorksheet("Budget")!.getCell("B2").value).toBe("paid");
    expect(out.getWorksheet("Budget")!.getCell("B2").dataValidation.type).toBe("list");
  });

  it("explains a missing sheet and bad addresses at stage time", async () => {
    const r = rig();
    const file = join(r.folder, "budget.xlsx");
    await makeBudget(file);
    const p1 = await stageOne(r, draft(file, [budgetEdit(file, { sheet: "Nope" })]));
    expect(p1.checks.find((c) => c.status === "fail")?.detail).toContain('The sheets in this file are: "Budget", "Other"');
    const p2 = await stageOne(r, draft(file, [budgetEdit(file, { cells: [{ address: "ZZZZ9", value: 1 }] })]));
    expect(p2.checks.find((c) => c.status === "fail")?.detail).toMatch(/not a valid cell address/);
    const p3 = await stageOne(r, draft(file, [budgetEdit(file, { cells: [{ address: "B5", value: 1 }, { address: "b5", value: 2 }] })]));
    expect(p3.checks.find((c) => c.status === "fail")?.detail).toMatch(/listed twice/);
    const p4 = await stageOne(r, draft(file, [budgetEdit(file, { cells: [{ address: "B6", value: 1 }] })]));
    expect(p4.checks.find((c) => c.status === "fail")?.detail).toMatch(/inside a merged block/);
  });

  it("warns when formulas have no saved result", async () => {
    const r = rig();
    const file = join(r.folder, "nocache.xlsx");
    await makeBudget(file, { formulaCache: false });
    const p = await stageOne(r, draft(file, [budgetEdit(file)]));
    expect(p.checks.find((c) => c.id === "edit-0-notes")?.detail).toMatch(/no saved result/);
    expect(p.checks.filter((c) => c.status === "fail")).toEqual([]);
  });

  it("writes a formula cell when asked, and the saved workbook holds it", async () => {
    const r = rig();
    const file = join(r.folder, "budget.xlsx");
    await makeBudget(file);
    const p = await stageOne(r, draft(file, [budgetEdit(file, { cells: [{ address: "B5", value: null, formula: "=SUM(B2:B3)" }] })]));
    expect(p.checks.filter((c) => c.status === "fail")).toEqual([]);
    await r.svc.apply(p.id);
    const out = new ExcelJS.Workbook();
    await out.xlsx.readFile(file);
    expect((out.getWorksheet("Budget")!.getCell("B5").value as { formula: string }).formula).toBe("SUM(B2:B3)");
  });

  it("the post-write verifier catches a saved file that lost merged cells or changed another cell", async () => {
    const r = rig();
    const file = join(r.folder, "budget.xlsx");
    await makeBudget(file);
    const original = readFileSync(file);
    const edit = budgetEdit(file) as Extract<ChangeEdit, { op: "xlsx-set-cells" }>;

    const goodWb = new ExcelJS.Workbook();
    await goodWb.xlsx.load(original as never);
    goodWb.getWorksheet("Budget")!.getCell("B3").value = 450;
    expect(await verifyWrittenXlsx(original, Buffer.from(await goodWb.xlsx.writeBuffer()), edit)).toBeNull();

    const unmerged = new ExcelJS.Workbook();
    await unmerged.xlsx.load(original as never);
    unmerged.getWorksheet("Budget")!.getCell("B3").value = 450;
    unmerged.getWorksheet("Budget")!.unMergeCells("A6:C6");
    expect(await verifyWrittenXlsx(original, Buffer.from(await unmerged.xlsx.writeBuffer()), edit)).toMatch(/merged cells changed/);

    const collateral = new ExcelJS.Workbook();
    await collateral.xlsx.load(original as never);
    collateral.getWorksheet("Budget")!.getCell("B3").value = 450;
    collateral.getWorksheet("Other")!.getCell("A1").value = "changed";
    expect(await verifyWrittenXlsx(original, Buffer.from(await collateral.xlsx.writeBuffer()), edit)).toMatch(/a cell changed/);

    const notSaved = new ExcelJS.Workbook();
    await notSaved.xlsx.load(original as never);
    expect(await verifyWrittenXlsx(original, Buffer.from(await notSaved.xlsx.writeBuffer()), edit)).toMatch(/did not save correctly/);

    const noWidth = new ExcelJS.Workbook();
    await noWidth.xlsx.load(original as never);
    noWidth.getWorksheet("Budget")!.getCell("B3").value = 450;
    noWidth.getWorksheet("Budget")!.getColumn(1).width = 10;
    expect(await verifyWrittenXlsx(original, Buffer.from(await noWidth.xlsx.writeBuffer()), edit)).toMatch(/column width changed/);
  });
});

describe("xlsx written by other tools (regressions found by scanning 55 real workbooks)", () => {
  it("edits a merged top-left cell, keeps a width-9 column, and accepts a number in a date-formatted cell", async () => {
    const r = rig();
    const file = join(r.folder, "other-tool.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.columns = [{ width: 9 }, { width: 14 }, { width: 20 }];
    ws.addRow(["Title across", null, null]);
    ws.mergeCells("A1:C1");
    ws.addRow(["when", new Date(Date.UTC(2026, 6, 17)), "note"]);
    ws.getCell("B2").numFmt = "yyyy-mm-dd";
    await wb.xlsx.writeFile(file);
    // exceljs itself never writes a width of exactly 9, but other tools do.
    const zip = await JSZip.loadAsync(readFileSync(file));
    const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    zip.file("xl/worksheets/sheet1.xml", xml.replace(/<cols>.*?<\/cols>/, '<cols><col min="1" max="1" width="9" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/><col min="3" max="3" width="20" customWidth="1"/></cols>'));
    writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));

    const p = await stageOne(r, draft(file, [{ op: "xlsx-set-cells", path: file, sheet: "Sheet1", cells: [{ address: "A1", value: "New title" }, { address: "B2", value: 5 }] }]));
    expect(p.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect((await r.svc.apply(p.id)).status).toBe("applied");
    const out = new ExcelJS.Workbook();
    await out.xlsx.readFile(file);
    const s = out.getWorksheet("Sheet1")!;
    expect(s.getCell("A1").value).toBe("New title");
    expect((s.model as { merges?: string[] }).merges).toEqual(["A1:C1"]);
    expect(Math.abs((s.getColumn(1).width ?? 0) - 9)).toBeLessThan(0.001);
    expect(s.getCell("B2").numFmt).toBe("yyyy-mm-dd");
  });

  it("reports a workbook exceljs cannot open as unsupported instead of throwing", async () => {
    const r = rig();
    const file = join(r.folder, "broken.xlsx");
    writeFileSync(file, "this is not a zip");
    const p = await stageOne(r, draft(file, [budgetEdit(file)]));
    expect(p.checks.find((c) => c.status === "fail")?.detail).toMatch(/not a valid .xlsx/);
  });
});
