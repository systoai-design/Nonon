import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type {
  FileFingerprint,
  InferenceClient,
  ProviderId,
  Routine,
  RoutineRun,
  RoutineRunStatus,
  Task,
  TaskState,
  Workspace,
} from "../../../shared/contracts";
import type { AppCtx, SchedulerService } from "../types";
import { humanizeCron, nextAfter, occurrencesBetween, systemTimeZone, validateCron } from "./cron";
import { fingerprint, pickFiles, sameInputs } from "./inputs";
import { proposeRoutine } from "./propose";

export interface RoutineNotification {
  routineId: string;
  runId: string;
  title: string;
  body: string;
  status: RoutineRunStatus;
}

export interface SchedulerOptions {
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** How often due routines are checked. Never one timer per routine. */
  tickMs?: number;
  /** Local notification hook. The lead wires Electron's Notification here; nothing external is ever sent. */
  notify?: (n: RoutineNotification) => void;
  /** How long a due routine yields to a foreground task before it runs anyway. */
  foregroundDelayMs?: number;
  /** How many ticks a task that is waiting on something (offline, busy) is retried before the run fails. */
  maxWaitRetries?: number;
  timeZone?: string;
}

export interface SchedulerHandle extends SchedulerService {
  setNotify(fn: ((n: RoutineNotification) => void) | undefined): void;
  /** Run the due-check now. Used after the computer wakes from sleep. */
  checkNow(): Promise<void>;
  /** Resolves when no routine run is executing or queued. */
  whenIdle(): Promise<void>;
}

const ROUTINES_FILE = "routines.json";
const RUNS_FILE = "routine-runs.json";
const STATE_FILE = "scheduler-state.json";
const RUN_HISTORY_CAP = 200;
const ALLOWED_ACTIONS = new Set(["read-files", "write-outputs", "read-mail"]);
const FOREGROUND_STATES = new Set<TaskState>(["inspecting", "running", "validating", "applying"]);
const COUNTS_AS_SUCCESS = new Set<RoutineRunStatus>(["succeeded", "needs-review"]);

interface QueueItem {
  runId: string;
  enqueuedAt: number;
  trigger: RoutineRun["trigger"];
  retry: boolean;
}

export function assertSafeActions(actions: unknown): void {
  if (!Array.isArray(actions) || !actions.every((a) => typeof a === "string" && ALLOWED_ACTIONS.has(a))) {
    throw new Error("A routine can only read files, write results and read mail. Sending or deleting is never allowed in a routine.");
  }
}

export function createScheduler(ctx: AppCtx, options: SchedulerOptions = {}): SchedulerHandle {
  const now = options.now ?? Date.now;
  const tickMs = options.tickMs ?? 30_000;
  const foregroundDelayMs = options.foregroundDelayMs ?? 120_000;
  const maxWaitRetries = options.maxWaitRetries ?? 10;
  const zoneNow = options.timeZone ?? systemTimeZone();
  const startInterval = options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const stopInterval = options.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  let notifyFn = options.notify;

  const routines = new Map<string, Routine>();
  let runs: RoutineRun[] = [];
  let lastTickAt: number | null = null;
  let loaded = false;
  let timer: unknown = null;
  let ticking = false;

  const queue: QueueItem[] = [];
  let activeRunId: string | null = null;
  const waitRetries = new Map<string, { attempts: number; taskId: string }>();
  /** Text kept in front of a run's final detail, e.g. "Caught up once after 5 missed runs." */
  const runNotes = new Map<string, string>();
  let idleWaiters: (() => void)[] = [];

  const iso = (ms: number) => new Date(ms).toISOString();

  // ---------------------------------------------------------------- persistence

  function load(): void {
    if (loaded) return;
    loaded = true;
    for (const r of ctx.store.read<Routine[]>(ROUTINES_FILE, [])) routines.set(r.id, r);
    runs = ctx.store.read<RoutineRun[]>(RUNS_FILE, []);
    lastTickAt = ctx.store.read<{ lastTickAt?: number }>(STATE_FILE, {}).lastTickAt ?? null;
  }

  function persistRoutines(): void {
    ctx.store.write(ROUTINES_FILE, [...routines.values()]);
  }

  function persistRuns(): void {
    const kept = new Map<string, number>();
    const trimmed: RoutineRun[] = [];
    // Newest first so the cap drops the oldest; a run that is still running is never dropped.
    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i]!;
      const count = (kept.get(run.routineId) ?? 0) + 1;
      kept.set(run.routineId, count);
      if (count <= RUN_HISTORY_CAP || run.status === "running") trimmed.push(run);
    }
    runs = trimmed.reverse();
    ctx.store.write(RUNS_FILE, runs);
  }

  function persistTick(): void {
    ctx.store.write(STATE_FILE, { lastTickAt });
  }

  function emitRoutine(r: Routine): void {
    ctx.emit("routine:updated", { ...r });
  }

  function patchRoutine(id: string, patch: Partial<Routine>): void {
    const r = routines.get(id);
    if (!r) return;
    Object.assign(r, patch);
    persistRoutines();
    emitRoutine(r);
  }

  function recordRun(run: RoutineRun): void {
    runs.push(run);
    persistRuns();
    ctx.emit("routine:run", { ...run });
  }

  function updateRun(run: RoutineRun, patch: Partial<RoutineRun>): void {
    Object.assign(run, patch);
    persistRuns();
    ctx.emit("routine:run", { ...run });
  }

  function findRun(id: string): RoutineRun | undefined {
    return runs.find((r) => r.id === id);
  }

  function finishRun(run: RoutineRun, status: RoutineRunStatus, detail: string): void {
    const finishedAt = iso(now());
    waitRetries.delete(run.id);
    const note = runNotes.get(run.id);
    runNotes.delete(run.id);
    updateRun(run, { status, detail: note ? `${note} ${detail}` : detail, finishedAt });
    const routine = routines.get(run.routineId);
    if (routine) {
      patchRoutine(routine.id, { lastRunAt: finishedAt, lastRunStatus: status });
      notifyRun(routine, run);
    }
  }

  function notifyRun(routine: Routine, run: RoutineRun): void {
    if (!notifyFn || run.status === "running" || run.status === "skipped-overlap") return;
    const lead: Partial<Record<RoutineRunStatus, string>> = {
      "needs-review": "is ready for your review",
      succeeded: "finished",
      failed: "could not finish",
      "waiting-for-input": "needs an answer from you",
      interrupted: "was stopped",
      "skipped-missed": "was skipped",
    };
    try {
      notifyFn({
        routineId: routine.id,
        runId: run.id,
        title: `${routine.title} ${lead[run.status] ?? "updated"}`,
        body: run.detail ?? "",
        status: run.status,
      });
    } catch (e) {
      ctx.log(`scheduler: notification failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---------------------------------------------------------------- validation

  function validate(input: Routine): Routine {
    const r = input;
    if (!r || typeof r !== "object") throw new Error("That routine could not be read.");
    if (typeof r.title !== "string" || r.title.trim() === "") throw new Error("Give the routine a name.");
    const ws = ctx.svc.workspaces.get(r.workspaceId);
    if (!ws) throw new Error("That project no longer exists.");
    if (!ws.folder) throw new Error("Choose a folder for this project before scheduling work on it.");

    const procedure = ctx.svc.procedures.get(r.procedureId);
    if (!procedure) throw new Error("NONON does not have that kind of job, so it cannot be repeated.");

    assertSafeActions(r.allowedActions);
    if (r.overlap !== "skip") throw new Error("A routine that is still running is skipped, never started twice.");
    if (r.missedRun !== "catch-up-once" && r.missedRun !== "skip") throw new Error("Choose what happens after a missed run: catch up once, or skip.");

    if (!r.schedule || typeof r.schedule.cron !== "string") throw new Error("Choose when this routine should run.");
    const cronProblem = validateCron(r.schedule.cron, r.schedule.timezone);
    if (cronProblem) throw new Error(cronProblem);

    if (!r.location || r.location.files !== "this-computer") throw new Error("Files always stay on this computer.");
    if (r.location.ai !== "local" && ws.policy === "local-only") {
      throw new Error("This project keeps everything on this computer, so its routines can only use the AI on this computer. Change the project setting first if you want to use online AI like Claude.");
    }

    const scope = r.inputScope;
    if (!scope || typeof scope.folder !== "string" || scope.folder.trim() === "") throw new Error("Choose the folder this routine should read from.");
    try {
      ctx.svc.workspaces.assertInside(ws.id, scope.folder);
    } catch {
      throw new Error("The folder this routine reads from has to be inside the project folder.");
    }

    const fileInputs = procedure.inputs.filter((i) => i.kind === "file" || i.kind === "files");
    const pick = scope.pick ?? {};
    for (const [key, rule] of Object.entries(pick)) {
      if (!fileInputs.some((i) => i.key === key)) throw new Error(`"${key}" is not a file this job reads.`);
      if (!rule || !Number.isInteger(rule.newest) || rule.newest < 1 || rule.newest > 50) {
        throw new Error("Choose how many of the newest files to use, from 1 to 50.");
      }
      if (rule.skip !== undefined && (!Number.isInteger(rule.skip) || rule.skip < 0 || rule.skip > 49)) {
        throw new Error("Choose how many of the newest files to skip, from 0 to 49.");
      }
      if (!Array.isArray(rule.extensions) || !rule.extensions.every((e) => typeof e === "string")) {
        throw new Error("The file types have to be a list such as .xlsx and .csv.");
      }
    }
    if (fileInputs.length > 0 && Object.keys(pick).length === 0) throw new Error("Tell the routine which files to use.");
    for (const input of fileInputs) {
      if (!input.optional && !pick[input.key]) throw new Error(`Tell the routine which files to use for "${input.label}".`);
    }
    if (r.params && Object.values(r.params).some((v) => typeof v !== "string")) throw new Error("Settings for a routine have to be plain text.");
    return r;
  }

  // ---------------------------------------------------------------- scheduling

  function computeNext(r: Routine, from: number): string | undefined {
    if (!r.enabled) return undefined;
    const next = nextAfter(r.schedule.cron, r.schedule.timezone, from);
    return next === null ? undefined : iso(next);
  }

  function isBusy(routineId: string): boolean {
    return runs.some((run) => run.routineId === routineId && run.status === "running");
  }

  function newRun(routine: Routine, trigger: RoutineRun["trigger"], scheduledFor: string, status: RoutineRunStatus, detail?: string): RoutineRun {
    const startedAt = iso(now());
    return {
      id: `run_${randomUUID()}`,
      routineId: routine.id,
      trigger,
      scheduledFor,
      startedAt,
      status,
      ...(detail ? { detail } : {}),
      ...(status === "running" ? {} : { finishedAt: startedAt }),
    };
  }

  /** Creates the persisted run (it is the lease) and queues it. Returns a snapshot. */
  function dispatch(routine: Routine, trigger: RoutineRun["trigger"], scheduledFor: string, detail?: string): RoutineRun {
    if (isBusy(routine.id)) {
      const skipped = newRun(routine, trigger, scheduledFor, "skipped-overlap", "The last run is still going, so this one was skipped.");
      recordRun(skipped);
      return { ...skipped };
    }
    const run = newRun(routine, trigger, scheduledFor, "running", detail ?? "Waiting for its turn");
    recordRun(run);
    patchRoutine(routine.id, { lastRunAt: run.startedAt, lastRunStatus: "running" });
    if (detail) runNotes.set(run.id, detail);
    queue.push({ runId: run.id, enqueuedAt: now(), trigger, retry: false });
    void pump();
    return { ...run };
  }

  function foregroundBusy(): boolean {
    try {
      for (const ws of ctx.svc.workspaces.list()) {
        for (const t of ctx.svc.tasks.list(ws.id)) {
          if (!t.routineRunId && FOREGROUND_STATES.has(t.state)) return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  /** Index of the next queue item allowed to start now, or -1. Manual runs never wait for foreground work. */
  function nextRunnable(): number {
    const blocked = foregroundBusy();
    return queue.findIndex((q) => q.trigger === "manual" || !blocked || now() - q.enqueuedAt >= foregroundDelayMs);
  }

  function signalIdle(): void {
    if (activeRunId !== null || (queue.length > 0 && nextRunnable() !== -1)) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const w of waiters) w();
  }

  async function pump(): Promise<void> {
    if (activeRunId !== null) return;
    const index = nextRunnable();
    if (index === -1) return;
    const item = queue.splice(index, 1)[0]!;
    activeRunId = item.runId;
    try {
      await execute(item);
    } catch (e) {
      const run = findRun(item.runId);
      if (run && run.status === "running") finishRun(run, "failed", e instanceof Error ? e.message : String(e));
    } finally {
      activeRunId = null;
      void pump();
      signalIdle();
    }
  }

  /** A routine never changes where its AI runs on its own: a connected provider that is not usable stops the run with a plain reason. */
  function chooseAi(routine: Routine, ws: Workspace): { client: InferenceClient; note?: string } {
    const wanted = routine.location.ai;
    if (wanted === "local") return { client: ctx.svc.runtime.client() };
    if (ws.policy !== "cloud-allowed") {
      throw new Error("This project keeps work on this computer, so this routine cannot use online AI like Claude. Nothing ran.");
    }
    if (wanted === "paired") throw new Error("Another computer is not available for routines yet. Nothing ran. Switch the routine to the AI on this computer to run it.");
    const status = ctx.svc.providers.list().find((p) => p.id === wanted);
    if (status?.state !== "ready") {
      throw new Error(`${status?.label ?? wanted} is not ready. Nothing ran, and NONON did not switch to another AI. Sign in again, or switch the routine to the AI on this computer.`);
    }
    return { client: ctx.svc.providers.clientFor(ws.id, wanted as ProviderId) };
  }

  async function collectInputs(routine: Routine) {
    const files: Record<string, string[]> = {};
    const prints: FileFingerprint[] = [];
    for (const [key, rule] of Object.entries(routine.inputScope.pick)) {
      let picked: { path: string }[];
      try {
        picked = await pickFiles(routine.inputScope.folder, rule);
      } catch {
        throw new Error(`The folder "${basename(routine.inputScope.folder)}" could not be read. Check that it still exists.`);
      }
      if (picked.length === 0) {
        const kinds = rule.extensions.length > 0 ? ` (${rule.extensions.join(", ")}${rule.nameContains ? `, name has "${rule.nameContains}"` : ""})` : "";
        throw new Error(`No new file matched in "${basename(routine.inputScope.folder)}"${kinds}. Nothing was changed. Add a new file there, or run it again later.`);
      }
      // Oldest first, so "compare" procedures see earlier then later.
      const ordered = [...picked].reverse().map((p) => p.path);
      files[key] = ordered;
      for (const p of ordered) prints.push(await fingerprint(p));
    }
    return { files, prints };
  }

  async function execute(item: QueueItem): Promise<void> {
    const run = findRun(item.runId);
    if (!run || run.status !== "running") return;
    const routine = routines.get(run.routineId);
    if (!routine) {
      finishRun(run, "interrupted", "The routine was removed before it ran.");
      return;
    }
    const ws = ctx.svc.workspaces.get(routine.workspaceId);
    if (!ws) {
      finishRun(run, "failed", "The project for this routine no longer exists.");
      return;
    }
    assertSafeActions(routine.allowedActions);

    if (item.retry) {
      await resumeWaiting(run);
      return;
    }

    const procedure = ctx.svc.procedures.get(routine.procedureId);
    if (!procedure) {
      finishRun(run, "failed", "That kind of job is no longer available.");
      return;
    }

    updateRun(run, { detail: "Looking at your files" });
    const { files, prints } = await collectInputs(routine);
    updateRun(run, { inputs: prints });

    if (run.trigger !== "manual" && prints.length > 0) {
      const previous = [...runs].reverse().find((r) => r.id !== run.id && r.routineId === routine.id && COUNTS_AS_SUCCESS.has(r.status) && (r.inputs?.length ?? 0) > 0);
      if (previous?.inputs && sameInputs(prints, previous.inputs)) {
        finishRun(run, "succeeded", "No new files since last run.");
        return;
      }
    }

    const { client, note } = chooseAi(routine, ws);
    updateRun(run, { detail: "Working on it" });
    const started = await ctx.svc.tasks.start({
      workspaceId: ws.id,
      procedureId: routine.procedureId,
      files,
      ...(Object.keys(routine.params ?? {}).length > 0 ? { text: routine.params } : {}),
      routineRunId: run.id,
      ai: client,
    });
    updateRun(run, { taskId: started.id });
    const settled = await ctx.svc.tasks.settled(started.id);
    mapOutcome(run, settled, note);
  }

  async function resumeWaiting(run: RoutineRun): Promise<void> {
    const entry = waitRetries.get(run.id);
    if (!entry) {
      finishRun(run, "failed", "NONON lost track of the job this run was waiting on. Run it again.");
      return;
    }
    entry.attempts += 1;
    updateRun(run, { detail: `Trying again (${entry.attempts} of ${maxWaitRetries})` });
    const resumed = await ctx.svc.tasks.resume(entry.taskId);
    const settled = await ctx.svc.tasks.settled(resumed.id);
    mapOutcome(run, settled);
  }

  function failureReason(task: Task): string {
    if (task.error) return task.error;
    const failed = task.checks.find((c) => c.status === "fail");
    if (failed) return failed.detail ? `${failed.label}: ${failed.detail}` : failed.label;
    return task.summary ?? "The job did not finish.";
  }

  function mapOutcome(run: RoutineRun, task: Task, note?: string): void {
    const suffix = note ? ` ${note}` : "";
    switch (task.state) {
      case "review": {
        const n = task.proposalIds.length;
        const what = n > 0 ? `${n} change${n === 1 ? "" : "s"} waiting for your OK` : "Results are waiting for your review";
        finishRun(run, "needs-review", `${what}.${suffix}`);
        return;
      }
      case "complete":
        finishRun(run, "succeeded", `${task.summary ?? "Finished."}${suffix}`);
        return;
      case "clarifying": {
        const q = task.questions[0]?.prompt;
        finishRun(run, "waiting-for-input", q ? `Needs an answer: ${q}` : "Needs an answer before it can continue.");
        return;
      }
      case "waiting": {
        const entry = waitRetries.get(run.id) ?? { attempts: 0, taskId: task.id };
        entry.taskId = task.id;
        const on = task.waitingOn ?? "something it needs";
        if (entry.attempts >= maxWaitRetries) {
          finishRun(run, "failed", `Still waiting for ${on} after ${maxWaitRetries} tries. It will run again at the next scheduled time.`);
          return;
        }
        waitRetries.set(run.id, entry);
        updateRun(run, { taskId: task.id, detail: `Waiting for ${on}. NONON will try again shortly.` });
        return;
      }
      case "interrupted":
        finishRun(run, "interrupted", "The job was stopped before it finished.");
        return;
      default:
        finishRun(run, "failed", failureReason(task));
    }
  }

  // ---------------------------------------------------------------- tick, missed runs

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const t = now();
      const gap = lastTickAt === null ? 0 : t - lastTickAt;
      const resumedFromSleep = gap > tickMs * 2;
      if (resumedFromSleep) ctx.log(`scheduler: ${Math.round(gap / 1000)}s since the last check; looking for missed runs`);
      lastTickAt = t;
      persistTick();

      for (const routine of [...routines.values()]) {
        if (!routine.enabled) continue;
        const dueMs = routine.nextDueAt ? Date.parse(routine.nextDueAt) : NaN;
        if (Number.isNaN(dueMs)) {
          patchRoutine(routine.id, { nextDueAt: computeNext(routine, t) });
          continue;
        }
        if (dueMs > t) continue;

        const missed = occurrencesBetween(routine.schedule.cron, routine.schedule.timezone, dueMs - 1, t);
        const late = t - dueMs > tickMs * 2 || resumedFromSleep;
        const scheduledFor = iso(missed[missed.length - 1] ?? dueMs);
        patchRoutine(routine.id, { nextDueAt: computeNext(routine, t) });

        if (!late) {
          dispatch(routine, "due", scheduledFor);
        } else if (routine.missedRun === "skip") {
          const skipped = newRun(routine, "due", scheduledFor, "skipped-missed", `Skipped ${missed.length} run${missed.length === 1 ? "" : "s"} that came up while NONON was not running.`);
          recordRun(skipped);
          patchRoutine(routine.id, { lastRunAt: skipped.finishedAt, lastRunStatus: "skipped-missed" });
        } else {
          const detail = missed.length > 1 ? `Caught up once after ${missed.length} missed runs.` : "Caught up after a missed run.";
          dispatch(routine, "catch-up", scheduledFor, detail);
        }
      }

      for (const [runId] of waitRetries) {
        const run = findRun(runId);
        if (!run || run.status !== "running") {
          waitRetries.delete(runId);
          continue;
        }
        if (activeRunId === runId || queue.some((q) => q.runId === runId)) continue;
        queue.push({ runId, enqueuedAt: t, trigger: run.trigger, retry: true });
      }
      void pump();
    } finally {
      ticking = false;
    }
  }

  function recoverRuns(): void {
    for (const run of runs.filter((r) => r.status === "running")) {
      let task: Task | undefined;
      try {
        task = run.taskId ? ctx.svc.tasks.get(run.taskId) : undefined;
      } catch {
        task = undefined;
      }
      if (task && (task.state === "review" || task.state === "complete" || task.state === "clarifying" || task.state === "failed" || task.state === "needs-attention")) {
        mapOutcome(run, task);
      } else if (task && task.state === "waiting") {
        waitRetries.set(run.id, { attempts: 0, taskId: task.id });
        updateRun(run, { detail: `Waiting for ${task.waitingOn ?? "something it needs"}. NONON will try again shortly.` });
      } else {
        // Not repeating it: the task may have written files before the app died. The user can run it again on purpose.
        finishRun(run, "interrupted", "NONON closed while this was running. Nothing was repeated. Run it again when you are ready.");
      }
    }
  }

  // ---------------------------------------------------------------- service

  const handle: SchedulerHandle = {
    start() {
      load();
      if (timer !== null) return;
      recoverRuns();
      const t = now();
      for (const routine of routines.values()) {
        if (routine.enabled && !routine.nextDueAt) patchRoutine(routine.id, { nextDueAt: computeNext(routine, t) });
        if (!routine.enabled && routine.nextDueAt) patchRoutine(routine.id, { nextDueAt: undefined });
      }
      timer = startInterval(() => void tick(), tickMs);
      void tick();
    },

    stop() {
      if (timer !== null) stopInterval(timer);
      timer = null;
    },

    list(workspaceId) {
      load();
      return [...routines.values()].filter((r) => !workspaceId || r.workspaceId === workspaceId).map((r) => ({ ...r }));
    },

    propose(workspaceId, text) {
      load();
      return proposeRoutine(ctx, { workspaceId, text, now, timeZone: zoneNow });
    },

    save(input) {
      load();
      const routine = validate(input);
      const existing = routines.get(routine.id);
      const saved: Routine = {
        ...routine,
        id: routine.id || `rtn_${randomUUID()}`,
        createdAt: existing?.createdAt ?? routine.createdAt ?? iso(now()),
        schedule: { ...routine.schedule, humanText: routine.schedule.humanText || humanizeCron(routine.schedule.cron) },
        params: routine.params ?? {},
        ...(existing?.lastRunAt ? { lastRunAt: existing.lastRunAt } : {}),
        ...(existing?.lastRunStatus ? { lastRunStatus: existing.lastRunStatus } : {}),
      };
      delete saved.nextDueAt;
      const next = computeNext(saved, now());
      if (next) saved.nextDueAt = next;
      routines.set(saved.id, saved);
      persistRoutines();
      emitRoutine(saved);
      return { ...saved };
    },

    setEnabled(id, enabled) {
      load();
      const routine = routines.get(id);
      if (!routine) throw new Error("That routine no longer exists.");
      routine.enabled = enabled;
      if (enabled) routine.nextDueAt = computeNext(routine, now()) as string;
      else delete routine.nextDueAt;
      persistRoutines();
      emitRoutine(routine);
      return { ...routine };
    },

    async runNow(id) {
      load();
      const routine = routines.get(id);
      if (!routine) throw new Error("That routine no longer exists.");
      return dispatch(routine, "manual", iso(now()));
    },

    remove(id) {
      load();
      if (!routines.delete(id)) return;
      for (let i = queue.length - 1; i >= 0; i--) {
        const run = findRun(queue[i]!.runId);
        if (run?.routineId !== id) continue;
        queue.splice(i, 1);
        finishRun(run, "interrupted", "The routine was removed before this ran.");
      }
      for (const [runId] of waitRetries) {
        if (findRun(runId)?.routineId === id) waitRetries.delete(runId);
      }
      persistRoutines();
      signalIdle();
    },

    runs(routineId, limit = 50) {
      load();
      return runs
        .filter((r) => !routineId || r.routineId === routineId)
        .map((r) => ({ ...r }))
        .reverse()
        .slice(0, Math.max(1, limit));
    },

    setNotify(fn) {
      notifyFn = fn;
    },

    async checkNow() {
      load();
      await tick();
    },

    whenIdle() {
      if (activeRunId === null && (queue.length === 0 || nextRunnable() === -1)) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
  };

  return handle;
}
