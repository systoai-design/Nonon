import type {
  AppState,
  ChangeProposal,
  ChangeProposalDraft,
  ChatEntry,
  EmailBrief,
  FileEntry,
  GmailStatus,
  HardwareReport,
  InferenceClient,
  LanClientStatus,
  LanStatus,
  ModelRecommendation,
  PackId,
  PairedDevice,
  PairingCodeInfo,
  ProcedureDef,
  ProjectRoles,
  ProviderId,
  ProviderStatus,
  RoleName,
  Routine,
  RoutineRun,
  RuntimeStatus,
  Settings,
  Task,
  Workspace,
  CloudPolicy,
} from "../../shared/contracts";
import type { Events } from "../../shared/ipc";
import type { JsonStore } from "./store";

export interface Paths {
  /** Small app data: settings, tasks, routines, change records. */
  dataDir: string;
  /** Runtime binaries and GGUF models. Override with NONON_MODEL_DIR. */
  modelDir: string;
  /** Bundled read-only resources (sample fixtures, notices). */
  resourcesDir: string;
  logFile: string;
}

export interface AppCtx {
  paths: Paths;
  store: JsonStore;
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
  log(message: string): void;
  recentLog(): string[];
  getSettings(): Settings;
  updateSettings(patch: Partial<Settings>): Settings;
  svc: Services;
}

export interface Services {
  hardware: HardwareService;
  runtime: RuntimeService;
  workspaces: WorkspaceService;
  procedures: ProcedureRegistry;
  changes: ChangeService;
  tasks: TaskService;
  chat: ChatService;
  scheduler: SchedulerService;
  gmail: GmailService;
  providers: ProviderService;
  lan: LanService;
}

export interface HardwareService {
  assess(): Promise<{ report: HardwareReport; recommendation: ModelRecommendation | null; alternatives: ModelRecommendation[] }>;
  last(): HardwareReport | null;
}

export interface RuntimeService {
  status(): RuntimeStatus;
  install(modelId: string): Promise<void>;
  cancel(): void;
  /** Starts llama-server if needed; resolves when it answers. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** The local inference client. Starts the server on first use and unloads it when idle. */
  client(): InferenceClient;
  isReady(): boolean;
}

export interface WorkspaceService {
  list(): Workspace[];
  get(id: string): Workspace | undefined;
  create(input: { name: string; folder: string | null; pack: PackId; policy?: CloudPolicy }): Workspace;
  update(id: string, patch: Partial<Pick<Workspace, "name" | "folder" | "pack" | "policy" | "autoApply" | "preferredAi">>): Workspace;
  remove(id: string): void;
  files(id: string): Promise<FileEntry[]>;
  /** Folder NONON writes its own outputs to: <workspace folder>/NONON Output. Created on demand. */
  outputDir(id: string): string;
  /** Throws unless `path` is inside the workspace folder or its output folder. */
  assertInside(id: string, path: string): void;
  addSamples(id: string): Promise<FileEntry[]>;
}

export interface ProcedureRegistry {
  list(pack?: PackId): ProcedureDef[];
  get(id: string): ProcedureDef | undefined;
  register(def: ProcedureDef): void;
}

export interface ChangeService {
  /** Stamps ids and base fingerprints, persists, and emits change:updated. Nothing is written to originals. */
  stage(task: Task, drafts: ChangeProposalDraft[]): Promise<ChangeProposal[]>;
  list(filter: { workspaceId?: string; taskId?: string }): ChangeProposal[];
  get(id: string): ChangeProposal | undefined;
  /** Re-fingerprints the target; refuses stale proposals. Makes a recovery copy before writing. */
  apply(id: string): Promise<ChangeProposal>;
  reject(id: string): ChangeProposal;
  /** Restores the recovery copy unless the target changed after apply. */
  recover(id: string): Promise<ChangeProposal>;
}

export interface TaskService {
  list(workspaceId: string): Task[];
  get(id: string): Task | undefined;
  start(input: {
    workspaceId: string;
    procedureId: string;
    files?: Record<string, string[]>;
    text?: Record<string, string>;
    answers?: Record<string, string>;
    routineRunId?: string;
    /** Routines pass their own client (local unless the routine authorises a provider). */
    ai?: InferenceClient;
  }): Promise<Task>;
  answer(id: string, answers: Record<string, string>, remember?: boolean): Promise<Task>;
  stop(id: string): Task;
  resume(id: string): Promise<Task>;
  /** Resolves when the task leaves a running state. Used by the scheduler and tests. */
  settled(id: string): Promise<Task>;
  /** Marks tasks that were running when the app died as interrupted. Call once at startup. */
  recoverInterrupted(): void;
  /** Merge fields into a stored task, persist it and emit task:updated. For the changes service to move a task to applying/complete/etc. */
  update?(id: string, patch: Partial<Omit<Task, "id" | "workspaceId">>): Task;
}

export interface ChatService {
  history(workspaceId: string): ChatEntry[];
  send(workspaceId: string, text: string, files?: string[]): Promise<ChatEntry[]>;
  /** Aborts the reply being written for this project. A no-op when nothing is in flight. */
  stop(workspaceId: string): void;
}

export interface SchedulerService {
  start(): void;
  stop(): void;
  list(workspaceId?: string): Routine[];
  propose(workspaceId: string, text: string): Promise<Routine>;
  save(routine: Routine): Routine;
  setEnabled(id: string, enabled: boolean): Routine;
  runNow(id: string): Promise<RoutineRun>;
  remove(id: string): void;
  runs(routineId?: string, limit?: number): RoutineRun[];
}

export interface GmailService {
  status(): GmailStatus;
  connect(): Promise<GmailStatus>;
  disconnect(): Promise<GmailStatus>;
  brief(
    workspaceId: string,
    opts?: { forceOffline?: boolean; ai?: InferenceClient; lookbackDays?: number; signal?: AbortSignal },
  ): Promise<EmailBrief>;
}

export interface ProviderService {
  list(): ProviderStatus[];
  probe(id: ProviderId): Promise<ProviderStatus>;
  signIn(id: ProviderId): Promise<ProviderStatus>;
  roles(workspaceId: string): ProjectRoles;
  setRole(workspaceId: string, role: RoleName, provider: ProviderId | "local" | null): ProjectRoles;
  /** Inference client that runs through a connected provider, only for workspaces whose policy allows it. */
  clientFor(workspaceId: string, provider: ProviderId): InferenceClient;
}

/**
 * Optional shared compute on the same network. Off by default; the offline core never depends on it.
 * Host side shares this computer's local AI with computers the user approved. Client side uses another computer's AI,
 * only when the user chooses "paired" for a task or workspace.
 */
export interface LanService {
  status(): LanStatus;
  startHost(): Promise<LanStatus>;
  stopHost(): Promise<LanStatus>;
  /** Creates a single-use pairing code (valid 5 minutes). Starts nothing: the host must already be running. */
  createPairingCode(): PairingCodeInfo;
  listDevices(): PairedDevice[];
  approve(requestId: string): LanStatus;
  deny(requestId: string): LanStatus;
  /** Removes the device now and aborts anything it has in flight. */
  revoke(deviceId: string): LanStatus;
  pair(pairingString: string, deviceName: string): Promise<LanClientStatus>;
  /** Live check of the paired computer. */
  clientStatus(): Promise<LanClientStatus>;
  unpair(): LanClientStatus;
  /** The inference client for the paired computer, or null when nothing is paired. */
  client(): InferenceClient | null;
  /** Stops the host server and any waiting requests. Called when the app quits. */
  dispose(): Promise<void>;
}

export type AppStateSnapshot = AppState;
