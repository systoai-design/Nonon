/**
 * NONON shared contracts. Imported by main, preload and renderer.
 * Types only (plus a few constants): no Node or DOM imports here.
 */

// ---------------------------------------------------------------- packs / workspaces

export type PackId = "general" | "business" | "bookkeeping" | "education";

export const PACKS: { id: PackId; label: string; blurb: string }[] = [
  { id: "general", label: "General", blurb: "Write documents, draft replies and tidy folders" },
  { id: "business", label: "Business and office", blurb: "Turn meeting notes into action lists and follow-ups" },
  { id: "bookkeeping", label: "Bookkeeping", blurb: "Compare spreadsheets and spot what does not match" },
  { id: "education", label: "Study and teaching", blurb: "Make study guides and lesson plans" },
];

/** local-only: nothing may leave this computer for AI. cloud-allowed: connected AI may be used for steps the user authorises. */
export type CloudPolicy = "local-only" | "cloud-allowed";

export interface Workspace {
  id: string;
  name: string;
  /** Approved folder on this computer, or null until the user picks one. */
  folder: string | null;
  pack: PackId;
  policy: CloudPolicy;
  /** Explicit, workspace-scoped. Never covers send, delete, commands or provider use. */
  autoApply: boolean;
  createdAt: string;
  /** Which AI new tasks use when the caller names none. Absent means "local". "paired" never falls back to local silently. */
  preferredAi?: "local" | "paired";
}

/** "non" is the only shipped character. The older values stay valid so saved settings still load; main migrates them to "non". */
export type CompanionCharacter = "non" | "pebble" | "moss" | "ember" | "tide";

export interface Settings {
  onboarded: boolean;
  companionName: string;
  character: CompanionCharacter;
  reducedMotion: boolean;
  activeWorkspaceId: string | null;
  /** Selected local model id (see LOCAL_MODELS in main). */
  modelId: string | null;
  /** Opt-in: keep the scheduler alive after the window is closed. */
  backgroundRoutines: boolean;
  /** Seconds of no inference before the local model is unloaded. */
  idleUnloadSeconds: number;
  /** How big everything is drawn: one of 0.8, 0.9, 1, 1.1, 1.25 (see main/view-scale.ts). Default 0.9. */
  uiScale?: number;
  /**
   * An AI file the person already had, used in place (never copied or changed). Only main writes this, after it
   * has checked the file itself: the window cannot set it through settings:update.
   */
  customModel?: CustomModel;
}

export interface CustomModel {
  path: string;
  label: string;
  /** exact: the same file NONON tests with, stored somewhere else. compatible: a different AI NONON has not tested. */
  kind: "exact" | "compatible";
  /** The pinned catalog id when kind is exact. */
  modelId?: string;
  bytes: number;
}

// ---------------------------------------------------------------- where work happens

export type AiLocation = "local" | "paired" | "claude" | "codex" | "antigravity";

/** Shown wherever work happens: "AI: Local / Files: This computer". */
export interface Locations {
  ai: AiLocation;
  files: "this-computer";
}

// ---------------------------------------------------------------- hardware / runtime

export interface HardwareReport {
  platform: "win32" | "darwin" | "linux";
  arch: string;
  cpu: string;
  cores: number;
  ramBytes: number;
  freeRamBytes: number;
  /** Dedicated or unified graphics memory when it can be read, else null. */
  gpuName: string | null;
  gpuMemoryBytes: number | null;
  accel: "metal" | "cuda" | "vulkan" | "cpu";
  diskFreeBytes: number;
  /** Where the runtime and models are stored. */
  modelDir: string;
  supported: boolean;
  unsupportedReason?: string;
}

export interface ModelRecommendation {
  modelId: string;
  label: string;
  mode: "limited" | "recommended" | "roomy";
  downloadBytes: number;
  /** Plain-language reason shown to the user. */
  why: string;
  /** Honest label: these are engineering targets on tested hardware, not validated minimums. */
  caveat: string;
}

export type RuntimePhase =
  | "not-installed"
  | "downloading-runtime"
  | "downloading-model"
  | "verifying"
  | "installing"
  | "ready"
  | "starting"
  | "running"
  | "sleeping"
  | "failed";

export interface RuntimeStatus {
  phase: RuntimePhase;
  modelId: string | null;
  /** 0..1 for the current download step, when known. */
  progress: number | null;
  bytesDone: number | null;
  bytesTotal: number | null;
  detail: string;
  error?: string;
  /** Peak resident memory of llama-server seen since start, bytes. */
  peakRssBytes?: number;
  contextTokens?: number;
  /** Plain name of the AI in use when it is a file the person already had (modelId is then "custom" or the pinned id). */
  modelLabel?: string;
}

/**
 * An AI file found on this computer. The path stays in main: the window only ever sends back `id`.
 * exact = the same file NONON tests with. compatible = looks runnable, not tested with NONON.
 * unknown = a kind NONON cannot vouch for; only returned when asked for.
 */
export interface DiscoveredModel {
  id: string;
  label: string;
  bytes: number;
  sizeGb: number;
  /** Plain place name: "LM Studio", "Ollama", "your Downloads folder". */
  where: string;
  kind: "exact" | "compatible" | "unknown";
  /** Pinned catalog id when kind is exact. */
  modelId?: string;
  fileName: string;
  contextTokens?: number;
}

// ---------------------------------------------------------------- inference

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface InferenceRequest {
  messages: ChatMessage[];
  /** JSON Schema: the server constrains output to it. Used for extraction and routing. */
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Called with each streamed text delta. */
  onToken?: (delta: string) => void;
}

export interface InferenceResult {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  tokensPerSecond?: number;
  location: Locations;
}

/** Every procedure and the chat go through this; local and connected providers both implement it. */
export interface InferenceClient {
  readonly location: Locations;
  chat(req: InferenceRequest): Promise<InferenceResult>;
}

// ---------------------------------------------------------------- files / fingerprints

export interface FileFingerprint {
  path: string;
  size: number;
  mtimeMs: number;
  sha256: string;
}

export interface FileEntry {
  path: string;
  name: string;
  ext: string;
  size: number;
  mtimeMs: number;
  /** True when a procedure can read this format. */
  supported: boolean;
}

// ---------------------------------------------------------------- procedures

export type ProcedureInputKind = "file" | "files" | "text" | "choice" | "number";

export interface ProcedureInput {
  key: string;
  label: string;
  kind: ProcedureInputKind;
  /** Allowed extensions for file inputs, lower case with the dot. */
  accept?: string[];
  options?: { value: string; label: string }[];
  optional?: boolean;
  help?: string;
}

export interface Check {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail?: string;
}

export interface Question {
  id: string;
  prompt: string;
  kind: "choice" | "text" | "confirm";
  options?: { value: string; label: string }[];
  /** A suggested answer the user can accept in one click. */
  suggested?: string;
}

export interface OutputRef {
  /** Absolute path of a file NONON created in the workspace output folder. */
  path: string;
  label: string;
  kind: "xlsx" | "csv" | "md" | "docx" | "txt" | "html" | "json";
}

// ---------------------------------------------------------------- in-app output preview

export interface PreviewSheet {
  name: string;
  /** First row is the header row (cells as display strings). Capped at maxRows data rows and 20 columns. */
  rows: string[][];
  /** Data rows in the sheet, not counting the header row. */
  totalRows: number;
  totalCols: number;
  truncated: boolean;
}

/** What the Results viewer can show for a file NONON made. `unsupported` always carries a plain reason and the file is still openable. */
export type OutputPreview =
  | { kind: "markdown" | "text"; text: string; truncated: boolean; bytes: number }
  | { kind: "table"; sheets: PreviewSheet[] }
  | { kind: "unsupported"; reason: string };

export type ProcedureOutcome =
  | {
      kind: "done";
      /** Plain-language summary for the chat. Model-written parts must come from real inference. */
      summary: string;
      outputs: OutputRef[];
      proposals: ChangeProposalDraft[];
      checks: Check[];
      /** Structured result the review panel can render (procedure-specific, JSON-safe). */
      report?: unknown;
    }
  | { kind: "needs-input"; questions: Question[]; reason: string }
  | { kind: "unsupported"; reason: string; suggestion?: string };

export interface ProcedureRunContext {
  task: Task;
  workspace: Workspace;
  /** Folder under the workspace where NONON writes its own outputs. Always writable. */
  outputDir: string;
  /** Resolved absolute input paths keyed by ProcedureInput.key. */
  files: Record<string, string[]>;
  text: Record<string, string>;
  /** Answers to earlier questions, keyed by Question.id. Persisted preferences are merged in. */
  answers: Record<string, string>;
  ai: InferenceClient;
  signal: AbortSignal;
  /** Persist a step; the UI shows it live and a restart resumes after it. */
  step(label: string, detail?: string): void;
  /** Read a checkpoint saved by an earlier attempt of this task. */
  checkpoint<T>(key: string): T | undefined;
  saveCheckpoint(key: string, value: unknown): void;
  /** Write a file into outputDir and return its OutputRef. Never overwrites: adds a numeric suffix. */
  writeOutput(name: string, data: string | Uint8Array, kind: OutputRef["kind"], label?: string): Promise<OutputRef>;
}

export interface ProcedureDef {
  id: string;
  pack: PackId;
  title: string;
  /** One line shown on the starter card. */
  summary: string;
  /** Exact supported jobs and formats, shown to the user. No fake support. */
  supports: string;
  limits: string[];
  inputs: ProcedureInput[];
  /** Bump when behaviour changes; stored on every task and change. */
  revision: string;
  run(ctx: ProcedureRunContext): Promise<ProcedureOutcome>;
}

/** What the UI needs to render a starter card; no run function. */
export type ProcedureInfo = Omit<ProcedureDef, "run">;

// ---------------------------------------------------------------- tasks

export type TaskState =
  | "inspecting"
  | "clarifying"
  | "running"
  | "validating"
  | "review"
  | "applying"
  | "complete"
  | "interrupted"
  | "waiting"
  | "needs-attention"
  | "rejected"
  | "failed";

export interface TaskStep {
  at: string;
  label: string;
  detail?: string;
}

export interface Task {
  id: string;
  workspaceId: string;
  procedureId: string;
  procedureRevision: string;
  title: string;
  state: TaskState;
  createdAt: string;
  updatedAt: string;
  /** Fingerprints of the inputs when the task started; compared before apply. */
  inputs: Record<string, FileFingerprint[]>;
  text: Record<string, string>;
  answers: Record<string, string>;
  questions: Question[];
  steps: TaskStep[];
  checkpoints: Record<string, unknown>;
  outputs: OutputRef[];
  proposalIds: string[];
  checks: Check[];
  summary?: string;
  report?: unknown;
  locations: Locations;
  /** Set when the task was started by a routine run. */
  routineRunId?: string;
  waitingOn?: string;
  error?: string;
}

// ---------------------------------------------------------------- staged changes

export type ChangeEdit =
  | { op: "create-file"; path: string; text: string }
  | { op: "csv-set-cells"; path: string; cells: { row: number; col: number; value: string }[]; appendColumns?: { header: string; values: string[] }[] }
  | { op: "xlsx-set-cells"; path: string; sheet: string; cells: { address: string; value: string | number | null; formula?: string }[]; appendColumns?: { header: string; values: (string | number | null)[] }[] }
  | { op: "rename-move"; from: string; to: string };

export interface ChangePreview {
  title: string;
  /** Before/after as small tables or text, rendered by the review panel. */
  before?: string[][] | string;
  after?: string[][] | string;
  highlights?: { row: number; col: number }[];
}

/** What a procedure hands over; the changes service stamps id, fingerprints and status. */
export interface ChangeProposalDraft {
  /** Original file the change targets (absolute). */
  target: string;
  edits: ChangeEdit[];
  reason: string;
  preview: ChangePreview;
  checks: Check[];
}

export type ChangeStatus = "staged" | "applying" | "applied" | "rejected" | "stale" | "partial" | "recovered" | "failed";

/** Per-file bookkeeping the changes service keeps so apply, partial failure and recovery stay exact. */
export interface ChangeFileRecord {
  path: string;
  kind: "modified" | "created" | "moved";
  /** Fingerprint when staged; null when the file did not exist yet. */
  base: FileFingerprint | null;
  /** Verified copy of the file as it was before apply. */
  recoveryPath?: string;
  /** Fingerprint after NONON's last write. For "moved" it is the file at `movedTo`. Absent until something was written. */
  applied?: FileFingerprint;
  movedTo?: string;
}

export interface ChangeProposal extends ChangeProposalDraft {
  /** Every file this change touches (additive; the service fills it at stage time). */
  files?: ChangeFileRecord[];
  id: string;
  taskId: string;
  workspaceId: string;
  procedureRevision: string;
  /** Fingerprint of the target when the proposal was made. Apply is refused if it differs. */
  base: FileFingerprint | null;
  createdAt: string;
  status: ChangeStatus;
  /** Recovery copy made before apply. */
  recoveryPath?: string;
  /** Fingerprint of the target right after apply; recovery refuses to overwrite newer edits. */
  appliedFingerprint?: FileFingerprint;
  appliedAt?: string;
  error?: string;
  /** Per-edit outcome after apply, so partial failure is reported exactly. */
  editResults?: { index: number; ok: boolean; error?: string }[];
}

// ---------------------------------------------------------------- routines (scheduler)

export type MissedRunPolicy = "catch-up-once" | "skip";

export interface Routine {
  id: string;
  workspaceId: string;
  title: string;
  /** Plain-language description shown on the confirmation card. */
  description: string;
  procedureId: string;
  /** Inputs: fixed files or "newest matching file in folder". */
  inputScope: {
    folder: string;
    /** Glob-like extension filter per procedure input key. */
    pick: Record<string, { newest: number; extensions: string[]; nameContains?: string; /** Skip this many of the newest matches first (0 = start at the newest). Lets "File A" and "File B" take the second-newest and newest file. */ skip?: number }>;
  };
  params: Record<string, string>;
  schedule: {
    /** Cron expression, evaluated in `timezone`. */
    cron: string;
    timezone: string;
    /** "Every weekday at 8:00 AM" */
    humanText: string;
  };
  location: Locations;
  /** Only ever a subset of: "read-files", "write-outputs", "read-mail". Never send/delete. */
  allowedActions: ("read-files" | "write-outputs" | "read-mail")[];
  missedRun: MissedRunPolicy;
  overlap: "skip";
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastRunStatus?: RoutineRunStatus;
  nextDueAt?: string;
}

export type RoutineRunStatus =
  | "running"
  | "succeeded"
  | "needs-review"
  | "failed"
  | "waiting-for-input"
  | "skipped-overlap"
  | "skipped-missed"
  | "interrupted";

export interface RoutineRun {
  id: string;
  routineId: string;
  /** "due" fired on schedule, "catch-up" after a missed window, "manual" run now. */
  trigger: "due" | "catch-up" | "manual";
  scheduledFor: string;
  startedAt: string;
  finishedAt?: string;
  status: RoutineRunStatus;
  taskId?: string;
  detail?: string;
  /** Inputs fingerprinted at start so a changed input is visible. */
  inputs?: FileFingerprint[];
}

// ---------------------------------------------------------------- connected AI

export type ProviderId = "claude" | "codex" | "antigravity";

export type ProviderState =
  | "not-installed"
  | "not-connected"
  | "needs-sign-in"
  | "ready"
  | "unavailable"
  | "incompatible"
  | "failed";

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  state: ProviderState;
  version?: string;
  /** What this connection will receive and what it may cost, shown before activation. */
  disclosure: string;
  detail?: string;
  /** Honest note on what was actually verified (a probe is not a quality test). */
  verified: "probe-only" | "turn-tested" | "untested";
}

export type RoleName = "design" | "implement" | "review";

export interface ProjectRoles {
  workspaceId: string;
  roles: Partial<Record<RoleName, ProviderId | "local">>;
}

// ---------------------------------------------------------------- gmail

export type GmailState = "not-configured" | "disconnected" | "connected" | "error";

export interface GmailStatus {
  state: GmailState;
  account?: string;
  /** Set when no Google client config was found; tells the user exactly where to put one. */
  configHint?: string;
  lastSyncAt?: string;
  cachedMessages: number;
  scopes: string[];
  /** Plain-language note: what this connection can and cannot do, or what went wrong last. */
  detail?: string;
}

export interface BriefItem {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  receivedAt: string;
  /** Link that opens the message in Gmail. */
  link: string;
  priority: "needs-attention" | "fyi" | "low";
  why: string;
  deadline?: string;
  draftReply?: string;
}

export interface EmailBrief {
  generatedAt: string;
  /** "fresh" = fetched from Google during this run; "cached" = last sync time shown, not a current inbox check. */
  freshness: "fresh" | "cached";
  lastSyncAt: string | null;
  items: BriefItem[];
  summary: string;
  /** Honest caveats for this run: why it is cached, messages that could not be read, and so on. */
  notes?: string[];
}

// ---------------------------------------------------------------- chat

export interface ChatEntry {
  id: string;
  workspaceId: string;
  at: string;
  role: "user" | "companion" | "system";
  text: string;
  /** Linked task, so a card can render live state inside the conversation. */
  taskId?: string;
  attachments?: { path: string; name: string }[];
  /** A routine proposal (not yet saved) the UI renders as a confirm / edit / cancel card. */
  routine?: Routine;
}

// ---------------------------------------------------------------- shared compute (LAN pairing)

/** A computer that was allowed to use this computer's AI. The token is never exposed here. */
export interface PairedDevice {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt?: string;
}

/** A computer asking to pair. The user on the host answers it with approve or deny. */
export interface PairRequest {
  id: string;
  deviceName: string;
  /** Network address the request came from. */
  address: string;
  at: string;
  /** Short code that both computers show, so the user can see the request belongs to the code they made. */
  shortCode: string;
}

export interface PairingCodeInfo {
  /** The full string to copy to the other computer. Single use. */
  pairing: string;
  /** Six digits grouped for reading aloud: "482 913". */
  shortCode: string;
  expiresAt: string;
}

export interface LanHostState {
  running: boolean;
  port: number;
  /** The address other computers are told to use, or null when this computer has no network address. */
  address: string | null;
  devices: PairedDevice[];
  pending: PairRequest[];
  code: PairingCodeInfo | null;
  /** True while a paired computer's request is being answered. */
  busy: boolean;
  error?: string;
}

export type LanClientState = "not-paired" | "connected" | "unreachable" | "unpaired";

export interface LanClientStatus {
  state: LanClientState;
  hostName?: string;
  address?: string;
  deviceName?: string;
  pairedAt?: string;
  checkedAt?: string;
  /** Plain-language note about the last check. */
  detail?: string;
}

export interface LanStatus {
  host: LanHostState;
  client: LanClientStatus;
}

// ---------------------------------------------------------------- app state snapshot

export interface AppState {
  settings: Settings;
  workspaces: Workspace[];
  runtime: RuntimeStatus;
  hardware: HardwareReport | null;
  providers: ProviderStatus[];
  gmail: GmailStatus;
  version: string;
  platform: string;
}
