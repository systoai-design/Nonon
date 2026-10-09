import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ChangeProposal,
  ChangeProposalDraft,
  InferenceClient,
  InferenceRequest,
  Locations,
  ProcedureDef,
  ProcedureInput,
  ProcedureRunContext,
  ProcedureOutcome,
  Routine,
  Settings,
  Task,
} from "../../../shared/contracts";
import type { Events } from "../../../shared/ipc";
import { createChatService } from "../chat";
import { createStore } from "../store";
import { createTaskService } from "../tasks";
import type { AppCtx, ChangeService, ProcedureRegistry, RuntimeService, SchedulerService, Services } from "../types";
import { createWorkspaceService } from "../workspaces";

/** Test-only: a fake AppCtx with real workspace/task/chat services and fakes for everything they depend on. */

export const LOCAL: Locations = { ai: "local", files: "this-computer" };
export const CLOUD: Locations = { ai: "claude", files: "this-computer" };

export function fakeClient(location: Locations = LOCAL, answer: (req: InferenceRequest) => string = () => "{}"): InferenceClient & { calls: InferenceRequest[] } {
  const calls: InferenceRequest[] = [];
  return {
    location,
    calls,
    async chat(req) {
      calls.push(req);
      return { text: answer(req), location };
    },
  };
}

export interface Harness {
  ctx: AppCtx;
  root: string;
  folder: string;
  events: { event: keyof Events; payload: unknown }[];
  logs: string[];
  settings: Settings;
  runtime: { ready: boolean; client: InferenceClient };
  staged: ChangeProposal[];
  proposals: { workspaceId: string; text: string }[];
  registry: Map<string, ProcedureDef>;
  taskStates(taskId: string): string[];
  cleanup(): void;
}

export function makeHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "nonon-core-"));
  const dataDir = join(root, "data");
  const resourcesDir = join(root, "res");
  const folder = join(root, "ws");
  mkdirSync(folder, { recursive: true });
  mkdirSync(resourcesDir, { recursive: true });

  const settings: Settings = {
    onboarded: true,
    companionName: "Test",
    character: "non",
    reducedMotion: false,
    activeWorkspaceId: null,
    modelId: null,
    backgroundRoutines: false,
    idleUnloadSeconds: 300,
  };
  const events: Harness["events"] = [];
  const logs: string[] = [];
  const staged: ChangeProposal[] = [];
  const proposals: Harness["proposals"] = [];
  const registry = new Map<string, ProcedureDef>();
  const runtime = { ready: true, client: fakeClient() as InferenceClient };

  const procedures: ProcedureRegistry = {
    list: (pack) => [...registry.values()].filter((d) => !pack || d.pack === pack || d.pack === "general"),
    get: (id) => registry.get(id),
    register: (d) => void registry.set(d.id, d),
  };
  const changes: Partial<ChangeService> = {
    async stage(task: Task, drafts: ChangeProposalDraft[]) {
      const made = drafts.map((d, i): ChangeProposal => ({
        ...d,
        id: `chg_${task.id}_${i}`,
        taskId: task.id,
        workspaceId: task.workspaceId,
        procedureRevision: task.procedureRevision,
        base: null,
        createdAt: new Date().toISOString(),
        status: "staged",
      }));
      staged.push(...made);
      return made;
    },
    get: (id) => staged.find((p) => p.id === id),
    reject(id) {
      const p = staged.find((x) => x.id === id);
      if (!p) throw new Error("no such change");
      p.status = "rejected";
      return p;
    },
  };
  const scheduler: Partial<SchedulerService> = {
    async propose(workspaceId, text) {
      proposals.push({ workspaceId, text });
      return {
        id: "routine_test",
        workspaceId,
        title: "Test routine",
        description: text,
        procedureId: "x",
        inputScope: { folder, pick: {} },
        params: {},
        schedule: { cron: "0 8 * * 1-5", timezone: "UTC", humanText: "Every weekday at 8:00 AM" },
        location: LOCAL,
        allowedActions: ["read-files", "write-outputs"],
        missedRun: "catch-up-once",
        overlap: "skip",
        enabled: false,
        createdAt: new Date().toISOString(),
      } satisfies Routine;
    },
  };

  const ctx: AppCtx = {
    paths: { dataDir, modelDir: join(root, "models"), resourcesDir, logFile: join(root, "log.txt") },
    store: createStore(dataDir),
    emit: (event, payload) => void events.push({ event, payload }),
    log: (m) => void logs.push(m),
    recentLog: () => logs,
    getSettings: () => settings,
    updateSettings: (patch) => Object.assign(settings, patch),
    svc: {} as Services,
  };
  const rt: Partial<RuntimeService> = { isReady: () => runtime.ready, client: () => runtime.client };
  ctx.svc.runtime = rt as RuntimeService;
  ctx.svc.procedures = procedures;
  ctx.svc.changes = changes as ChangeService;
  ctx.svc.scheduler = scheduler as SchedulerService;
  ctx.svc.workspaces = createWorkspaceService(ctx);
  ctx.svc.tasks = createTaskService(ctx);
  ctx.svc.chat = createChatService(ctx);

  return {
    ctx,
    root,
    folder,
    events,
    logs,
    settings,
    runtime,
    staged,
    proposals,
    registry,
    taskStates(taskId) {
      const states: string[] = [];
      for (const e of events) {
        if (e.event !== "task:updated") continue;
        const t = e.payload as Task;
        if (t.id === taskId && states[states.length - 1] !== t.state) states.push(t.state);
      }
      return states;
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function writeFile(path: string, text = "a,b\n1,2\n"): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
}

export function makeProc(
  id: string,
  run: (ctx: ProcedureRunContext) => Promise<ProcedureOutcome>,
  inputs: ProcedureInput[] = [],
  extra: Partial<ProcedureDef> = {},
): ProcedureDef {
  return { id, pack: "general", title: id, summary: `${id} summary`, supports: "", limits: [], inputs, revision: "1", run, ...extra };
}

export const done = (extra: Partial<Extract<ProcedureOutcome, { kind: "done" }>> = {}): ProcedureOutcome => ({
  kind: "done",
  summary: "ok",
  outputs: [],
  proposals: [],
  checks: [],
  ...extra,
});
