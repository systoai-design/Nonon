import { app } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Settings } from "../shared/contracts";
import type { Events } from "../shared/ipc";
import { createChangeService } from "./services/changes";
import { createChatService } from "./services/chat";
import { createGmailService } from "./services/gmail";
import { createHardwareService } from "./services/hardware";
import { createLanService } from "./services/lan";
import { createProcedureRegistry } from "./services/procedures";
import { createProviderService } from "./services/providers";
import { createRuntimeService } from "./services/runtime";
import { createSchedulerService } from "./services/scheduler";
import { createStore } from "./services/store";
import { createTaskService } from "./services/tasks";
import type { AppCtx, Paths, Services } from "./services/types";
import { createWorkspaceService } from "./services/workspaces";
import { migrateSettings } from "./settings-migrate";

const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  companionName: "Non",
  character: "non",
  reducedMotion: false,
  activeWorkspaceId: null,
  modelId: null,
  backgroundRoutines: false,
  idleUnloadSeconds: 300,
  uiScale: 0.9,
};

export function resolvePaths(): Paths {
  const dataDir = process.env.NONON_DATA_DIR ?? join(app.getPath("userData"), "data");
  const modelDir = process.env.NONON_MODEL_DIR ?? join(app.getPath("userData"), "models");
  const resourcesDir = app.isPackaged ? join(process.resourcesPath, "resources") : join(app.getAppPath(), "resources");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(modelDir, { recursive: true });
  return { dataDir, modelDir, resourcesDir, logFile: join(dataDir, "nonon.log") };
}

export type Emit = <K extends keyof Events>(event: K, payload: Events[K]) => void;

export function createApp(emit: Emit): AppCtx {
  const paths = resolvePaths();
  const store = createStore(paths.dataDir);
  const saved = migrateSettings(store.read<Partial<Settings>>("settings.json", {}));
  let settings: Settings = { ...DEFAULT_SETTINGS, ...saved.settings };
  if (saved.changed) store.write("settings.json", settings);

  const recent: string[] = [];
  const ctx: AppCtx = {
    paths,
    store,
    emit,
    log(message) {
      const line = `${new Date().toISOString()} ${message}`;
      recent.push(line);
      if (recent.length > 400) recent.shift();
      try {
        appendFileSync(paths.logFile, `${line}\n`);
      } catch {
        /* logging must never take the app down */
      }
    },
    recentLog: () => recent,
    getSettings: () => settings,
    updateSettings(patch) {
      settings = { ...settings, ...patch };
      store.write("settings.json", settings);
      emit("settings:updated", settings);
      return settings;
    },
    svc: {} as Services,
  };

  // Dependency order: leaf services first.
  ctx.svc.hardware = createHardwareService(ctx);
  ctx.svc.runtime = createRuntimeService(ctx, { machine: () => ctx.svc.hardware.last() });
  ctx.svc.workspaces = createWorkspaceService(ctx);
  ctx.svc.procedures = createProcedureRegistry(ctx);
  ctx.svc.changes = createChangeService(ctx);
  ctx.svc.providers = createProviderService(ctx);
  ctx.svc.gmail = createGmailService(ctx);
  ctx.svc.lan = createLanService(ctx);
  ctx.svc.tasks = createTaskService(ctx);
  ctx.svc.chat = createChatService(ctx);
  ctx.svc.scheduler = createSchedulerService(ctx);
  return ctx;
}
