/** Dev-only mock of window.nonon with fixtures for every state these views render. Never imported by the app. */
import type {
  AppState,
  ChangeProposal,
  EmailBrief,
  GmailStatus,
  HardwareReport,
  ProjectRoles,
  ProviderStatus,
  Routine,
  RoutineRun,
  RuntimeStatus,
  Settings,
  Task,
  Workspace,
} from "../../../../shared/contracts";
import type { Channels, EventName, Events, NononBridge } from "../../../../shared/ipc";

const now = Date.now();
const iso = (offsetMin: number) => new Date(now + offsetMin * 60_000).toISOString();

let settings: Settings = {
  onboarded: true,
  companionName: "Non",
  character: "non",
  reducedMotion: false,
  activeWorkspaceId: "w1",
  modelId: "qwen3.5-4b-q4_k_m",
  backgroundRoutines: false,
  idleUnloadSeconds: 600,
};

let workspaces: Workspace[] = [
  { id: "w1", name: "Business", folder: "C:\\Users\\Demo\\Documents\\Business", pack: "bookkeeping", policy: "local-only", autoApply: false, createdAt: iso(-9000) },
  { id: "w2", name: "School", folder: "C:\\Users\\Demo\\Documents\\School", pack: "education", policy: "cloud-allowed", autoApply: true, createdAt: iso(-8000) },
  { id: "w3", name: "Personal", folder: null, pack: "general", policy: "local-only", autoApply: false, createdAt: iso(-7000) },
];

let runtime: RuntimeStatus = { phase: "running", modelId: "qwen3.5-4b-q4_k_m", progress: null, bytesDone: null, bytesTotal: null, detail: "Qwen3.5 4B is ready.", peakRssBytes: 3_400_000_000, contextTokens: 8192 };

const hardware: HardwareReport = {
  platform: "win32",
  arch: "x64",
  cpu: "AMD Ryzen 7 7700",
  cores: 8,
  ramBytes: 32 * 1024 ** 3,
  freeRamBytes: 18 * 1024 ** 3,
  gpuName: "NVIDIA GeForce RTX 5070",
  gpuMemoryBytes: 12 * 1024 ** 3,
  accel: "cuda",
  diskFreeBytes: 410 * 1024 ** 3,
  modelDir: "E:\\nonon-dev\\models",
  supported: true,
};

const xlsx = "C:\\Users\\Demo\\Documents\\Business\\weekly-expenses.xlsx";
const csv = "C:\\Users\\Demo\\Documents\\Business\\bank-export.csv";
const docx = "C:\\Users\\Demo\\Documents\\Business\\meeting-notes.docx";

const sheet = (total: string) => [
  ["", "Item", "", "Amount"],
  ["10", "Supplies", "", "4,000"],
  ["11", "Travel", "", "6,500"],
  ["12", "Printing", "", "500"],
  ["13", "Total", "", total],
];

const base = { workspaceId: "w1", procedureRevision: "1", base: null, createdAt: iso(-12) } as const;

let changes: ChangeProposal[] = [
  {
    ...base,
    id: "c1",
    taskId: "t1",
    target: xlsx,
    edits: [{ op: "xlsx-set-cells", path: xlsx, sheet: "Expenses", cells: [{ address: "D13", value: 11000, formula: "SUM(D10:D12)" }] }],
    reason: "The total formula stops at row 11, so the 500 printing expense in row 12 is left out. This extends it to include row 12.",
    preview: {
      title: "Expenses \u00b7 Cell D13",
      before: sheet("10,500"),
      after: sheet("11,000"),
      highlights: [{ row: 3, col: 3 }, { row: 4, col: 3 }],
    },
    checks: [
      { id: "k1", label: "Only one cell changes", status: "pass" },
      { id: "k2", label: "Formula refers to cells that exist", status: "pass" },
      { id: "k3", label: "File matches what NONON read", status: "pass", detail: "Nothing in the workbook has changed since then." },
    ],
    status: "staged",
  },
  {
    ...base,
    id: "c2",
    taskId: "t1",
    target: csv,
    edits: [{ op: "csv-set-cells", path: csv, cells: [{ row: 4, col: 2, value: "-12.00" }], appendColumns: [{ header: "Checked", values: ["yes"] }] }],
    reason: "Adds a Checked column and flips the sign of one refund line.",
    preview: { title: "bank-export.csv \u00b7 2 edits", before: "Refund, 12.00", after: "Refund, -12.00\nChecked column added" },
    checks: [
      { id: "k4", label: "Amount sign matches the other refund rows", status: "warn", detail: "Two other refunds in this file use a positive sign." },
      { id: "k5", label: "Column count matches the header", status: "fail", detail: "Row 9 has 5 columns but the header has 4." },
    ],
    status: "staged",
  },
  { ...base, id: "c3", taskId: "t2", target: xlsx, edits: [{ op: "xlsx-set-cells", path: xlsx, sheet: "Expenses", cells: [{ address: "D13", value: 11000 }] }], reason: "Include row 12 in the total.", preview: { title: "Expenses \u00b7 Cell D13", before: sheet("10,500"), after: sheet("11,000"), highlights: [{ row: 4, col: 3 }] }, checks: [{ id: "a", label: "Only one cell changes", status: "pass" }], status: "applied", appliedAt: iso(-3), recoveryPath: "C:\\Users\\Demo\\.nonon\\recovery\\c3.xlsx" },
  { ...base, id: "c4", taskId: "t2", target: docx, edits: [{ op: "create-file", path: docx, text: "x" }], reason: "Write up the follow-ups from Tuesday's meeting.", preview: { title: "meeting-notes.docx", after: "Follow-ups\n- Maria sends the revised quote by Friday\n- Jon books the room" }, checks: [], status: "stale" },
  {
    ...base,
    id: "c5",
    taskId: "t2",
    target: xlsx,
    edits: [
      { op: "xlsx-set-cells", path: xlsx, sheet: "Expenses", cells: [{ address: "D13", value: 11000 }] },
      { op: "xlsx-set-cells", path: xlsx, sheet: "Summary", cells: [{ address: "B2", value: 11000 }, { address: "B3", value: 0 }] },
    ],
    reason: "Fix the total and mirror it on the Summary sheet.",
    preview: { title: "2 sheets", after: "Expenses!D13 and Summary!B2:B3" },
    checks: [],
    status: "partial",
    recoveryPath: "C:\\Users\\Demo\\.nonon\\recovery\\c5.xlsx",
    editResults: [{ index: 0, ok: true }, { index: 1, ok: false, error: "Sheet is protected" }],
  },
  { ...base, id: "c6", taskId: "t2", target: csv, edits: [{ op: "rename-move", from: csv, to: csv + ".old" }], reason: "Archive the old export.", preview: { title: "bank-export.csv", after: "bank-export.csv.old" }, checks: [], status: "failed", error: "The file is open in another program." },
  { ...base, id: "c7", taskId: "t2", target: xlsx, edits: [], reason: "Earlier fix, since undone.", preview: { title: "Expenses", after: "x" }, checks: [], status: "recovered" },
  { ...base, id: "c8", taskId: "t2", target: docx, edits: [], reason: "A longer summary you did not want.", preview: { title: "meeting-notes.docx", after: "x" }, checks: [], status: "rejected" },
];

const tasks: Record<string, Task> = {
  t1: {
    id: "t1",
    workspaceId: "w1",
    procedureId: "spreadsheet-compare",
    procedureRevision: "1",
    title: "Compare bank export with ledger",
    state: "review",
    createdAt: iso(-20),
    updatedAt: iso(-12),
    inputs: {},
    text: {},
    answers: {},
    questions: [],
    steps: [],
    checkpoints: {},
    outputs: [
      { path: "C:\\Users\\Demo\\Documents\\Business\\NONON\\comparison-report.xlsx", label: "comparison-report.xlsx", kind: "xlsx" },
      { path: "C:\\Users\\Demo\\Documents\\Business\\NONON\\summary.md", label: "summary.md", kind: "md" },
    ],
    proposalIds: ["c1", "c2"],
    checks: [{ id: "t", label: "Every record is accounted for", status: "pass", detail: "120 of 120 rows were placed in exactly one group." }],
    summary: "I compared 120 rows. 96 matched. I put the rest in the report so you can look at them.",
    report: {
      currency: "PHP",
      counts: { matched: 96, onlyInA: 9, onlyInB: 6, duplicates: 4, ambiguous: 5 },
      totalsCents: { matched: 48_250_000, onlyInA: 1_240_050, onlyInB: 880_000, duplicates: 120_000, ambiguous: 310_025, totalA: 50_000_000, totalB: 49_460_025, difference: 539_975 },
    },
    locations: { ai: "local", files: "this-computer" },
  },
  t2: {
    id: "t2",
    workspaceId: "w1",
    procedureId: "general",
    procedureRevision: "1",
    title: "Tidy up the expenses",
    state: "complete",
    createdAt: iso(-60),
    updatedAt: iso(-3),
    inputs: {},
    text: {},
    answers: {},
    questions: [],
    steps: [],
    checkpoints: {},
    outputs: [],
    proposalIds: [],
    checks: [],
    locations: { ai: "local", files: "this-computer" },
  },
};

let routines: Routine[] = [
  {
    id: "r1",
    workspaceId: "w1",
    title: "Weekday bank comparison",
    description: "Compare the newest bank export with the ledger and save a report.",
    procedureId: "spreadsheet-compare",
    inputScope: { folder: "C:\\Users\\Demo\\Documents\\Business", pick: { a: { newest: 1, extensions: [".csv"] }, b: { newest: 1, extensions: [".xlsx"], nameContains: "ledger" } } },
    params: {},
    schedule: { cron: "0 8 * * 1-5", timezone: "Asia/Manila", humanText: "Every weekday at 8:00 AM" },
    location: { ai: "local", files: "this-computer" },
    allowedActions: ["read-files", "write-outputs"],
    missedRun: "catch-up-once",
    overlap: "skip",
    enabled: true,
    createdAt: iso(-5000),
    lastRunAt: iso(-600),
    lastRunStatus: "needs-review",
    nextDueAt: iso(900),
  },
  {
    id: "r2",
    workspaceId: "w1",
    title: "Friday email brief",
    description: "Summarise this week's mail and list deadlines.",
    procedureId: "gmail-brief",
    inputScope: { folder: "C:\\Users\\Demo\\Documents\\Business", pick: {} },
    params: {},
    schedule: { cron: "30 16 * * 5", timezone: "Asia/Manila", humanText: "Every Friday at 4:30 PM" },
    location: { ai: "claude", files: "this-computer" },
    allowedActions: ["read-files", "read-mail", "write-outputs"],
    missedRun: "skip",
    overlap: "skip",
    enabled: false,
    createdAt: iso(-4000),
    lastRunAt: iso(-7000),
    lastRunStatus: "failed",
  },
];

let runs: RoutineRun[] = [
  { id: "u1", routineId: "r1", trigger: "due", scheduledFor: iso(-600), startedAt: iso(-600), finishedAt: iso(-598), status: "needs-review", taskId: "t1" },
  { id: "u2", routineId: "r1", trigger: "catch-up", scheduledFor: iso(-2040), startedAt: iso(-1900), finishedAt: iso(-1898), status: "succeeded" },
  { id: "u3", routineId: "r1", trigger: "due", scheduledFor: iso(-3480), startedAt: iso(-3480), status: "skipped-overlap", detail: "The earlier run was still going." },
  { id: "u4", routineId: "r1", trigger: "due", scheduledFor: iso(-4920), startedAt: iso(-4900), status: "skipped-missed" },
  { id: "u5", routineId: "r2", trigger: "manual", scheduledFor: iso(-7000), startedAt: iso(-7000), finishedAt: iso(-6999), status: "failed", detail: "Gmail is not connected." },
  { id: "u6", routineId: "r1", trigger: "due", scheduledFor: iso(-6360), startedAt: iso(-6360), status: "interrupted" },
  { id: "u7", routineId: "r1", trigger: "due", scheduledFor: iso(-7800), startedAt: iso(-7800), status: "waiting-for-input" },
];

let gmail: GmailStatus = { state: "not-configured", configHint: "Place your Google client file at:\nC:\\Users\\Demo\\AppData\\Roaming\\NONON\\google-client.json\nThen choose Connect Gmail. NONON only asks for read-only access.", cachedMessages: 0, scopes: [] };

if (new URLSearchParams(location.search).get("gmail") === "connected") {
  gmail = { state: "connected", account: "demo@gmail.com", lastSyncAt: iso(-185), cachedMessages: 412, scopes: ["https://www.googleapis.com/auth/gmail.readonly"] };
}

let providers: ProviderStatus[] = [
  { id: "claude", label: "Claude", state: "ready", version: "2.1.4", disclosure: "When you use Claude, the parts of your files needed for that step are sent to Anthropic. Your Claude plan or API usage may be charged.", verified: "turn-tested" },
  { id: "codex", label: "Codex", state: "needs-sign-in", version: "0.9.0", disclosure: "When you use Codex, the parts of your files needed for that step are sent to OpenAI. Your plan usage may be charged.", verified: "probe-only" },
  { id: "antigravity", label: "Antigravity", state: "not-installed", disclosure: "When you use Antigravity, the parts of your files needed for that step are sent to Google.", verified: "untested" },
];

let roles: ProjectRoles = { workspaceId: "w2", roles: { design: "claude", implement: "local" } };

const brief = (fresh: boolean): EmailBrief => ({
  generatedAt: iso(0),
  freshness: fresh ? "fresh" : "cached",
  lastSyncAt: iso(-185),
  summary: "Two messages need you this week. One is about an invoice that is due Friday.",
  items: [
    { messageId: "m1", threadId: "t1", from: "Maria Santos <maria@supplier.example>", subject: "Invoice 2209 is due Friday", receivedAt: iso(-300), link: "https://mail.google.com/mail/u/0/#inbox/abc", priority: "needs-attention", why: "Asks you to confirm payment before Friday.", deadline: "Friday, 17:00", draftReply: "Hi Maria,\n\nThanks for the reminder. I will confirm payment by Thursday.\n\nBest," },
    { messageId: "m2", threadId: "t2", from: "School office <office@school.example>", subject: "Parent meeting moved", receivedAt: iso(-900), link: "https://mail.google.com/mail/u/0/#inbox/def", priority: "needs-attention", why: "The meeting moved to Wednesday at 3 PM." },
    { messageId: "m3", threadId: "t3", from: "Newsletter <news@store.example>", subject: "Weekend sale", receivedAt: iso(-1500), link: "http://insecure.example/x", priority: "low", why: "A promotional email." },
    { messageId: "m4", threadId: "t4", from: "Jon <jon@team.example>", subject: "Notes from Tuesday", receivedAt: iso(-1200), link: "https://mail.google.com/mail/u/0/#inbox/ghi", priority: "fyi", why: "Shares the meeting notes. No action needed." },
  ],
});

const listeners = new Map<EventName, Set<(p: never) => void>>();
function emit<K extends EventName>(event: K, payload: Events[K]) {
  listeners.get(event)?.forEach((cb) => (cb as (p: Events[K]) => void)(payload));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => structuredClone(v);

function setChange(id: string, patch: Partial<ChangeProposal>): ChangeProposal {
  const i = changes.findIndex((c) => c.id === id);
  const cur = changes[i];
  if (!cur) throw new Error("That change no longer exists.");
  const next = { ...cur, ...patch };
  changes[i] = next;
  emit("change:updated", clone(next));
  return clone(next);
}

type Handler = { [K in keyof Channels]: (arg: Channels[K]["arg"]) => Promise<Channels[K]["res"]> | Channels[K]["res"] };

const handlers: Partial<Handler> = {
  "app:state": () => ({ settings, workspaces, runtime, hardware, providers, gmail, version: "0.1.0", platform: "win32" }) as AppState,
  "settings:update": (patch) => {
    settings = { ...settings, ...patch };
    emit("settings:updated", settings);
    return settings;
  },
  "shell:reveal": async () => {
    await wait(100);
  },
  "shell:open": async () => {
    await wait(100);
  },
  "workspace:update": ({ id, patch }) => {
    workspaces = workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w));
    return workspaces.find((w) => w.id === id) as Workspace;
  },
  "workspace:remove": ({ id }) => {
    workspaces = workspaces.filter((w) => w.id !== id);
  },
  "workspace:pick-folder": () => "D:\\Pictures\\Picked folder",
  "runtime:status": () => runtime,
  "runtime:start": async () => {
    runtime = { ...runtime, phase: "starting", detail: "Starting..." };
    emit("runtime:status", runtime);
    await wait(800);
    runtime = { ...runtime, phase: "running", detail: "Qwen3.5 4B is ready." };
    emit("runtime:status", runtime);
  },
  "runtime:stop": async () => {
    runtime = { ...runtime, phase: "ready", detail: "Stopped. It starts again when you need it." };
    emit("runtime:status", runtime);
  },
  "hardware:assess": () => ({ report: hardware, recommendation: null, alternatives: [] }),
  "diagnostics:snapshot": () => ({ runtime, hardware, log: ["[10:02:11] runtime started", "[10:02:14] model loaded in 2.9s", "[10:05:40] task t1 finished"] }),
  "task:get": ({ id }) => tasks[id] ?? null,
  "change:list": ({ workspaceId, taskId }) => clone(changes.filter((c) => (!workspaceId || c.workspaceId === workspaceId) && (!taskId || c.taskId === taskId))),
  "change:apply": async ({ id }) => {
    setChange(id, { status: "applying" });
    await wait(700);
    return setChange(id, { status: "applied", appliedAt: new Date().toISOString(), recoveryPath: "C:\\recovery\\" + id });
  },
  "change:reject": ({ id }) => setChange(id, { status: "rejected" }),
  "change:recover": async ({ id }) => {
    await wait(400);
    return setChange(id, { status: "recovered" });
  },
  "chat:send": async () => {
    await wait(300);
    return [];
  },
  "routine:list": () => clone(routines),
  "routine:runs": ({ routineId }) => clone(runs.filter((r) => !routineId || r.routineId === routineId)),
  "routine:set-enabled": ({ id, enabled }) => {
    routines = routines.map((r) => (r.id === id ? { ...r, enabled } : r));
    const r = routines.find((x) => x.id === id) as Routine;
    emit("routine:updated", clone(r));
    return clone(r);
  },
  "routine:run-now": async ({ id }) => {
    const run: RoutineRun = { id: "u" + Date.now(), routineId: id, trigger: "manual", scheduledFor: iso(0), startedAt: iso(0), status: "running" };
    runs = [run, ...runs];
    emit("routine:run", run);
    setTimeout(() => {
      runs = runs.map((r) => (r.id === run.id ? { ...r, status: "needs-review", finishedAt: iso(0) } : r));
      emit("routine:run", runs.find((r) => r.id === run.id) as RoutineRun);
    }, 1500);
    return run;
  },
  "routine:remove": ({ id }) => {
    routines = routines.filter((r) => r.id !== id);
  },
  "routine:propose": async ({ workspaceId, text }) => {
    await wait(600);
    const w = workspaces.find((x) => x.id === workspaceId);
    return {
      id: "new-" + Date.now(),
      workspaceId,
      title: text.length > 40 ? "Weekday report check" : text,
      description: text,
      procedureId: "spreadsheet-compare",
      inputScope: { folder: w?.folder ?? "C:\\Users\\Demo\\Documents", pick: { a: { newest: 1, extensions: [".csv"] } } },
      params: {},
      schedule: { cron: "0 8 * * 1-5", timezone: "Asia/Manila", humanText: "Every weekday at 8:00 AM" },
      location: { ai: "local", files: "this-computer" },
      allowedActions: ["read-files", "write-outputs"],
      missedRun: "catch-up-once",
      overlap: "skip",
      enabled: true,
      createdAt: iso(0),
    } satisfies Routine;
  },
  "routine:save": ({ routine }) => {
    routines = [...routines, routine];
    return routine;
  },
  "procedure:list": () => [
    { id: "spreadsheet-compare", pack: "bookkeeping", title: "Compare two spreadsheets", summary: "", supports: "", limits: [], inputs: [], revision: "1" },
    { id: "gmail-brief", pack: "general", title: "Email brief", summary: "", supports: "", limits: [], inputs: [], revision: "1" },
  ],
  "gmail:status": () => gmail,
  "gmail:connect": async () => {
    await wait(500);
    gmail = { state: "connected", account: "demo@gmail.com", lastSyncAt: iso(-185), cachedMessages: 412, scopes: ["https://www.googleapis.com/auth/gmail.readonly"] };
    emit("gmail:updated", gmail);
    return gmail;
  },
  "gmail:disconnect": () => {
    gmail = { state: "disconnected", cachedMessages: 0, scopes: [] };
    emit("gmail:updated", gmail);
    return gmail;
  },
  "gmail:brief": async ({ forceOffline }) => {
    await wait(900);
    return brief(!forceOffline && gmail.state === "connected");
  },
  "provider:list": () => providers,
  "provider:probe": ({ id }) => providers.find((p) => p.id === id) as ProviderStatus,
  "provider:sign-in": async ({ id }) => {
    await wait(700);
    providers = providers.map((p) => (p.id === id ? { ...p, state: "ready", verified: "probe-only" } : p));
    emit("providers:updated", providers);
    return providers.find((p) => p.id === id) as ProviderStatus;
  },
  "roles:get": ({ workspaceId }) => ({ ...roles, workspaceId }),
  "roles:set": ({ workspaceId, role, provider }) => {
    const next = { ...roles.roles };
    if (provider === null) delete next[role];
    else next[role] = provider;
    roles = { workspaceId, roles: next };
    return roles;
  },
};

export function installMock(): void {
  const bridge: NononBridge = {
    async call(channel, arg) {
      await wait(60);
      const h = handlers[channel] as ((a: unknown) => unknown) | undefined;
      if (!h) throw new Error(`Mock: no handler for ${channel}`);
      return (await h(arg)) as never;
    },
    on(event, cb) {
      const set = listeners.get(event) ?? new Set();
      set.add(cb as (p: never) => void);
      listeners.set(event, set);
      return () => set.delete(cb as (p: never) => void);
    },
    pathForFile: () => "",
    platform: "win32",
  };
  window.nonon = bridge;
  // Lets the browser harness simulate live pushes: window.__emit("change:updated", payload).
  (window as unknown as { __emit: typeof emit }).__emit = emit;
}
