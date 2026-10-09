/** Fakes for scheduler tests: in-memory store, fake clock, fake TaskService, real temp folders. Not shipped code. */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  InferenceClient,
  InferenceRequest,
  InferenceResult,
  ProcedureDef,
  ProviderStatus,
  Routine,
  Task,
  Workspace,
} from "../../../shared/contracts";
import type { Events } from "../../../shared/ipc";
import type { JsonStore } from "../store";
import type { AppCtx, Services, TaskService } from "../types";
import { createScheduler, type SchedulerHandle, type SchedulerOptions } from "./service";

export function memoryStore(): JsonStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    dir: "memory",
    path: (n) => n,
    read<T>(name: string, fallback: T): T {
      const raw = files.get(name);
      return raw === undefined ? fallback : (JSON.parse(raw) as T);
    },
    write(name, data) {
      files.set(name, JSON.stringify(data));
    },
  };
}

export const LOCAL = { ai: "local", files: "this-computer" } as const;

export function fakeClient(location: InferenceClient["location"] = LOCAL, reply: (req: InferenceRequest) => string = () => "{}"): InferenceClient & { requests: InferenceRequest[] } {
  const requests: InferenceRequest[] = [];
  return {
    location,
    requests,
    async chat(req): Promise<InferenceResult> {
      requests.push(req);
      return { text: reply(req), location };
    },
  };
}

const noRun: ProcedureDef["run"] = async () => ({ kind: "unsupported", reason: "test double" });

export const PROCEDURES: ProcedureDef[] = [
  {
    id: "spreadsheet-compare",
    pack: "bookkeeping",
    title: "Compare two spreadsheets",
    summary: "Finds rows and amounts that do not match between two spreadsheets",
    supports: "xlsx and csv",
    limits: [],
    inputs: [
      { key: "fileA", label: "File A", kind: "file", accept: [".csv", ".xlsx"] },
      { key: "fileB", label: "File B", kind: "file", accept: [".csv", ".xlsx"] },
    ],
    revision: "1",
    run: noRun,
  },
  {
    id: "batch-summary",
    pack: "bookkeeping",
    title: "Summarise a batch of files",
    summary: "Reads several files of the same kind and summarises them",
    supports: "xlsx and csv",
    limits: [],
    inputs: [{ key: "sheets", label: "Files", kind: "files", accept: [".xlsx", ".xls", ".csv"] }],
    revision: "1",
    run: noRun,
  },
  {
    id: "gmail-brief",
    pack: "general",
    title: "Email brief",
    summary: "Summarises new email and flags what needs you",
    supports: "Gmail",
    limits: [],
    inputs: [],
    revision: "1",
    run: noRun,
  },
  {
    id: "meeting-followup",
    pack: "business",
    title: "Meeting follow-up",
    summary: "Turns meeting notes into a follow-up and a task list",
    supports: "txt md docx",
    limits: [],
    inputs: [{ key: "notes", label: "Meeting notes", kind: "file", accept: [".txt", ".md", ".docx"] }],
    revision: "1",
    run: noRun,
  },
];

export interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}
export function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

type StartInput = Parameters<TaskService["start"]>[0];

export class FakeTasks implements TaskService {
  startCalls: StartInput[] = [];
  resumeCalls: string[] = [];
  tasks = new Map<string, Task>();
  /** Outcomes handed out, one per settled() call. Default: complete. */
  outcomes: Partial<Task>[] = [];
  gate: Promise<void> | null = null;
  private n = 0;

  next(...patches: Partial<Task>[]): void {
    this.outcomes.push(...patches);
  }

  list(workspaceId: string): Task[] {
    return [...this.tasks.values()].filter((t) => t.workspaceId === workspaceId);
  }
  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }
  async start(input: StartInput): Promise<Task> {
    this.startCalls.push(input);
    const task = this.make(`task_${++this.n}`, input.workspaceId, input.procedureId, { routineRunId: input.routineRunId });
    this.tasks.set(task.id, task);
    return { ...task };
  }
  async resume(id: string): Promise<Task> {
    this.resumeCalls.push(id);
    const task = this.tasks.get(id)!;
    task.state = "running";
    return { ...task };
  }
  async settled(id: string): Promise<Task> {
    if (this.gate) await this.gate;
    const task = this.tasks.get(id)!;
    Object.assign(task, { state: "complete", summary: "Done." }, this.outcomes.shift() ?? {});
    return { ...task };
  }
  async answer(): Promise<Task> {
    throw new Error("not used");
  }
  stop(id: string): Task {
    return this.tasks.get(id)!;
  }
  recoverInterrupted(): void {}

  /** A task the user started by hand. */
  foreground(workspaceId: string, state: Task["state"] = "running"): Task {
    const t = this.make(`fg_${++this.n}`, workspaceId, "general", {});
    t.state = state;
    this.tasks.set(t.id, t);
    return t;
  }

  private make(id: string, workspaceId: string, procedureId: string, extra: Partial<Task>): Task {
    return {
      id,
      workspaceId,
      procedureId,
      procedureRevision: "1",
      title: "task",
      state: "running",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      inputs: {},
      text: {},
      answers: {},
      questions: [],
      steps: [],
      checkpoints: {},
      outputs: [],
      proposalIds: [],
      checks: [],
      locations: { ...LOCAL },
      ...extra,
    };
  }
}

export interface Harness {
  root: string;
  wsFolder: string;
  statements: string;
  ws: Workspace;
  clock: { ms: number };
  store: ReturnType<typeof memoryStore>;
  tasks: FakeTasks;
  events: { name: string; payload: unknown }[];
  ctx: AppCtx;
  svc: SchedulerHandle;
  intervals: { fn: () => void; ms: number; cleared: boolean }[];
  localClient: ReturnType<typeof fakeClient>;
  changesCalls: string[];
  providerState: { value: ProviderStatus["state"] };
  /** A second service over the same store, as after an app restart. */
  restart(options?: SchedulerOptions): SchedulerHandle;
  /** Move the clock in 30 s steps, ticking each time, as a running app would. */
  runClock(toMs: number): Promise<void>;
  /** Move the clock with no ticks in between: the computer was asleep or the app was closed. */
  sleepUntil(toMs: number): void;
  file(name: string, content: string, mtimeMs: number): string;
  cleanup(): void;
}

export function routineFor(h: Pick<Harness, "ws" | "statements">, over: Partial<Routine> = {}): Routine {
  return {
    id: "",
    workspaceId: h.ws.id,
    title: "Compare statements",
    description: "test",
    procedureId: "batch-summary",
    inputScope: { folder: h.statements, pick: { sheets: { newest: 2, extensions: [".xlsx", ".csv"] } } },
    params: {},
    schedule: { cron: "0 8 * * 1-5", timezone: "Asia/Manila", humanText: "Every weekday at 8:00 AM" },
    location: { ...LOCAL },
    allowedActions: ["read-files", "write-outputs"],
    missedRun: "catch-up-once",
    overlap: "skip",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

export const T0 = Date.parse("2026-10-08T23:00:00.000Z");

export function harness(options: { policy?: Workspace["policy"]; startMs?: number; schedulerOptions?: SchedulerOptions; modelReply?: (req: InferenceRequest) => string; runtimePhase?: string } = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), "nonon-sched-"));
  const wsFolder = join(root, "ws");
  const statements = join(wsFolder, "Statements");
  mkdirSync(statements, { recursive: true });
  const ws: Workspace = {
    id: "ws1",
    name: "Books",
    folder: wsFolder,
    pack: "bookkeeping",
    policy: options.policy ?? "local-only",
    autoApply: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const clock = { ms: options.startMs ?? T0 };
  const store = memoryStore();
  const tasks = new FakeTasks();
  const events: Harness["events"] = [];
  const intervals: Harness["intervals"] = [];
  const localClient = fakeClient(LOCAL, options.modelReply ?? (() => "not json"));
  const changesCalls: string[] = [];
  const providerState = { value: "ready" as ProviderStatus["state"] };

  const services = {
    workspaces: {
      list: () => [ws],
      get: (id: string) => (id === ws.id ? ws : undefined),
      assertInside(_id: string, p: string) {
        const norm = (s: string) => s.replace(/\\/g, "/").toLowerCase();
        if (!norm(p).startsWith(norm(wsFolder))) throw new Error("outside");
      },
    },
    procedures: {
      list: (pack?: string) => PROCEDURES.filter((p) => !pack || p.pack === pack || p.pack === "general"),
      get: (id: string) => PROCEDURES.find((p) => p.id === id),
      register: () => undefined,
    },
    tasks,
    runtime: {
      client: () => localClient,
      status: () => ({ phase: options.runtimePhase ?? "running" }),
      isReady: () => true,
    },
    providers: {
      list: (): ProviderStatus[] => [{ id: "claude", label: "Claude", state: providerState.value, disclosure: "", verified: "probe-only" }],
      clientFor: () => fakeClient({ ai: "claude", files: "this-computer" }),
    },
    changes: {
      apply: async () => {
        changesCalls.push("apply");
      },
      reject: () => {
        changesCalls.push("reject");
      },
    },
  } as unknown as Services;

  const ctx = {
    paths: { dataDir: root, modelDir: root, resourcesDir: root, logFile: join(root, "log") },
    store,
    emit<K extends keyof Events>(name: K, payload: Events[K]) {
      events.push({ name, payload });
    },
    log() {},
    recentLog: () => [],
    getSettings: () => ({}) as never,
    updateSettings: () => ({}) as never,
    svc: services,
  } as unknown as AppCtx;

  const baseOptions = (extra?: SchedulerOptions): SchedulerOptions => ({
    now: () => clock.ms,
    setInterval: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      intervals.push(t);
      return t;
    },
    clearInterval: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
    timeZone: "Asia/Manila",
    ...options.schedulerOptions,
    ...extra,
  });

  const svc = createScheduler(ctx, baseOptions());
  ctx.svc.scheduler = svc;

  const h: Harness = {
    root,
    wsFolder,
    statements,
    ws,
    clock,
    store,
    tasks,
    events,
    ctx,
    svc,
    intervals,
    localClient,
    changesCalls,
    providerState,
    restart(extra) {
      const next = createScheduler(ctx, baseOptions(extra));
      ctx.svc.scheduler = next;
      h.svc = next;
      return next;
    },
    async runClock(toMs) {
      while (clock.ms < toMs) {
        clock.ms = Math.min(clock.ms + 30_000, toMs);
        await h.svc.checkNow();
        if (!tasks.gate) await h.svc.whenIdle();
      }
    },
    sleepUntil(toMs) {
      clock.ms = toMs;
    },
    file(name, content, mtimeMs) {
      const p = join(statements, name);
      writeFileSync(p, content);
      utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
      return p;
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
  return h;
}
