import type {
  AppState,
  ChangeProposal,
  ChatEntry,
  DiscoveredModel,
  EmailBrief,
  FileEntry,
  GmailStatus,
  HardwareReport,
  LanClientStatus,
  LanStatus,
  ModelRecommendation,
  OutputPreview,
  PackId,
  PairRequest,
  PairingCodeInfo,
  ProcedureInfo,
  ProjectRoles,
  ProviderId,
  ProviderStatus,
  Routine,
  RoutineRun,
  RuntimeStatus,
  Settings,
  Task,
  Workspace,
  CloudPolicy,
  RoleName,
} from "./contracts";

/**
 * Request/response channels. Renderer calls `window.nonon.call(channel, arg)`;
 * main registers one handler per key in `src/main/ipc.ts`.
 * A handler may throw; the renderer sees a rejected promise with a plain message.
 */
export interface Channels {
  // app
  "app:state": { arg: void; res: AppState };
  "settings:update": { arg: Partial<Settings>; res: Settings };
  "shell:reveal": { arg: { path: string }; res: void };
  "shell:open": { arg: { path: string }; res: void };
  /** Reads a file inside an approved workspace folder so the Results viewer can show it in the app. Rejects anything else. */
  "output:preview": { arg: { path: string; maxRows?: number }; res: OutputPreview };

  // workspaces and files
  "workspace:create": { arg: { name: string; folder: string | null; pack: PackId; policy?: CloudPolicy }; res: Workspace };
  "workspace:update": { arg: { id: string; patch: Partial<Pick<Workspace, "name" | "folder" | "pack" | "policy" | "autoApply" | "preferredAi">> }; res: Workspace };
  "workspace:remove": { arg: { id: string }; res: void };
  "workspace:pick-folder": { arg: void; res: string | null };
  "workspace:files": { arg: { id: string }; res: FileEntry[] };
  "workspace:pick-files": { arg: { accept?: string[] }; res: string[] };
  /** Copies the bundled sample files for a pack into the workspace folder (under Samples/). */
  "workspace:add-samples": { arg: { id: string }; res: FileEntry[] };

  // hardware and local runtime
  "hardware:assess": { arg: void; res: { report: HardwareReport; recommendation: ModelRecommendation | null; alternatives: ModelRecommendation[] } };
  "runtime:status": { arg: void; res: RuntimeStatus };
  "runtime:install": { arg: { modelId: string }; res: void };
  "runtime:cancel": { arg: void; res: void };
  "runtime:start": { arg: void; res: void };
  "runtime:stop": { arg: void; res: void };
  /** Looks (read-only, a few seconds) for AI files already on this computer. */
  "runtime:discover": { arg: void; res: DiscoveredModel[] };
  /** Uses one of the files the last runtime:discover returned, where it is. Anything else is refused. */
  "runtime:use-existing": { arg: { id: string }; res: RuntimeStatus };
  /** Opens the system file dialog in main, checks the chosen .gguf, and uses it where it is. Cancelling returns the current status. */
  "runtime:use-file": { arg: void; res: RuntimeStatus };
  /** Stops using a file the person had. The file is not touched. */
  "runtime:forget-existing": { arg: void; res: RuntimeStatus };

  // procedures and tasks
  "procedure:list": { arg: { pack?: PackId }; res: ProcedureInfo[] };
  "task:list": { arg: { workspaceId: string }; res: Task[] };
  "task:get": { arg: { id: string }; res: Task | null };
  "task:start": {
    arg: { workspaceId: string; procedureId: string; files?: Record<string, string[]>; text?: Record<string, string>; answers?: Record<string, string> };
    res: Task;
  };
  "task:answer": { arg: { id: string; answers: Record<string, string>; remember?: boolean }; res: Task };
  "task:stop": { arg: { id: string }; res: Task };
  "task:resume": { arg: { id: string }; res: Task };

  // chat
  "chat:history": { arg: { workspaceId: string }; res: ChatEntry[] };
  /** Routes free text to a procedure (or a plain local answer) and returns the entries added. */
  "chat:send": { arg: { workspaceId: string; text: string; files?: string[] }; res: ChatEntry[] };
  /** Stops the reply being written for this project (routing or streaming). The partial reply is kept as the final entry. */
  "chat:stop": { arg: { workspaceId: string }; res: void };

  // staged changes
  "change:list": { arg: { workspaceId?: string; taskId?: string }; res: ChangeProposal[] };
  "change:apply": { arg: { id: string }; res: ChangeProposal };
  "change:reject": { arg: { id: string }; res: ChangeProposal };
  "change:recover": { arg: { id: string }; res: ChangeProposal };

  // routines
  "routine:list": { arg: { workspaceId?: string }; res: Routine[] };
  /** Plain-language request in, a routine card (not yet saved) out. */
  "routine:propose": { arg: { workspaceId: string; text: string }; res: Routine };
  "routine:save": { arg: { routine: Routine }; res: Routine };
  "routine:set-enabled": { arg: { id: string; enabled: boolean }; res: Routine };
  "routine:run-now": { arg: { id: string }; res: RoutineRun };
  "routine:remove": { arg: { id: string }; res: void };
  "routine:runs": { arg: { routineId?: string; limit?: number }; res: RoutineRun[] };

  // gmail
  "gmail:status": { arg: void; res: GmailStatus };
  "gmail:connect": { arg: void; res: GmailStatus };
  "gmail:disconnect": { arg: void; res: GmailStatus };
  "gmail:brief": { arg: { workspaceId: string; forceOffline?: boolean }; res: EmailBrief };

  // connected AI
  "provider:list": { arg: void; res: ProviderStatus[] };
  "provider:probe": { arg: { id: ProviderId }; res: ProviderStatus };
  "provider:sign-in": { arg: { id: ProviderId }; res: ProviderStatus };
  "roles:get": { arg: { workspaceId: string }; res: ProjectRoles };
  "roles:set": { arg: { workspaceId: string; role: RoleName; provider: ProviderId | "local" | null }; res: ProjectRoles };

  // shared compute: use another owned computer's local AI on the same network (optional, off by default)
  "lan:status": { arg: void; res: LanStatus };
  "lan:host-start": { arg: void; res: LanStatus };
  "lan:host-stop": { arg: void; res: LanStatus };
  "lan:pairing-code": { arg: void; res: PairingCodeInfo };
  "lan:approve": { arg: { requestId: string }; res: LanStatus };
  "lan:deny": { arg: { requestId: string }; res: LanStatus };
  "lan:revoke": { arg: { deviceId: string }; res: LanStatus };
  "lan:pair": { arg: { pairing: string; deviceName: string }; res: LanClientStatus };
  /** Live check of the paired computer (reachable, still trusted). */
  "lan:client-status": { arg: void; res: LanClientStatus };
  "lan:unpair": { arg: void; res: LanClientStatus };

  // diagnostics
  "diagnostics:snapshot": { arg: void; res: { runtime: RuntimeStatus; hardware: HardwareReport | null; log: string[] } };
}

export type ChannelName = keyof Channels;

export interface ChatDelta {
  workspaceId: string;
  entryId: string;
  text: string;
}

/** Push events main sends to the renderer. */
export interface Events {
  "runtime:status": RuntimeStatus;
  "task:updated": Task;
  "change:updated": ChangeProposal;
  "chat:entry": ChatEntry;
  /** Incremental text of a companion reply being written. `text` is the new piece only; the final `chat:entry` with the same id carries the whole reply and ends the stream. */
  "chat:delta": ChatDelta;
  "routine:updated": Routine;
  "routine:run": RoutineRun;
  "providers:updated": ProviderStatus[];
  "gmail:updated": GmailStatus;
  "settings:updated": Settings;
  "lan:updated": LanStatus;
  "lan:pair-request": PairRequest;
}

export type EventName = keyof Events;

export interface NononBridge {
  call<K extends ChannelName>(channel: K, arg: Channels[K]["arg"]): Promise<Channels[K]["res"]>;
  on<K extends EventName>(event: K, cb: (payload: Events[K]) => void): () => void;
  /** Absolute path of a File dropped on the window (Electron removed File.path). */
  pathForFile(file: File): string;
  platform: string;
}
