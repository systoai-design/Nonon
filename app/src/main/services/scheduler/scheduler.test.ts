import { rmSync, writeFileSync } from "node:fs";
import { basename as base, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Routine, RoutineRun } from "../../../shared/contracts";
import { deferred, harness, routineFor, T0, type Harness } from "./test-kit";

const DUE_1 = Date.parse("2026-10-09T00:00:00.000Z"); // Friday 08:00 in Manila
const DUE_2 = Date.parse("2026-10-12T00:00:00.000Z"); // Monday 08:00 in Manila

let h: Harness;
afterEach(() => h?.cleanup());

function setup(options: Parameters<typeof harness>[0] = {}) {
  h = harness(options);
  h.file("jan.csv", "a,b\n1,2\n", T0 - 3 * 86_400_000);
  h.file("feb.csv", "a,b\n1,3\n", T0 - 2 * 86_400_000);
  return h;
}

function save(over: Partial<Routine> = {}): Routine {
  return h.svc.save(routineFor(h, over));
}

const lastRun = (): RoutineRun => h.svc.runs(undefined, 1)[0]!;

describe("due runs", () => {
  it("runs a task when the routine comes due and records the result", async () => {
    setup();
    const r = save();
    expect(r.nextDueAt).toBe(new Date(DUE_1).toISOString());
    h.svc.start();
    await h.runClock(DUE_1);

    expect(h.tasks.startCalls).toHaveLength(1);
    const call = h.tasks.startCalls[0]!;
    expect(call.procedureId).toBe("batch-summary");
    expect(call.files!.sheets!.map((p) => base(p))).toEqual(["jan.csv", "feb.csv"]);
    expect(call.ai!.location.ai).toBe("local");
    expect(call.routineRunId).toBe(lastRun().id);

    const run = lastRun();
    expect(run.trigger).toBe("due");
    expect(run.status).toBe("succeeded");
    expect(run.taskId).toBeDefined();
    expect(run.inputs).toHaveLength(2);
    const after = h.svc.list()[0]!;
    expect(after.lastRunStatus).toBe("succeeded");
    expect(after.lastRunAt).toBeDefined();
    expect(after.nextDueAt).toBe(new Date(DUE_2).toISOString());
    expect(h.events.some((e) => e.name === "routine:updated")).toBe(true);
    expect(h.events.filter((e) => e.name === "routine:run").length).toBeGreaterThanOrEqual(2);
  });

  it("uses one 30 second timer for all routines", () => {
    setup();
    save();
    save({ title: "Second" });
    h.svc.start();
    h.svc.start();
    expect(h.intervals).toHaveLength(1);
    expect(h.intervals[0]!.ms).toBe(30_000);
    h.svc.stop();
    expect(h.intervals[0]!.cleared).toBe(true);
  });
});

describe("run now", () => {
  it("returns a running run immediately and finishes later, emitting on every change", async () => {
    setup();
    const r = save();
    const gate = deferred();
    h.tasks.gate = gate.promise;
    h.tasks.next({ state: "review", proposalIds: ["c1", "c2"] });

    const run = await h.svc.runNow(r.id);
    expect(run.status).toBe("running");
    expect(run.trigger).toBe("manual");
    await Promise.resolve();
    expect(h.svc.runs(r.id)[0]!.status).toBe("running");

    gate.resolve();
    await h.svc.whenIdle();
    const done = h.svc.runs(r.id)[0]!;
    expect(done.status).toBe("needs-review");
    expect(done.detail).toMatch(/2 changes waiting for your OK/);
    const statuses = h.events.filter((e) => e.name === "routine:run").map((e) => (e.payload as RoutineRun).status);
    expect(statuses[0]).toBe("running");
    expect(statuses.at(-1)).toBe("needs-review");
  });

  it("runs even when the routine is paused", async () => {
    setup();
    const r = save();
    h.svc.setEnabled(r.id, false);
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    expect(h.tasks.startCalls).toHaveLength(1);
  });

  it("runs again on manual request even if the files have not changed", async () => {
    setup();
    const r = save();
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    expect(h.tasks.startCalls).toHaveLength(2);
  });
});

describe("pause and remove", () => {
  it("does not run while paused, and does not replay the paused period when resumed", async () => {
    setup();
    const r = save();
    h.svc.start();
    const paused = h.svc.setEnabled(r.id, false);
    expect(paused.nextDueAt).toBeUndefined();
    await h.runClock(DUE_2 + 60_000);
    expect(h.tasks.startCalls).toHaveLength(0);

    const resumed = h.svc.setEnabled(r.id, true);
    expect(Date.parse(resumed.nextDueAt!)).toBeGreaterThan(h.clock.ms);
    await h.svc.checkNow();
    await h.svc.whenIdle();
    expect(h.tasks.startCalls).toHaveLength(0);
  });

  it("removing a routine stops it from running and keeps its history", async () => {
    setup();
    const r = save();
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    h.svc.start();
    h.svc.remove(r.id);
    expect(h.svc.list()).toHaveLength(0);
    const before = h.tasks.startCalls.length;
    await h.runClock(DUE_1 + 60_000);
    expect(h.tasks.startCalls).toHaveLength(before);
    expect(h.svc.runs(r.id)).toHaveLength(1);
    await expect(h.svc.runNow(r.id)).rejects.toThrow(/no longer exists/);
  });

  it("removing cancels a run that is still waiting in the queue", async () => {
    setup();
    const a = save({ title: "A" });
    const b = save({ title: "B" });
    const gate = deferred();
    h.tasks.gate = gate.promise;
    await h.svc.runNow(a.id);
    await h.svc.runNow(b.id);
    h.svc.remove(b.id);
    gate.resolve();
    await h.svc.whenIdle();
    expect(h.tasks.startCalls).toHaveLength(1);
    expect(h.svc.runs(b.id)[0]!.status).toBe("interrupted");
  });
});

describe("restart persistence", () => {
  it("keeps routines, history, next due time and last status across a restart", async () => {
    setup();
    save();
    h.svc.start();
    await h.runClock(DUE_1);
    const before = h.svc.list()[0]!;
    h.svc.stop();

    const again = h.restart();
    again.start();
    const after = again.list()[0]!;
    expect(after.id).toBe(before.id);
    expect(after.nextDueAt).toBe(before.nextDueAt);
    expect(after.lastRunStatus).toBe("succeeded");
    expect(after.lastRunAt).toBe(before.lastRunAt);
    expect(again.runs(after.id)).toHaveLength(1);
    expect(h.store.files.has("routines.json")).toBe(true);
    expect(h.store.files.has("routine-runs.json")).toBe(true);
  });
});

describe("missed runs", () => {
  it("catches up exactly once after five missed daily runs", async () => {
    setup();
    save({ schedule: { cron: "0 8 * * *", timezone: "Asia/Manila", humanText: "Every day at 8:00 AM" } });
    h.svc.start();
    await h.runClock(T0 + 60_000);
    h.svc.stop();

    h.sleepUntil(DUE_1 + 4 * 86_400_000 + 3_600_000);
    const again = h.restart();
    again.start();
    await again.whenIdle();

    expect(h.tasks.startCalls).toHaveLength(1);
    const runs = again.runs();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.trigger).toBe("catch-up");
    expect(runs[0]!.detail).toMatch(/Caught up once after 5 missed runs/);
    expect(Date.parse(again.list()[0]!.nextDueAt!)).toBeGreaterThan(h.clock.ms);
  });

  it("with the skip policy records one skipped-missed run and runs nothing", async () => {
    setup();
    save({ missedRun: "skip", schedule: { cron: "0 8 * * *", timezone: "Asia/Manila", humanText: "Every day at 8:00 AM" } });
    h.svc.start();
    await h.runClock(T0 + 60_000);
    h.svc.stop();

    h.sleepUntil(DUE_1 + 4 * 86_400_000 + 3_600_000);
    const again = h.restart();
    again.start();
    await again.whenIdle();

    expect(h.tasks.startCalls).toHaveLength(0);
    const runs = again.runs();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("skipped-missed");
    expect(again.list()[0]!.lastRunStatus).toBe("skipped-missed");
  });

  it("treats a long gap between timer ticks (computer woke from sleep) as a missed run", async () => {
    setup();
    save();
    h.svc.start();
    await h.runClock(T0 + 60_000);
    h.sleepUntil(DUE_1 + 20 * 60_000);
    await h.svc.checkNow();
    await h.svc.whenIdle();
    expect(h.svc.runs()[0]!.trigger).toBe("catch-up");
    expect(h.tasks.startCalls).toHaveLength(1);
  });

  it("a normal on-time tick is a due run, not a catch-up", async () => {
    setup();
    save();
    h.svc.start();
    await h.runClock(DUE_1 + 10_000);
    expect(h.svc.runs()[0]!.trigger).toBe("due");
  });
});

describe("overlap and queueing", () => {
  it("does not start a routine again while its last run is still going", async () => {
    setup();
    const r = save({ schedule: { cron: "0 8 * * *", timezone: "Asia/Manila", humanText: "Every day at 8:00 AM" } });
    const gate = deferred();
    h.tasks.gate = gate.promise;
    h.svc.start();
    await h.runClock(DUE_1);
    await vi.waitFor(() => expect(h.tasks.startCalls).toHaveLength(1));
    expect(h.svc.runs(r.id)[0]!.status).toBe("running");

    h.clock.ms = DUE_1 + 86_400_000 - 30_000;
    await h.svc.checkNow();
    h.clock.ms = DUE_1 + 86_400_000;
    await h.svc.checkNow();
    const runs = h.svc.runs(r.id);
    expect(runs.map((x) => x.status)).toEqual(["skipped-overlap", "running"]);
    expect(h.tasks.startCalls).toHaveLength(1);

    const manual = await h.svc.runNow(r.id);
    expect(manual.status).toBe("skipped-overlap");
    gate.resolve();
    await h.svc.whenIdle();
    expect(h.tasks.startCalls).toHaveLength(1);
  });

  it("runs one routine task at a time, first come first served", async () => {
    setup();
    const a = save({ title: "A" });
    const b = save({ title: "B" });
    const c = save({ title: "C" });
    const gate = deferred();
    h.tasks.gate = gate.promise;
    await h.svc.runNow(a.id);
    await h.svc.runNow(b.id);
    await h.svc.runNow(c.id);
    await vi.waitFor(() => expect(h.tasks.startCalls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(h.tasks.startCalls).toHaveLength(1);
    gate.resolve();
    h.tasks.gate = null;
    await h.svc.whenIdle();
    expect(h.tasks.startCalls).toHaveLength(3);
    const order = h.tasks.startCalls.map((s) => h.svc.runs().find((r) => r.id === s.routineRunId)!.routineId);
    expect(order).toEqual([a.id, b.id, c.id]);
  });

  it("lets a task the user started by hand go first, but only for a bounded time", async () => {
    setup();
    save();
    h.svc.start();
    h.tasks.foreground(h.ws.id, "running");
    await h.runClock(DUE_1);
    expect(h.tasks.startCalls).toHaveLength(0);
    expect(h.svc.runs()[0]!.status).toBe("running");

    await h.runClock(DUE_1 + 60_000);
    expect(h.tasks.startCalls).toHaveLength(0);
    await h.runClock(DUE_1 + 125_000);
    expect(h.tasks.startCalls).toHaveLength(1);
    expect(h.svc.runs()[0]!.status).toBe("succeeded");
  });

  it("runs straight away once the foreground task is finished", async () => {
    setup();
    save();
    h.svc.start();
    const fg = h.tasks.foreground(h.ws.id, "running");
    await h.runClock(DUE_1);
    expect(h.tasks.startCalls).toHaveLength(0);
    fg.state = "complete";
    await h.runClock(DUE_1 + 30_000);
    expect(h.tasks.startCalls).toHaveLength(1);
  });
});

describe("crash and restart recovery", () => {
  it("marks a run that was running when the app died as interrupted and does not repeat it", async () => {
    setup();
    const r = save();
    const gate = deferred();
    h.tasks.gate = gate.promise;
    await h.svc.runNow(r.id);
    await vi.waitFor(() => expect(h.tasks.tasks.has("task_1")).toBe(true));
    expect(h.svc.runs(r.id)[0]!.status).toBe("running");
    h.tasks.tasks.get("task_1")!.state = "interrupted";

    const again = h.restart();
    h.tasks.gate = null;
    const startsBefore = h.tasks.startCalls.length;
    again.start();
    await again.whenIdle();
    const run = again.runs(r.id)[0]!;
    expect(run.status).toBe("interrupted");
    expect(run.detail).toMatch(/Nothing was repeated/);
    expect(h.tasks.startCalls).toHaveLength(startsBefore);
    expect(h.tasks.resumeCalls).toHaveLength(0);
    expect(again.list()[0]!.lastRunStatus).toBe("interrupted");
    gate.resolve();
  });

  it("checks the task before deciding: a task that reached review is reported as needs-review", async () => {
    setup();
    const r = save();
    const gate = deferred();
    h.tasks.gate = gate.promise;
    await h.svc.runNow(r.id);
    await vi.waitFor(() => expect(h.tasks.tasks.has("task_1")).toBe(true));
    h.tasks.tasks.get("task_1")!.state = "review";
    h.tasks.tasks.get("task_1")!.proposalIds = ["c1"];

    const again = h.restart();
    again.start();
    expect(again.runs(r.id)[0]!.status).toBe("needs-review");
    expect(h.tasks.startCalls).toHaveLength(1);
    gate.resolve();
  });

  it("a run with no task at all is interrupted, never replayed", () => {
    setup();
    const r = save();
    h.store.write("routine-runs.json", [
      { id: "run_old", routineId: r.id, trigger: "due", scheduledFor: "2026-10-01T00:00:00.000Z", startedAt: "2026-10-01T00:00:00.000Z", status: "running" },
    ]);
    const again = h.restart();
    again.start();
    expect(again.runs(r.id)[0]!.status).toBe("interrupted");
    expect(h.tasks.startCalls).toHaveLength(0);
  });
});

describe("input changes", () => {
  const daily = { schedule: { cron: "0 8 * * *", timezone: "Asia/Manila", humanText: "Every day at 8:00 AM" } };

  it("an unchanged input is recorded as done without running again; a changed input is a new run", async () => {
    setup();
    const r = save(daily);
    h.svc.start();
    await h.runClock(DUE_1);
    expect(h.tasks.startCalls).toHaveLength(1);

    await h.runClock(DUE_1 + 86_400_000);
    expect(h.tasks.startCalls).toHaveLength(1);
    const same = h.svc.runs(r.id)[0]!;
    expect(same.status).toBe("succeeded");
    expect(same.detail).toBe("No new files since last run.");
    expect(same.taskId).toBeUndefined();

    h.file("mar.csv", "a,b\n9,9\n", DUE_1 + 86_400_000 + 5_000);
    await h.runClock(DUE_1 + 2 * 86_400_000);
    expect(h.tasks.startCalls).toHaveLength(2);
    expect(h.tasks.startCalls[1]!.files!.sheets!.map((p) => base(p))).toEqual(["feb.csv", "mar.csv"]);
  });

  it("the same file name with different contents counts as changed", async () => {
    setup();
    save(daily);
    h.svc.start();
    await h.runClock(DUE_1);
    writeFileSync(join(h.statements, "feb.csv"), "a,b\n1,999\n");
    await h.runClock(DUE_1 + 86_400_000);
    expect(h.tasks.startCalls).toHaveLength(2);
  });

  it("a run whose task needs review still counts as the last good run for this comparison", async () => {
    setup();
    save(daily);
    h.tasks.next({ state: "review", proposalIds: ["c1"] });
    h.svc.start();
    await h.runClock(DUE_1);
    await h.runClock(DUE_1 + 86_400_000);
    expect(h.tasks.startCalls).toHaveLength(1);
  });

  it("fails clearly when no file matches instead of pretending to succeed", async () => {
    setup();
    const r = save({ inputScope: { folder: h.statements, pick: { sheets: { newest: 2, extensions: [".xlsx"] } } } });
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    const run = h.svc.runs(r.id)[0]!;
    expect(run.status).toBe("failed");
    expect(run.detail).toMatch(/^No new file matched/);
    expect(h.tasks.startCalls).toHaveLength(0);
    expect(h.svc.list()[0]!.lastRunStatus).toBe("failed");
  });

  it("filters by name and takes only the newest N", async () => {
    setup();
    h.file("bank-march.csv", "x", T0 - 1000);
    h.file("bank-april.csv", "y", T0 - 500);
    const r = save({ inputScope: { folder: h.statements, pick: { sheets: { newest: 1, extensions: ["csv"], nameContains: "BANK" } } } });
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    expect(h.tasks.startCalls[0]!.files!.sheets!.map((p) => base(p))).toEqual(["bank-april.csv"]);
  });

  it("a routine with no file inputs (email brief) always runs", async () => {
    setup();
    const r = save({ procedureId: "gmail-brief", inputScope: { folder: h.statements, pick: {} }, allowedActions: ["read-files", "write-outputs", "read-mail"] });
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    expect(h.tasks.startCalls).toHaveLength(2);
    expect(h.tasks.startCalls[0]!.files).toEqual({});
  });
});

describe("mapping task results to run status", () => {
  it("clarifying becomes waiting-for-input and frees the routine", async () => {
    setup();
    const r = save();
    h.tasks.next({ state: "clarifying", questions: [{ id: "q", prompt: "Which column holds the amount?", kind: "text" }] });
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    const run = h.svc.runs(r.id)[0]!;
    expect(run.status).toBe("waiting-for-input");
    expect(run.detail).toMatch(/Which column/);
    const next = await h.svc.runNow(r.id);
    expect(next.status).toBe("running");
    await h.svc.whenIdle();
  });

  it("review keeps pending approvals: the scheduler never applies or rejects changes", async () => {
    setup();
    const r = save();
    h.tasks.next({ state: "review", proposalIds: ["c1"] });
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    expect(h.svc.runs(r.id)[0]!.status).toBe("needs-review");
    expect(h.changesCalls).toEqual([]);
    expect(h.svc.list()[0]!.lastRunStatus).toBe("needs-review");
  });

  it("complete is succeeded; failed and needs-attention are failed with a reason", async () => {
    setup();
    const r = save();
    h.tasks.next({ state: "complete", summary: "Found 3 differences." }, { state: "failed", error: "Could not read feb.csv" }, { state: "needs-attention", checks: [{ id: "c", label: "Totals do not add up", status: "fail" }] });
    for (let i = 0; i < 3; i++) {
      await h.svc.runNow(r.id);
      await h.svc.whenIdle();
    }
    const [c, b, a] = h.svc.runs(r.id);
    expect(a!.status).toBe("succeeded");
    expect(a!.detail).toBe("Found 3 differences.");
    expect(b!.status).toBe("failed");
    expect(b!.detail).toBe("Could not read feb.csv");
    expect(c!.status).toBe("failed");
    expect(c!.detail).toMatch(/Totals do not add up/);
  });

  it("a task start that throws is a failed run, not a crash", async () => {
    setup();
    const r = save();
    h.tasks.start = async () => {
      throw new Error("tasks are not ready");
    };
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    expect(h.svc.runs(r.id)[0]).toMatchObject({ status: "failed", detail: "tasks are not ready" });
    const again = await h.svc.runNow(r.id);
    expect(again.status).toBe("running");
    await h.svc.whenIdle();
  });

  it("a waiting task is retried on later ticks, then finishes", async () => {
    setup();
    const r = save();
    h.svc.start();
    h.tasks.next({ state: "waiting", waitingOn: "an internet connection" }, { state: "complete", summary: "Done after retry." });
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    let run = h.svc.runs(r.id)[0]!;
    expect(run.status).toBe("running");
    expect(run.detail).toMatch(/Waiting for an internet connection/);

    h.clock.ms += 30_000;
    await h.svc.checkNow();
    await h.svc.whenIdle();
    expect(h.tasks.resumeCalls).toEqual(["task_1"]);
    run = h.svc.runs(r.id)[0]!;
    expect(run.status).toBe("succeeded");
    expect(h.tasks.startCalls).toHaveLength(1);
  });

  it("gives up on a task that keeps waiting and says what it was waiting for", async () => {
    setup({ schedulerOptions: { maxWaitRetries: 2 } });
    const r = save();
    h.svc.start();
    h.tasks.next(...Array.from({ length: 5 }, () => ({ state: "waiting" as const, waitingOn: "Gmail" })));
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    for (let i = 0; i < 4; i++) {
      h.clock.ms += 30_000;
      await h.svc.checkNow();
      await h.svc.whenIdle();
    }
    const run = h.svc.runs(r.id)[0]!;
    expect(run.status).toBe("failed");
    expect(run.detail).toMatch(/Still waiting for Gmail after 2 tries/);
    expect(h.tasks.resumeCalls).toHaveLength(2);
  });
});

describe("privacy and permissions", () => {
  it("rejects a cloud routine in a local-only workspace with a plain message", () => {
    setup({ policy: "local-only" });
    expect(() => save({ location: { ai: "claude", files: "this-computer" } })).toThrow(/keeps everything on this computer/);
    expect(h.svc.list()).toHaveLength(0);
  });

  it("accepts a cloud routine when the workspace allows it, and uses the provider only if it is ready", async () => {
    setup({ policy: "cloud-allowed" });
    const r = save({ location: { ai: "claude", files: "this-computer" } });
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    expect(h.tasks.startCalls[0]!.ai!.location.ai).toBe("claude");

    h.providerState.value = "needs-sign-in";
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    // A provider that is not ready stops the run: it never silently switches to another AI.
    expect(h.tasks.startCalls).toHaveLength(1);
    expect(h.svc.runs(r.id)[0]!.status).toBe("failed");
    expect(h.svc.runs(r.id)[0]!.detail).toMatch(/not ready.*did not switch to another AI/);
  });

  it("never routes to a provider if the workspace was switched to local-only after the routine was saved", async () => {
    setup({ policy: "cloud-allowed" });
    const r = save({ location: { ai: "claude", files: "this-computer" } });
    h.ws.policy = "local-only";
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    expect(h.tasks.startCalls).toHaveLength(0);
    expect(h.svc.runs(r.id)[0]!.status).toBe("failed");
    expect(h.svc.runs(r.id)[0]!.detail).toMatch(/cannot use online AI/);
  });

  it("refuses any action beyond read-files, write-outputs and read-mail", () => {
    setup();
    for (const bad of ["send-email", "delete-files", "run-commands"]) {
      expect(() => save({ allowedActions: ["read-files", bad as never] })).toThrow(/never allowed/);
    }
    expect(() => save({ allowedActions: "read-files" as never })).toThrow(/never allowed/);
  });

  it("a routine edited on disk to include a dangerous action does not run", async () => {
    setup();
    const r = save();
    const stored = h.store.read<Routine[]>("routines.json", []);
    stored[0]!.allowedActions = ["read-files", "send-email" as never];
    h.store.write("routines.json", stored);
    const again = h.restart();
    await again.runNow(r.id);
    await again.whenIdle();
    expect(again.runs(r.id)[0]!.status).toBe("failed");
    expect(h.tasks.startCalls).toHaveLength(0);
  });
});

describe("save validation", () => {
  it("checks the schedule, workspace folder, procedure and input folder", () => {
    setup();
    expect(() => save({ schedule: { cron: "every day", timezone: "Asia/Manila", humanText: "" } })).toThrow(/five parts/);
    expect(() => save({ schedule: { cron: "0 8 * * *", timezone: "Mars/Base", humanText: "" } })).toThrow(/time zone/);
    expect(() => save({ workspaceId: "nope" })).toThrow(/no longer exists/);
    expect(() => save({ procedureId: "make-coffee" })).toThrow(/does not have that kind of job/);
    expect(() => save({ inputScope: { folder: join(h.root, "elsewhere"), pick: { sheets: { newest: 1, extensions: [".csv"] } } } })).toThrow(/inside the project/);
    expect(() => save({ inputScope: { folder: h.statements, pick: {} } })).toThrow(/which files to use/);
    expect(() => save({ inputScope: { folder: h.statements, pick: { bogus: { newest: 1, extensions: [] } } } })).toThrow(/not a file this job reads/);
    expect(() => save({ title: "  " })).toThrow(/name/);
    h.ws.folder = null;
    expect(() => save()).toThrow(/Choose a folder/);
  });

  it("editing a routine keeps its history and recomputes the next due time", async () => {
    setup();
    const r = save();
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    const edited = h.svc.save({ ...r, schedule: { cron: "30 9 * * 1-5", timezone: "Asia/Manila", humanText: "" } });
    expect(edited.createdAt).toBe(r.createdAt);
    expect(edited.lastRunStatus).toBe("succeeded");
    expect(edited.schedule.humanText).toBe("Every weekday at 9:30 AM");
    expect(edited.nextDueAt).toBe(new Date(Date.parse("2026-10-09T01:30:00.000Z")).toISOString());
    expect(h.svc.list()).toHaveLength(1);
  });
});

describe("history and notifications", () => {
  it("keeps at most 200 runs per routine", async () => {
    setup();
    const r = save();
    for (let i = 0; i < 205; i++) {
      await h.svc.runNow(r.id);
      await h.svc.whenIdle();
    }
    expect(h.svc.runs(r.id, 1000)).toHaveLength(200);
    expect(h.store.read<RoutineRun[]>("routine-runs.json", [])).toHaveLength(200);
  });

  it("sends only a local notification callback for runs that finish", async () => {
    const notes: { title: string; status: string }[] = [];
    setup({ schedulerOptions: { notify: (n) => notes.push(n) } });
    const r = save();
    h.tasks.next({ state: "review", proposalIds: ["c1"] });
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    expect(notes).toEqual([{ routineId: r.id, runId: expect.any(String), title: "Compare statements is ready for your review", body: expect.any(String), status: "needs-review" }]);
  });

  it("a notification callback that throws does not break the run", async () => {
    setup({
      schedulerOptions: {
        notify: () => {
          throw new Error("no notifications here");
        },
      },
    });
    const r = save();
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    expect(h.svc.runs(r.id)[0]!.status).toBe("succeeded");
  });
});

describe("daylight saving through the scheduler", () => {
  it("keeps firing at 8:00 New York time over the spring-forward weekend", async () => {
    setup({ startMs: Date.parse("2026-03-06T12:00:00Z") });
    save({ schedule: { cron: "0 8 * * *", timezone: "America/New_York", humanText: "" } });
    h.svc.start();
    const fired: string[] = [];
    let n = 0;
    for (const day of ["2026-03-07T13:00:00Z", "2026-03-08T12:00:00Z", "2026-03-09T12:00:00Z"]) {
      const before = h.tasks.startCalls.length;
      await h.runClock(Date.parse(day));
      if (h.svc.runs().length > before) fired.push(h.svc.runs()[0]!.scheduledFor);
      h.file(`f-${++n}.csv`, day, Date.parse(day) + 1000);
    }
    expect(fired).toEqual(["2026-03-07T13:00:00.000Z", "2026-03-08T12:00:00.000Z", "2026-03-09T12:00:00.000Z"]);
  });
});

describe("procedures with separate file slots (File A / File B)", () => {
  const twoSlots = (): Partial<Routine> => ({
    procedureId: "spreadsheet-compare",
    inputScope: {
      folder: h.statements,
      pick: {
        fileA: { newest: 1, skip: 1, extensions: [".csv", ".xlsx"] },
        fileB: { newest: 1, skip: 0, extensions: [".csv", ".xlsx"] },
      },
    },
  });

  it("gives File A the second-newest file and File B the newest, never the same file twice", async () => {
    setup();
    const r = save(twoSlots());
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    const files = h.tasks.startCalls[0]!.files!;
    expect(files.fileA!.map((p) => base(p))).toEqual(["jan.csv"]);
    expect(files.fileB!.map((p) => base(p))).toEqual(["feb.csv"]);
    expect(h.svc.runs(r.id)[0]!.inputs).toHaveLength(2);
  });

  it("fails clearly when there is only one file to compare", async () => {
    setup();
    rmSync(join(h.statements, "jan.csv"));
    const r = save(twoSlots());
    await h.svc.runNow(r.id);
    await h.svc.whenIdle();
    expect(h.svc.runs(r.id)[0]).toMatchObject({ status: "failed" });
    expect(h.svc.runs(r.id)[0]!.detail).toMatch(/^No new file matched/);
    expect(h.tasks.startCalls).toHaveLength(0);
  });

  it("a newer file shifts the pair: the old newest becomes File A", async () => {
    setup();
    const r = save({ ...twoSlots(), schedule: { cron: "0 8 * * *", timezone: "Asia/Manila", humanText: "" } });
    h.svc.start();
    await h.runClock(DUE_1);
    h.file("mar.csv", "a,b\n7,7\n", DUE_1 + 1000);
    await h.runClock(DUE_1 + 86_400_000);
    expect(h.tasks.startCalls).toHaveLength(2);
    expect(h.tasks.startCalls[1]!.files!.fileA!.map((p) => base(p))).toEqual(["feb.csv"]);
    expect(h.tasks.startCalls[1]!.files!.fileB!.map((p) => base(p))).toEqual(["mar.csv"]);
    expect(r.id).toBeTruthy();
  });

  it("rejects a bad skip value", () => {
    setup();
    expect(() => save({ inputScope: { folder: h.statements, pick: { sheets: { newest: 1, skip: -1, extensions: [".csv"] } } } })).toThrow(/skip/);
  });
});
