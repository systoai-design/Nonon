/**
 * Real end-to-end: real store, workspaces, procedures, changes and task service, plus the real local model
 * (llama-server, read from E:\nonon-dev\llm-url.txt). Only the clock is fake. Skipped when no model server answers.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Routine, RoutineRun } from "../../../shared/contracts";
import { createChangeService } from "../changes";
import { createProcedureRegistry } from "../procedures";
import { createOpenAiCompatClient } from "../runtime/llama-client";
import { createStore } from "../store";
import { createTaskService } from "../tasks";
import type { AppCtx, Services } from "../types";
import { createWorkspaceService } from "../workspaces";
import { createScheduler } from "./service";

const URL_FILE = process.env.NONON_LLM_URL_FILE ?? "E:\\nonon-dev\\llm-url.txt";

async function modelUrl(): Promise<string | null> {
  try {
    if (!existsSync(URL_FILE)) return null;
    const url = readFileSync(URL_FILE, "utf8").trim();
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

const url = await modelUrl();
const NOTES = [
  "Project kickoff meeting, 2026-10-05",
  "Attendees: Maria, Jon, Priya",
  "",
  "Decisions:",
  "- We will launch the new price list on 2026-11-01.",
  "",
  "Action items:",
  "- Maria will send the draft price list to Jon by 2026-10-12.",
  "- Jon will update the website banner by 2026-10-20.",
  "- Priya to book the launch venue (no date yet).",
  "",
  "Open question: do we offer the old prices to returning customers?",
].join("\n");

describe.skipIf(!url)("scheduler end to end with the real local model", () => {
  const root = mkdtempSync(join(tmpdir(), "nonon-sched-e2e-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("runs a routine on schedule through the real task service, then recognises unchanged input", async () => {
    const wsFolder = join(root, "Work");
    const notesDir = join(wsFolder, "Meetings");
    mkdirSync(notesDir, { recursive: true });
    const notes = join(notesDir, "kickoff.txt");
    writeFileSync(notes, NOTES);
    const t0 = Date.parse("2026-10-08T23:00:00.000Z");
    utimesSync(notes, t0 / 1000 - 3600, t0 / 1000 - 3600);

    const events: { name: string; payload: unknown }[] = [];
    const store = createStore(join(root, "data"));
    const client = createOpenAiCompatClient(url!);
    const ctx = {
      paths: { dataDir: join(root, "data"), modelDir: root, resourcesDir: root, logFile: join(root, "log.txt") },
      store,
      emit: (name: string, payload: unknown) => events.push({ name, payload }),
      log: () => undefined,
      recentLog: () => [],
      getSettings: () => ({ activeWorkspaceId: null }) as never,
      updateSettings: () => ({}) as never,
      svc: {} as Services,
    } as unknown as AppCtx;
    ctx.svc.runtime = { status: () => ({ phase: "running" }), isReady: () => true, client: () => client } as never;
    ctx.svc.providers = { list: () => [], clientFor: () => client } as never;
    ctx.svc.workspaces = createWorkspaceService(ctx);
    ctx.svc.procedures = createProcedureRegistry(ctx);
    ctx.svc.changes = createChangeService(ctx);
    ctx.svc.tasks = createTaskService(ctx);

    const ws = ctx.svc.workspaces.create({ name: "Work", folder: wsFolder, pack: "business" });
    const clock = { ms: t0 };
    const scheduler = createScheduler(ctx, { now: () => clock.ms, setInterval: () => 0, clearInterval: () => undefined, timeZone: "Asia/Manila" });
    ctx.svc.scheduler = scheduler;

    const card = await scheduler.propose(ws.id, "Every weekday at 8 a.m., turn my newest meeting notes into a follow-up in my Meetings folder");
    expect(card.procedureId).toBe("meeting-followup");
    expect(card.schedule.cron).toBe("0 8 * * 1-5");
    expect(card.inputScope.folder).toBe(notesDir);
    const routine: Routine = scheduler.save(card);
    expect(routine.nextDueAt).toBe("2026-10-09T00:00:00.000Z");

    scheduler.start();
    for (const ms of [Date.parse("2026-10-08T23:59:30.000Z"), Date.parse("2026-10-09T00:00:00.000Z")]) {
      clock.ms = ms;
      await scheduler.checkNow();
    }
    await scheduler.whenIdle();

    const first = scheduler.runs(routine.id)[0] as RoutineRun;
    expect(first.trigger).toBe("due");
    expect(first.status, first.detail).toBe("succeeded");
    expect(first.taskId).toBeDefined();
    const task = ctx.svc.tasks.get(first.taskId!)!;
    expect(task.routineRunId).toBe(first.id);
    expect(task.state).toBe("complete");
    expect(task.outputs.length).toBeGreaterThan(0);
    for (const out of task.outputs) expect(existsSync(out.path)).toBe(true);
    const outputDir = ctx.svc.workspaces.outputDir(ws.id);
    expect(readdirSync(outputDir).length).toBeGreaterThan(0);
    expect(task.locations.ai).toBe("local");
    console.log("E2E summary:", task.summary, "| outputs:", task.outputs.map((o) => o.path).join(", "), "| card:", card.description);

    // Next weekday with the same notes: recorded, nothing re-run.
    const tasksBefore = ctx.svc.tasks.list(ws.id).length;
    for (const ms of [Date.parse("2026-10-11T23:59:30.000Z"), Date.parse("2026-10-12T00:00:00.000Z")]) {
      clock.ms = ms;
      await scheduler.checkNow();
    }
    await scheduler.whenIdle();
    const second = scheduler.runs(routine.id)[0] as RoutineRun;
    expect(second.id).not.toBe(first.id);
    expect(second.detail).toBe("No new files since last run.");
    expect(ctx.svc.tasks.list(ws.id)).toHaveLength(tasksBefore);

    expect(scheduler.list()[0]!.lastRunStatus).toBe("succeeded");
    expect(JSON.parse(readFileSync(store.path("routine-runs.json"), "utf8"))).toHaveLength(2);
  }, 600_000);

  it("runs the real spreadsheet-compare procedure on the two newest statements (File A older, File B newer)", async () => {
    const wsFolder = join(root, "Books");
    const dir = join(wsFolder, "Statements");
    mkdirSync(dir, { recursive: true });
    const ledger = join(dir, "ledger-sept.csv");
    const bank = join(dir, "bank-sept.csv");
    const csv = (rows: string[]) => ["Date,Description,Amount", ...rows, ""].join(String.fromCharCode(10));
    writeFileSync(ledger, csv(["2026-09-01,Office rent,-1200.00", "2026-09-03,Client payment Acme,2500.00", "2026-09-05,Coffee beans,-45.50", "2026-09-09,Software subscription,-29.99"]));
    writeFileSync(bank, csv(["2026-09-01,Office rent,-1200.00", "2026-09-03,Client payment Acme,2500.00", "2026-09-05,Coffee beans,-54.50", "2026-09-12,Bank fee,-10.00"]));
    const t0 = Date.parse("2026-10-08T23:00:00.000Z");
    utimesSync(ledger, t0 / 1000 - 7200, t0 / 1000 - 7200);
    utimesSync(bank, t0 / 1000 - 3600, t0 / 1000 - 3600);

    const store = createStore(join(root, "data2"));
    const client = createOpenAiCompatClient(url!);
    const ctx = {
      paths: { dataDir: join(root, "data2"), modelDir: root, resourcesDir: root, logFile: join(root, "log2.txt") },
      store,
      emit: () => undefined,
      log: () => undefined,
      recentLog: () => [],
      getSettings: () => ({ activeWorkspaceId: null }) as never,
      updateSettings: () => ({}) as never,
      svc: {} as Services,
    } as unknown as AppCtx;
    ctx.svc.runtime = { status: () => ({ phase: "running" }), isReady: () => true, client: () => client } as never;
    ctx.svc.providers = { list: () => [], clientFor: () => client } as never;
    ctx.svc.workspaces = createWorkspaceService(ctx);
    ctx.svc.procedures = createProcedureRegistry(ctx);
    ctx.svc.changes = createChangeService(ctx);
    ctx.svc.tasks = createTaskService(ctx);
    const ws = ctx.svc.workspaces.create({ name: "Books", folder: wsFolder, pack: "bookkeeping" });
    const clock = { ms: t0 };
    const scheduler = createScheduler(ctx, { now: () => clock.ms, setInterval: () => 0, clearInterval: () => undefined, timeZone: "Asia/Manila" });
    ctx.svc.scheduler = scheduler;

    const card = await scheduler.propose(ws.id, "Every weekday at 8 a.m., compare the newest two spreadsheets in my Statements folder");
    expect(card.procedureId).toBe("spreadsheet-compare");
    expect(card.inputScope.folder).toBe(dir);
    const routine = scheduler.save(card);
    const run = await scheduler.runNow(routine.id);
    expect(run.status).toBe("running");
    await scheduler.whenIdle();

    const done = scheduler.runs(routine.id)[0] as RoutineRun;
    console.log("E2E spreadsheet run:", done.status, "|", done.detail);
    const task = ctx.svc.tasks.get(done.taskId!)!;
    expect(task.inputs.fileA![0]!.path).toBe(ledger);
    expect(task.inputs.fileB![0]!.path).toBe(bank);
    expect(["needs-review", "succeeded", "waiting-for-input"]).toContain(done.status);
    if (done.status === "needs-review") {
      expect(task.proposalIds.length).toBeGreaterThan(0);
      const staged = ctx.svc.changes.list({ taskId: task.id });
      expect(staged.every((c) => c.status === "staged")).toBe(true);
    }
    expect(readFileSync(ledger, "utf8")).toContain("-45.50");
  }, 600_000);
});
