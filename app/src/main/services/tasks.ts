import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import type {
  AiLocation,
  Check,
  FileFingerprint,
  InferenceClient,
  OutputRef,
  ProcedureDef,
  ProcedureOutcome,
  ProcedureRunContext,
  Question,
  Task,
  TaskState,
  Workspace,
} from "../../shared/contracts";
import { UserError, logError, plainMessage } from "./core/errors";
import { copyNewFile, extOf, isReallyInside, writeNewFile } from "./core/files";
import { fingerprint, newId, nowIso, safeName, sameFingerprint } from "./fs-util";
import { HostUnavailableError, PairedAuthError } from "./lan/errors";
import type { AppCtx, TaskService } from "./types";

const RUNNING_STATES: ReadonlySet<TaskState> = new Set(["inspecting", "running", "validating", "applying"]);
const RESUMABLE_STATES: ReadonlySet<TaskState> = new Set(["interrupted", "failed", "waiting", "needs-attention"]);
const PREFS_FILE = "prefs.json";
const RESTART_KEY = "restartOnChange";
const READY_POLL_MS = 500;

type Prefs = Record<string, Record<string, string>>;

interface LiveRun {
  task: Task;
  controller: AbortController;
}

export function createTaskService(ctx: AppCtx): TaskService {
  const live = new Map<string, LiveRun>();
  /** Clients handed in by callers (routines). Not persisted: after a restart a task falls back to the local AI. */
  const suppliedAi = new Map<string, InferenceClient>();
  const waiters = new Map<string, ((t: Task) => void)[]>();
  const cache = new Map<string, { mtimeMs: number; size: number; task: Task }>();

  const tasksDir = () => ctx.store.path("tasks");
  const fileFor = (id: string) => `tasks/${id}.json`;
  const snap = (t: Task): Task => structuredClone(t);

  // ---------------------------------------------------------------- persistence

  function readTask(id: string): Task | undefined {
    const running = live.get(id);
    if (running) return running.task;
    const file = ctx.store.path(fileFor(id));
    let st;
    try {
      st = statSync(file);
    } catch {
      cache.delete(id);
      return undefined;
    }
    const hit = cache.get(id);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.task;
    const task = ctx.store.read<Task | null>(fileFor(id), null);
    if (!task) return undefined;
    cache.set(id, { mtimeMs: st.mtimeMs, size: st.size, task });
    return task;
  }

  function allIds(): string[] {
    try {
      return readdirSync(tasksDir())
        .filter((n) => n.endsWith(".json"))
        .map((n) => n.slice(0, -5));
    } catch {
      return [];
    }
  }

  /** Persist, wake anyone waiting for the task to settle, and tell the window. */
  function commit(task: Task): void {
    task.updatedAt = nowIso();
    ctx.store.write(fileFor(task.id), task);
    cache.delete(task.id);
    // Checkpoints can hold whole extracted documents; the window never reads them.
    const { checkpoints: _skip, ...rest } = task;
    ctx.emit("task:updated", { ...structuredClone(rest), checkpoints: {} });
    if (!RUNNING_STATES.has(task.state)) {
      const list = waiters.get(task.id);
      if (list) {
        waiters.delete(task.id);
        for (const fn of list) fn(snap(task));
      }
    }
  }

  function setState(task: Task, state: TaskState, extra: Partial<Task> = {}): void {
    task.state = state;
    Object.assign(task, extra);
    commit(task);
  }

  function addStep(task: Task, label: string, detail?: string): void {
    task.steps.push({ at: nowIso(), label, ...(detail ? { detail } : {}) });
  }

  const mustGet = (id: string): Task => {
    const t = readTask(id);
    if (!t) throw new UserError("That job could not be found.");
    return t;
  };

  // ---------------------------------------------------------------- preferences

  const prefsKey = (workspaceId: string, procedureId: string) => `${workspaceId}:${procedureId}`;
  const readPrefs = (): Prefs => ctx.store.read<Prefs>(PREFS_FILE, {});
  const prefsFor = (task: Task): Record<string, string> => readPrefs()[prefsKey(task.workspaceId, task.procedureId)] ?? {};

  function remember(task: Task, answers: Record<string, string>): void {
    const prefs = readPrefs();
    const key = prefsKey(task.workspaceId, task.procedureId);
    prefs[key] = { ...(prefs[key] ?? {}), ...answers };
    ctx.store.write(PREFS_FILE, prefs);
  }

  // ---------------------------------------------------------------- AI choice

  /**
   * The one place that decides which AI a workspace may use. A paired computer is the user's own device on their own
   * network, so it is allowed in local-only workspaces and labelled "AI: Paired computer" wherever work is shown.
   * Connected cloud providers still need a cloud-allowed workspace.
   */
  function aiAllowed(ws: Workspace, ai: AiLocation): boolean {
    return ai === "local" || ai === "paired" || ws.policy === "cloud-allowed";
  }

  function permittedClient(ws: Workspace, requested: InferenceClient): InferenceClient {
    if (!aiAllowed(ws, requested.location.ai)) {
      throw new UserError("This project keeps everything on this computer, so online AI like Claude cannot be used here.");
    }
    return requested;
  }

  /** Honours the workspace's "use my other computer" choice. It never quietly becomes the local AI. */
  function preferredClient(ws: Workspace): InferenceClient | undefined {
    if (ws.preferredAi !== "paired") return undefined;
    const paired = ctx.svc.lan?.client();
    if (!paired) {
      throw new UserError("This project is set to use the AI on your other computer, but no other computer is paired. Pair one in Connections, or switch this project back to the AI on this computer.");
    }
    return paired;
  }

  function pauseForHost(task: Task, e: HostUnavailableError): void {
    addStep(task, e.reason === "unpaired" ? "This computer was unpaired" : "Your other computer is not available", e.message);
    setState(task, "waiting", { waitingOn: "your other computer", summary: e.message, questions: [], error: undefined });
  }

  // ---------------------------------------------------------------- inputs

  async function placeInput(ws: Workspace, procTitle: string, label: string, raw: string): Promise<string> {
    const abs = resolve(raw);
    const name = basename(abs);
    let st;
    try {
      st = statSync(abs);
    } catch {
      throw new UserError(`NONON could not find "${name}".`);
    }
    if (!st.isFile()) throw new UserError(`"${name}" is a folder, not a file. Choose a file for ${label}.`);
    const folder = ws.folder;
    if (!folder) throw new UserError("Choose a folder for this project first, then try again.");
    if (isReallyInside(folder, abs)) return abs;
    // Real paths, so a link in the person's folders cannot lead a job into NONON's own saved sign-ins and keys.
    if (isReallyInside(ctx.paths.dataDir, abs)) throw new UserError(`NONON cannot use "${name}" for ${procTitle}.`);
    // A file picked from elsewhere is copied in once; the job only ever reads the copy.
    const inputsDir = join(ctx.svc.workspaces.outputDir(ws.id), "inputs");
    mkdirSync(inputsDir, { recursive: true });
    const existing = join(inputsDir, safeName(name));
    if (existsSync(existing) && sameFingerprint(await fingerprint(existing), await fingerprint(abs))) return existing;
    return copyNewFile(abs, inputsDir, name);
  }

  async function resolveInputs(
    ws: Workspace,
    proc: ProcedureDef,
    files: Record<string, string[]> | undefined,
    text: Record<string, string> | undefined,
  ): Promise<{ files: Record<string, string[]>; text: Record<string, string> }> {
    const outFiles: Record<string, string[]> = {};
    for (const [key, list] of Object.entries(files ?? {})) {
      const input = proc.inputs.find((i) => i.key === key);
      if (!input || (input.kind !== "file" && input.kind !== "files")) {
        throw new UserError(`${proc.title} does not take files for "${key}".`);
      }
      if (input.kind === "file" && list.length > 1) throw new UserError(`${input.label}: choose just one file.`);
      const placed: string[] = [];
      for (const raw of list) {
        const ext = extOf(raw);
        if (input.accept?.length && !input.accept.includes(ext)) {
          throw new UserError(`${input.label} needs ${input.accept.join(", ")} files, and "${basename(raw)}" is not one.`);
        }
        placed.push(await placeInput(ws, proc.title, input.label, raw));
      }
      if (placed.length > 0) outFiles[key] = placed;
    }

    const outText: Record<string, string> = {};
    for (const [key, value] of Object.entries(text ?? {})) {
      const input = proc.inputs.find((i) => i.key === key);
      if (!input || input.kind === "file" || input.kind === "files") throw new UserError(`${proc.title} does not take text for "${key}".`);
      if (input.kind === "choice" && input.options && !input.options.some((o) => o.value === value)) {
        throw new UserError(`${input.label}: "${value}" is not one of the choices.`);
      }
      if (input.kind === "number" && !Number.isFinite(Number(value))) throw new UserError(`${input.label} needs a number.`);
      outText[key] = value;
    }

    const missing = proc.inputs.filter((i) => {
      if (i.optional) return false;
      return i.kind === "file" || i.kind === "files" ? !outFiles[i.key]?.length : !(outText[i.key] ?? "").trim();
    });
    if (missing.length > 0) {
      throw new UserError(`${proc.title} still needs: ${missing.map((m) => m.label).join(", ")}.`);
    }
    return { files: outFiles, text: outText };
  }

  async function fingerprintAll(files: Record<string, string[]>): Promise<Record<string, FileFingerprint[]>> {
    const out: Record<string, FileFingerprint[]> = {};
    for (const [key, list] of Object.entries(files)) {
      out[key] = [];
      for (const p of list) {
        try {
          out[key]!.push(await fingerprint(p));
        } catch {
          throw new UserError(`NONON could not read "${basename(p)}". Is it open in another program?`);
        }
      }
    }
    return out;
  }

  const pathsOf = (task: Task): Record<string, string[]> =>
    Object.fromEntries(Object.entries(task.inputs).map(([k, list]) => [k, list.map((f) => f.path)]));

  async function changedInputs(task: Task): Promise<string[]> {
    const changed: string[] = [];
    for (const list of Object.values(task.inputs)) {
      for (const before of list) {
        const now = await fingerprint(before.path).catch(() => null);
        if (!sameFingerprint(before, now)) changed.push(basename(before.path));
      }
    }
    return changed;
  }

  const quoteNames = (names: string[]): string => {
    const q = names.map((n) => `"${n}"`);
    return q.length <= 2 ? q.join(" and ") : `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`;
  };

  function flagChangedInputs(task: Task, changed: string[]): void {
    const message = `${quoteNames(changed)} changed after this job started, so the earlier work may be out of date.`;
    const question: Question = {
      id: RESTART_KEY,
      prompt: `${message} Start again with the new version?`,
      kind: "confirm",
      options: [
        { value: "yes", label: "Start again" },
        { value: "no", label: "Leave it" },
      ],
      suggested: "yes",
    };
    addStep(task, "A file changed", changed.join(", "));
    setState(task, "needs-attention", { summary: message, questions: [question], waitingOn: undefined, error: undefined });
  }

  async function restartFresh(task: Task): Promise<void> {
    task.inputs = await fingerprintAll(pathsOf(task));
    task.checkpoints = {};
    task.outputs = [];
    task.checks = [];
    task.report = undefined;
    addStep(task, "Started again with the new version of your files");
  }

  const affirmative = (v: string | undefined): boolean => !!v && !/^(no|false|0|cancel|leave it)$/i.test(v.trim());

  // ---------------------------------------------------------------- running

  function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((done) => {
      const timer = setTimeout(done, ms);
      timer.unref?.();
      signal.addEventListener("abort", () => (clearTimeout(timer), done()), { once: true });
    });
  }

  async function waitForLocalAi(task: Task, signal: AbortSignal): Promise<boolean> {
    addStep(task, "Waiting for the AI on this computer to finish setting up");
    setState(task, "waiting", { waitingOn: "the AI on this computer to finish setting up" });
    while (!ctx.svc.runtime.isReady()) {
      await sleep(READY_POLL_MS, signal);
      if (signal.aborted) return false;
    }
    return !signal.aborted;
  }

  function rejectStaleProposals(task: Task): void {
    for (const id of task.proposalIds) {
      try {
        if (ctx.svc.changes.get(id)?.status === "staged") ctx.svc.changes.reject(id);
      } catch (e) {
        ctx.log(`could not withdraw earlier proposal ${id}: ${plainMessage(e)}`);
      }
    }
    task.proposalIds = [];
  }

  function buildRunContext(
    task: Task,
    ws: Workspace,
    ai: InferenceClient,
    signal: AbortSignal,
    outputDir: string,
  ): ProcedureRunContext {
    return {
      task,
      workspace: ws,
      outputDir,
      files: pathsOf(task),
      text: { ...task.text },
      answers: { ...prefsFor(task), ...task.answers },
      ai,
      signal,
      step(label, detail) {
        if (signal.aborted) return;
        addStep(task, label, detail);
        commit(task);
      },
      checkpoint<T>(key: string): T | undefined {
        return task.checkpoints[key] as T | undefined;
      },
      saveCheckpoint(key, value) {
        if (signal.aborted) return;
        if (value === undefined) delete task.checkpoints[key];
        else task.checkpoints[key] = JSON.parse(JSON.stringify(value));
        commit(task);
      },
      async writeOutput(name, data, kind, label) {
        if (signal.aborted) throw new Error("This job was stopped.");
        const fileName = extname(name) ? name : `${name}.${kind}`;
        const path = await writeNewFile(outputDir, fileName, data);
        const ref: OutputRef = { path, label: label ?? basename(path), kind };
        if (!signal.aborted) {
          task.outputs = [...task.outputs.filter((o) => o.path !== path), ref];
          commit(task);
        }
        return ref;
      },
    };
  }

  function verifyOutputs(task: Task, wsId: string, declared: OutputRef[]): { outputs: OutputRef[]; checks: Check[] } {
    const merged = new Map<string, OutputRef>();
    for (const o of [...task.outputs, ...declared]) merged.set(resolve(o.path), o);
    const outputs: OutputRef[] = [];
    const checks: Check[] = [];
    for (const o of merged.values()) {
      let ok = false;
      try {
        ctx.svc.workspaces.assertInside(wsId, o.path);
        ok = existsSync(o.path) && statSync(o.path).isFile();
      } catch {
        ok = false;
      }
      if (ok) outputs.push(o);
      else
        checks.push({
          id: `output-${basename(o.path)}`,
          label: "Result file is in place",
          status: "fail",
          detail: `NONON could not find "${basename(o.path)}" in the project folder.`,
        });
    }
    return { outputs, checks };
  }

  async function finish(task: Task, ws: Workspace, outcome: ProcedureOutcome): Promise<void> {
    if (outcome.kind === "needs-input") {
      addStep(task, "Needs your input", outcome.reason);
      setState(task, "clarifying", { questions: outcome.questions, summary: outcome.reason, waitingOn: undefined });
      return;
    }
    if (outcome.kind === "unsupported" && /^waiting for connectivity/i.test(outcome.reason)) {
      addStep(task, "Waiting for the internet", outcome.reason);
      setState(task, "waiting", { summary: outcome.reason, questions: [], waitingOn: "an internet connection" });
      return;
    }
    if (outcome.kind === "unsupported") {
      addStep(task, "Not something NONON can do yet", outcome.suggestion);
      setState(task, "needs-attention", { summary: outcome.reason, questions: [], waitingOn: undefined });
      return;
    }

    task.summary = outcome.summary;
    task.report = outcome.report;
    task.questions = [];
    const verified = verifyOutputs(task, ws.id, outcome.outputs);
    task.outputs = verified.outputs;
    task.checks = [...outcome.checks, ...verified.checks];
    addStep(task, "Checking the result");
    setState(task, "validating");

    if (outcome.proposals.length > 0) {
      const staged = await ctx.svc.changes.stage(task, outcome.proposals);
      task.proposalIds = staged.map((p) => p.id);
    }
    const failed = task.checks.some((c) => c.status === "fail");
    if (failed) {
      addStep(task, "Something needs a look before this can be used");
      setState(task, "needs-attention");
    } else if (task.proposalIds.length > 0) {
      addStep(task, "Ready for your review", `${task.proposalIds.length} change${task.proposalIds.length === 1 ? "" : "s"} waiting for your OK`);
      setState(task, "review");
    } else {
      addStep(task, "Done");
      setState(task, "complete");
    }
  }

  async function execute(run: LiveRun): Promise<void> {
    const { task, controller } = run;
    const { signal } = controller;
    const lostHost: { e: HostUnavailableError | null } = { e: null };
    let stopWatching: (() => void) | undefined;
    try {
      const ws = ctx.svc.workspaces.get(task.workspaceId);
      if (!ws) throw new UserError("This job's project no longer exists.");
      const proc = ctx.svc.procedures.get(task.procedureId);
      if (!proc) throw new UserError("NONON no longer has the job this was started with.");

      let ai: InferenceClient;
      let handed = suppliedAi.get(task.id);
      if (!handed && task.locations.ai === "paired") {
        // After a restart the supplied client is gone, but paired work must stay paired, never drift to the local AI.
        handed = ctx.svc.lan?.client() ?? undefined;
        if (!handed) {
          pauseForHost(task, new PairedAuthError());
          return;
        }
      }
      if (handed && aiAllowed(ws, handed.location.ai)) {
        ai = handed;
      } else {
        if (handed) {
          suppliedAi.delete(task.id);
          addStep(task, "Using the AI on this computer because this project keeps everything here");
        }
        ai = ctx.svc.runtime.client();
        if (!ctx.svc.runtime.isReady() && !(await waitForLocalAi(task, signal))) return;
      }
      task.locations = ai.location;
      // A host that vanishes mid-run stops the whole run (procedures may swallow the error), then the task waits.
      if ("onHostLost" in ai && typeof ai.onHostLost === "function") {
        stopWatching = (ai as { onHostLost(cb: (e: HostUnavailableError) => void): () => void }).onHostLost((e) => {
          lostHost.e ??= e;
          controller.abort();
        });
      }

      const outputDir = ctx.svc.workspaces.outputDir(ws.id);
      rejectStaleProposals(task);
      task.outputs = [];
      task.waitingOn = undefined;
      task.error = undefined;
      setState(task, "running");

      const outcome = await proc.run(buildRunContext(task, ws, ai, signal, outputDir));
      if (lostHost.e && live.get(task.id) === run) return pauseForHost(task, lostHost.e);
      if (signal.aborted) return;
      await finish(task, ws, outcome);
    } catch (e) {
      const lost = lostHost.e ?? (e instanceof HostUnavailableError ? e : null);
      if (lost && live.get(task.id) === run) return pauseForHost(task, lost);
      if (signal.aborted) return;
      logError(ctx.log, `task ${task.id} failed`, e);
      addStep(task, "Stopped by a problem", plainMessage(e));
      setState(task, "failed", { error: plainMessage(e), waitingOn: undefined });
    } finally {
      stopWatching?.();
      if (live.get(task.id) === run) live.delete(task.id);
    }
  }

  function launch(task: Task): void {
    if (live.has(task.id)) throw new UserError("This job is already running.");
    const run: LiveRun = { task, controller: new AbortController() };
    live.set(task.id, run);
    void execute(run);
  }

  // ---------------------------------------------------------------- service

  const svc: TaskService = {
    list(workspaceId) {
      return allIds()
        .map(readTask)
        .filter((t): t is Task => !!t && t.workspaceId === workspaceId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(snap);
    },

    get(id) {
      const t = readTask(id);
      return t ? snap(t) : undefined;
    },

    async start(input) {
      const ws = ctx.svc.workspaces.get(input.workspaceId);
      if (!ws) throw new UserError("That project no longer exists.");
      const proc = ctx.svc.procedures.get(input.procedureId);
      if (!proc) throw new UserError("NONON does not know how to do that job.");
      const chosen = input.ai ? permittedClient(ws, input.ai) : preferredClient(ws);
      const client = chosen ?? ctx.svc.runtime.client();

      const resolved = await resolveInputs(ws, proc, input.files, input.text);
      const inputs = await fingerprintAll(resolved.files);

      const names = Object.values(resolved.files).flat().map((p) => basename(p));
      const now = nowIso();
      const task: Task = {
        id: newId("task"),
        workspaceId: ws.id,
        procedureId: proc.id,
        procedureRevision: proc.revision,
        title: names.length > 0 ? `${proc.title} (${names[0]}${names.length > 1 ? ` and ${names.length - 1} more` : ""})` : proc.title,
        state: "inspecting",
        createdAt: now,
        updatedAt: now,
        inputs,
        text: resolved.text,
        answers: { ...(input.answers ?? {}) },
        questions: [],
        steps: [],
        checkpoints: {},
        outputs: [],
        proposalIds: [],
        checks: [],
        locations: client.location,
        ...(input.routineRunId ? { routineRunId: input.routineRunId } : {}),
      };
      addStep(task, "Looked at your files", names.join(", ") || undefined);
      if (chosen) suppliedAi.set(task.id, chosen);
      commit(task);
      const first = snap(task);
      launch(task);
      return first;
    },

    async answer(id, answers, rememberIt) {
      const task = mustGet(id);
      if (live.has(id)) throw new UserError("This job is still running.");
      const answerable = task.state === "clarifying" || (task.state === "needs-attention" && task.questions.length > 0);
      if (!answerable) throw new UserError("This job is not waiting for an answer.");

      const clean = Object.fromEntries(Object.entries(answers).filter(([, v]) => typeof v === "string"));
      task.answers = { ...task.answers, ...clean };
      if (rememberIt) {
        const persistent = { ...clean };
        delete persistent[RESTART_KEY];
        if (Object.keys(persistent).length > 0) remember(task, persistent);
      }

      const restartAnswer = task.answers[RESTART_KEY];
      if (restartAnswer !== undefined && !affirmative(restartAnswer)) {
        delete task.answers[RESTART_KEY];
        task.questions = [];
        addStep(task, "Left as it was");
        setState(task, "interrupted");
        return snap(task);
      }
      const changed = await changedInputs(task);
      if (changed.length > 0) {
        if (restartAnswer === undefined) {
          flagChangedInputs(task, changed);
          return snap(task);
        }
        await restartFresh(task);
      }
      delete task.answers[RESTART_KEY];
      task.questions = [];
      addStep(task, "Got your answer", Object.keys(clean).filter((k) => k !== RESTART_KEY).join(", ") || undefined);
      commit(task);
      launch(task);
      return snap(task);
    },

    stop(id) {
      const task = mustGet(id);
      const run = live.get(id);
      if (!run) return snap(task);
      run.controller.abort();
      live.delete(id);
      addStep(task, "Stopped");
      setState(task, "interrupted", { waitingOn: undefined });
      return snap(task);
    },

    async resume(id) {
      const task = mustGet(id);
      if (live.has(id)) throw new UserError("This job is already running.");
      if (!RESUMABLE_STATES.has(task.state)) {
        throw new UserError(task.state === "clarifying" ? "Answer the questions first." : "There is nothing to continue on this job.");
      }
      const changed = await changedInputs(task);
      if (changed.length > 0) {
        if (!affirmative(task.answers[RESTART_KEY])) {
          flagChangedInputs(task, changed);
          return snap(task);
        }
        await restartFresh(task);
      }
      delete task.answers[RESTART_KEY];
      task.questions = [];
      addStep(task, "Continuing");
      commit(task);
      launch(task);
      return snap(task);
    },

    settled(id) {
      const task = mustGet(id);
      if (!RUNNING_STATES.has(task.state)) return Promise.resolve(snap(task));
      return new Promise<Task>((done) => {
        waiters.set(id, [...(waiters.get(id) ?? []), done]);
      });
    },

    recoverInterrupted() {
      for (const id of allIds()) {
        const task = readTask(id);
        if (!task || live.has(id) || !RUNNING_STATES.has(task.state)) continue;
        addStep(task, "The app closed while this was running");
        setState(task, "interrupted", { waitingOn: undefined });
      }
    },

    update(id, patch) {
      const task = mustGet(id);
      const { state, ...rest } = patch;
      Object.assign(task, rest);
      if (state) task.state = state;
      commit(task);
      return snap(task);
    },
  };
  return svc;
}
