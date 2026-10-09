/**
 * Demo bridge: lets the renderer run in a plain browser (pnpm dev:web) with made-up data.
 * Installed only when `window.nonon` is missing; the Electron build never reaches this file's code paths.
 * Everything here is fake and the UI labels it "Demo data". No text here is real model output.
 *
 * URL switches for screenshots:
 *   ?onboarded=1     start inside the app with three demo workspaces
 *   ?runtime=missing start onboarded but with the AI not set up (shows the setup banner)
 *   ?unsupported=1   hardware report says this computer is too small
 *   ?fail=1          the first download attempt fails halfway
 */
import type {
  AppState,
  ChangeProposal,
  ChatEntry,
  CompanionCharacter,
  FileEntry,
  HardwareReport,
  LanStatus,
  ModelRecommendation,
  ProcedureInfo,
  ProviderStatus,
  Question,
  Routine,
  RoutineRun,
  RuntimeStatus,
  Settings,
  Task,
  Workspace,
} from "../../../shared/contracts";
import type { ChannelName, Channels, EventName, Events, NononBridge } from "../../../shared/ipc";
import { toast } from "./bridge";
import { baseName } from "./format";

type Handlers = { [K in ChannelName]: (arg: Channels[K]["arg"]) => Channels[K]["res"] | Promise<Channels[K]["res"]> };

const GB = 1024 ** 3;
const MB = 1024 ** 2;
let seq = 1;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;
const nowIso = () => new Date().toISOString();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export function installMockBridge(): void {
  const params = new URLSearchParams(window.location.search);
  const onboarded = params.get("onboarded") === "1" || params.get("runtime") === "missing";
  const unsupported = params.get("unsupported") === "1";
  let failNextInstall = params.get("fail") === "1";

  // ------------------------------------------------------------ state
  const folderOf = (name: string) => `C:\\Users\\Demo\\Documents\\${name}`;
  const ws = (id: string, name: string, pack: Workspace["pack"]): Workspace => ({
    id,
    name,
    folder: folderOf(name),
    pack,
    policy: "local-only",
    autoApply: false,
    createdAt: ago(9 * 86_400_000),
  });
  let workspaces: Workspace[] = onboarded ? [ws("ws-business", "Business", "bookkeeping"), ws("ws-school", "School", "education"), ws("ws-personal", "Personal", "general")] : [];

  let settings: Settings = {
    onboarded,
    companionName: "Non",
    character: "non" satisfies CompanionCharacter,
    reducedMotion: false,
    activeWorkspaceId: onboarded ? "ws-business" : null,
    modelId: null,
    backgroundRoutines: false,
    idleUnloadSeconds: 300,
  };

  const hardware: HardwareReport = unsupported
    ? {
        platform: "win32",
        arch: "x64",
        cpu: "Intel Celeron N4020",
        cores: 2,
        ramBytes: 4 * GB,
        freeRamBytes: 1.6 * GB,
        gpuName: null,
        gpuMemoryBytes: null,
        accel: "cpu",
        diskFreeBytes: 40 * GB,
        modelDir: "C:\\Users\\Demo\\AppData\\Roaming\\NONON\\models",
        supported: false,
        unsupportedReason: "This computer has 4 GB of memory. The built-in AI needs at least 8 GB.",
      }
    : {
        platform: "win32",
        arch: "x64",
        cpu: "AMD Ryzen 7 7700",
        cores: 16,
        ramBytes: 32 * GB,
        freeRamBytes: 19 * GB,
        gpuName: "NVIDIA GeForce RTX 5070",
        gpuMemoryBytes: 12 * GB,
        accel: "cuda",
        diskFreeBytes: 480 * GB,
        modelDir: "E:\\nonon-dev\\models",
        supported: true,
      };

  const recommendation: ModelRecommendation = {
    modelId: "qwen3.5-4b-q4_k_m",
    label: "Built-in AI",
    mode: "recommended",
    downloadBytes: Math.round(3.4 * GB),
    why: "Your computer has a graphics card with 12 GB of memory, so the AI can answer quickly and everything stays private on this computer.",
    caveat: "Speed estimates come from tests on similar computers, not yours. Larger files take longer.",
  };

  let runtime: RuntimeStatus = onboarded && params.get("runtime") !== "missing"
    ? { phase: "running", modelId: recommendation.modelId, progress: null, bytesDone: null, bytesTotal: null, detail: "Ready" }
    : { phase: "not-installed", modelId: null, progress: null, bytesDone: null, bytesTotal: null, detail: "The built-in AI is not set up yet" };
  if (runtime.phase === "running") settings.modelId = recommendation.modelId;

  const providers: ProviderStatus[] = [
    { id: "claude", label: "Claude", state: "not-connected", disclosure: "Your request and the files you choose are sent to Claude. This may use your Claude plan.", verified: "untested" },
    { id: "codex", label: "Codex", state: "not-installed", disclosure: "Your request and the files you choose are sent to Codex.", verified: "untested" },
    { id: "antigravity", label: "Antigravity", state: "not-installed", disclosure: "Your request and the files you choose are sent to Antigravity.", verified: "untested" },
  ];

  const tasks = new Map<string, Task>();
  const changes = new Map<string, ChangeProposal>();
  const chat = new Map<string, ChatEntry[]>();
  const routines: Routine[] = [];
  const timers = new Map<string, number[]>();
  const listeners = new Map<EventName, Set<(p: never) => void>>();

  function emit<K extends EventName>(event: K, payload: Events[K]): void {
    listeners.get(event)?.forEach((cb) => (cb as (p: Events[K]) => void)(clone(payload)));
  }

  const procedures: ProcedureInfo[] = [
    {
      id: "spreadsheet-compare",
      pack: "bookkeeping",
      title: "Compare two spreadsheets",
      summary: "See what matches and what does not between two lists, like your bank statement and your own records.",
      supports: "Give it two spreadsheets (Excel or .csv). You get a new spreadsheet showing what matches, what is missing, and what is listed twice.",
      limits: ["If your Excel file has several sheets, you choose one.", "Your original files are never changed without your OK.", "Each file can have up to 50,000 rows. If yours is bigger, split it by month."],
      inputs: [
        { key: "left", label: "First spreadsheet", kind: "file", accept: [".xlsx", ".csv"] },
        { key: "right", label: "Second spreadsheet or receipts list", kind: "file", accept: [".xlsx", ".csv"] },
      ],
      revision: "1",
    },
    {
      id: "check-totals",
      pack: "bookkeeping",
      title: "Check my totals",
      summary: "Find totals in your Excel file that leave out some rows.",
      supports: "Give it one Excel file. You get a list of totals that look wrong, plus a fix you can check before anything changes.",
      limits: ["It only checks totals made with SUM.", "It does not check macros or links to other files."],
      inputs: [{ key: "book", label: "Workbook", kind: "file", accept: [".xlsx"] }],
      revision: "1",
    },
    {
      id: "meeting-followup",
      pack: "business",
      title: "Meeting follow-up",
      summary: "Get a list of action items and decisions from your meeting notes, plus a reply you can edit.",
      supports: "Give it your meeting notes as a .txt, .md or Word file. You get action items (who, what and when) and decisions.",
      limits: ["It cannot listen to recordings. Use a typed copy of the notes instead.", "Owners and dates are filled in only when the notes say them."],
      inputs: [{ key: "notes", label: "Meeting notes", kind: "file", accept: [".txt", ".md", ".docx"] }],
      revision: "1",
    },
    {
      id: "gmail-brief",
      pack: "business",
      title: "Email brief",
      summary: "You get a list of your recent Gmail, with the emails that need you first.",
      supports: "Give it the number of days to look at. You get a short summary, deadlines copied from the emails, and reply drafts you can copy.",
      limits: ["Set up Gmail once first. You also need the internet to get new email.", "It never sends or deletes email."],
      inputs: [],
      revision: "1",
    },
    {
      id: "study-packet",
      pack: "education",
      title: "Make a study packet",
      summary: "Get key ideas, practice questions with an answer key, and key words from a reading.",
      supports: "Give it one or more .txt, .md, Word or PDF files. You get key ideas, practice questions and an answer key.",
      limits: ["Scanned or photographed PDFs are not read. Use a file that has real text.", "Questions come from your notes only."],
      inputs: [{ key: "notes", label: "Notes or readings", kind: "files", accept: [".txt", ".md", ".docx", ".pdf"] }],
      revision: "1",
    },
    {
      id: "summarize-doc",
      pack: "general",
      title: "Summarize a document",
      summary: "Get a short summary of a document, plus a draft reply or report.",
      supports: "Give it one .txt, .md, Word or PDF file. You get a short summary and a draft you can edit.",
      limits: ["Scanned or photographed PDFs are not read. Use a file that has real text.", "Very long documents are read in parts."],
      inputs: [
        { key: "doc", label: "Document", kind: "file", accept: [".txt", ".md", ".docx", ".pdf"] },
        { key: "length", label: "How long should it be?", kind: "choice", options: [{ value: "short", label: "Short" }, { value: "medium", label: "Medium" }], optional: true },
      ],
      revision: "1",
    },
    {
      id: "tidy-folder",
      pack: "general",
      title: "Tidy a folder",
      summary: "Get a plan to sort the loose files in your folder into neat folders. You see every move before anything changes.",
      supports: "Point it at your project's folder. You get a list of moves. Nothing moves until you say OK.",
      limits: ["It never deletes files.", "It sorts by file name and file type."],
      inputs: [],
      revision: "1",
    },
  ];

  const runtimeReady = () => runtime.phase === "ready" || runtime.phase === "running" || runtime.phase === "starting" || runtime.phase === "sleeping";
  const wsFolder = (id: string) => workspaces.find((w) => w.id === id)?.folder ?? "C:\\Users\\Demo\\Documents";

  // ------------------------------------------------------------ chat helpers
  function pushChat(entry: Omit<ChatEntry, "id" | "at"> & { at?: string }): ChatEntry {
    const e: ChatEntry = { id: uid("chat"), at: nowIso(), ...entry };
    chat.set(e.workspaceId, [...(chat.get(e.workspaceId) ?? []), e]);
    emit("chat:entry", e);
    return e;
  }

  /** Demo only: writes a canned reply word by word, the way the real app streams the AI's reply. */
  const stopped = new Set<string>();
  async function streamDemoReply(workspaceId: string, text: string): Promise<ChatEntry> {
    const entryId = uid("chat");
    stopped.delete(workspaceId);
    let written = "";
    for (const piece of text.split(/(?<= )/)) {
      if (stopped.has(workspaceId)) break;
      written += piece;
      emit("chat:delta", { workspaceId, entryId, text: piece });
      await wait(90);
    }
    const e: ChatEntry = { id: entryId, at: nowIso(), workspaceId, role: "companion", text: written.trim() || "Okay, I stopped." };
    chat.set(workspaceId, [...(chat.get(workspaceId) ?? []), e]);
    emit("chat:entry", e);
    return e;
  }

  // ------------------------------------------------------------ task simulation
  function later(taskId: string, ms: number, fn: () => void): void {
    const id = window.setTimeout(fn, ms);
    timers.set(taskId, [...(timers.get(taskId) ?? []), id]);
  }
  function clearTimers(taskId: string): void {
    (timers.get(taskId) ?? []).forEach((t) => window.clearTimeout(t));
    timers.delete(taskId);
  }
  function patchTask(id: string, fields: Partial<Task>): Task {
    const cur = tasks.get(id);
    if (!cur) throw new Error("That task no longer exists.");
    const next = { ...cur, ...fields, updatedAt: nowIso() };
    tasks.set(id, next);
    emit("task:updated", next);
    return next;
  }
  function step(id: string, label: string, detail?: string): void {
    const cur = tasks.get(id);
    if (!cur) return;
    patchTask(id, { steps: [...cur.steps, { at: nowIso(), label, detail }] });
  }

  function makeTask(workspaceId: string, procedureId: string, text: Record<string, string>, answers: Record<string, string>): Task {
    const proc = procedures.find((p) => p.id === procedureId);
    const t: Task = {
      id: uid("task"),
      workspaceId,
      procedureId,
      procedureRevision: "1",
      title: proc?.title ?? "Task",
      state: "inspecting",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      inputs: {},
      text,
      answers,
      questions: [],
      steps: [],
      checkpoints: {},
      outputs: [],
      proposalIds: [],
      checks: [],
      locations: { ai: "local", files: "this-computer" },
    };
    tasks.set(t.id, t);
    return t;
  }

  function begin(id: string): void {
    clearTimers(id);
    if (!runtimeReady()) {
      patchTask(id, { state: "waiting", waitingOn: "The built-in AI is still being set up", steps: [{ at: nowIso(), label: "Waiting for the built-in AI to finish setting up" }] });
      return;
    }
    patchTask(id, { state: "inspecting", waitingOn: undefined, error: undefined, steps: [{ at: nowIso(), label: "Looking at your files" }] });
    later(id, 1500, () => {
      const t = tasks.get(id);
      if (!t) return;
      const scenario = t.text.__scenario;
      if (scenario === "attention") {
        patchTask(id, {
          state: "needs-attention",
          error: "I could not read \u201Cweekly-expenses-final-FINAL-v3 (copy of copy) 2025-10-01.xlsx\u201D. It may be damaged or protected with a password.",
        });
        return;
      }
      if (scenario === "failed") {
        patchTask(id, { state: "failed", error: "Something went wrong part way through. Your files were not changed." });
        return;
      }
      if (t.procedureId === "spreadsheet-compare" && !t.answers["match-key"]) {
        const questions: Question[] = [
          {
            id: "match-key",
            prompt: "Which column tells me two rows are the same expense?",
            kind: "choice",
            options: [
              { value: "receipt", label: "Receipt number" },
              { value: "date-amount", label: "Date and amount" },
            ],
            suggested: "receipt",
          },
          { id: "tolerance", prompt: "Should I treat amounts a few centavos apart as the same?", kind: "confirm", suggested: "yes" },
        ];
        patchTask(id, { state: "clarifying", questions });
        return;
      }
      work(id);
    });
  }

  function work(id: string): void {
    patchTask(id, { state: "running", questions: [] });
    step(id, "Reading both spreadsheets", "2 files, 148 rows");
    later(id, 1400, () => step(id, "Matching rows by receipt number"));
    later(id, 2800, () => step(id, "Checking the totals", "3 totals found"));
    later(id, 4200, () => {
      patchTask(id, { state: "validating" });
      step(id, "Double-checking the results");
    });
    later(id, 5400, () => finish(id));
  }

  function finish(id: string): void {
    const t = tasks.get(id);
    if (!t) return;
    const folder = wsFolder(t.workspaceId);
    const proposal: ChangeProposal = {
      id: uid("change"),
      taskId: id,
      workspaceId: t.workspaceId,
      procedureRevision: "1",
      target: `${folder}\\weekly-expenses.xlsx`,
      edits: [{ op: "xlsx-set-cells", path: `${folder}\\weekly-expenses.xlsx`, sheet: "Expenses", cells: [{ address: "D13", value: 11000, formula: "SUM(D10:D12)" }] }],
      reason: "The total formula leaves out row 12 (Printing, 500).",
      preview: {
        title: "Expenses, cell D13",
        before: [["Total", "=SUM(D10:D11)", "10,500"]],
        after: [["Total", "=SUM(D10:D12)", "11,000"]],
        highlights: [{ row: 0, col: 2 }],
      },
      checks: [{ id: "base", label: "File has not changed since I looked at it", status: "pass" }],
      base: null,
      createdAt: nowIso(),
      status: "staged",
    };
    changes.set(proposal.id, proposal);
    emit("change:updated", proposal);
    patchTask(id, {
      state: "review",
      proposalIds: [proposal.id],
      summary:
        "The total formula excludes row 12.\n\nHere is what I found:\n\n- **1 total is wrong.** Cell D13 adds rows 10 to 11 but skips row 12 (Printing, 500).\n- **2 receipts have no matching row** in the spreadsheet.\n- **146 of 148 rows** matched.\n\nI prepared one formula correction. Your workbook has **not** been changed yet.",
      outputs: [
        { path: `${folder}\\NONON Output\\expense-comparison.xlsx`, label: "Comparison report", kind: "xlsx" },
        { path: `${folder}\\NONON Output\\unmatched-receipts-with-a-very-long-descriptive-file-name-2025-10-01.csv`, label: "Unmatched receipts", kind: "csv" },
      ],
      checks: [
        { id: "rows", label: "Every row was read", status: "pass", detail: "148 of 148 rows" },
        { id: "totals", label: "NONON added up the totals itself, so they are exact", status: "pass" },
        { id: "receipts", label: "2 receipts have no matching row", status: "warn", detail: "Listed in the unmatched receipts file" },
      ],
      report: { kind: "demo", note: "Demo data" },
    });
  }

  function startTask(workspaceId: string, procedureId: string, text: Record<string, string>, answers: Record<string, string>): Task {
    const t = makeTask(workspaceId, procedureId, text, answers);
    emit("task:updated", t);
    begin(t.id);
    return tasks.get(t.id) ?? t;
  }

  // ------------------------------------------------------------ runtime install simulation
  let installTimer: number | null = null;
  function setRuntime(next: Partial<RuntimeStatus>): void {
    runtime = { ...runtime, ...next };
    emit("runtime:status", runtime);
  }
  function startInstall(modelId: string): void {
    if (installTimer) window.clearInterval(installTimer);
    const runtimeMs = 2200;
    const modelMs = 7500;
    const verifyMs = 1600;
    const failAt = failNextInstall ? 0.45 : null;
    failNextInstall = false;
    const total = recommendation.downloadBytes;
    const t0 = Date.now();
    setRuntime({ phase: "downloading-runtime", modelId, progress: 0, bytesDone: 0, bytesTotal: 38 * MB, detail: "Getting the AI ready", error: undefined });
    installTimer = window.setInterval(() => {
      const el = Date.now() - t0;
      if (el < runtimeMs) {
        const p = el / runtimeMs;
        setRuntime({ phase: "downloading-runtime", progress: p, bytesDone: Math.round(38 * MB * p), bytesTotal: 38 * MB, detail: "Getting the AI ready" });
      } else if (el < runtimeMs + modelMs) {
        const p = (el - runtimeMs) / modelMs;
        if (failAt !== null && p >= failAt) {
          if (installTimer) window.clearInterval(installTimer);
          installTimer = null;
          setRuntime({ phase: "failed", progress: null, detail: "Download stopped", error: "The download was interrupted. Check your internet connection and try again." });
          return;
        }
        setRuntime({ phase: "downloading-model", progress: p, bytesDone: Math.round(total * p), bytesTotal: total, detail: "Downloading the built-in AI" });
      } else if (el < runtimeMs + modelMs + verifyMs) {
        setRuntime({ phase: "verifying", progress: null, bytesDone: null, bytesTotal: null, detail: "Checking the download" });
      } else {
        if (installTimer) window.clearInterval(installTimer);
        installTimer = null;
        settings = { ...settings, modelId };
        emit("settings:updated", settings);
        setRuntime({ phase: "ready", progress: null, bytesDone: null, bytesTotal: null, detail: "Ready", modelId });
        [...tasks.values()].filter((t) => t.state === "waiting").forEach((t) => begin(t.id));
      }
    }, 150);
  }

  // ------------------------------------------------------------ routine proposal
  function proposeRoutine(workspaceId: string, text: string): Routine {
    const mail = /inbox|email|mail/i.test(text);
    const folder = wsFolder(workspaceId);
    return {
      id: uid("routine"),
      workspaceId,
      title: mail ? "Weekday email summary" : "Friday expense check",
      description: mail ? "Read my inbox and list what needs me." : "Compare the newest expenses file with the receipts list.",
      procedureId: mail ? "gmail-brief" : "spreadsheet-compare",
      inputScope: { folder, pick: mail ? {} : { left: { newest: 1, extensions: [".xlsx"], nameContains: "expenses" } } },
      params: {},
      schedule: mail
        ? { cron: "0 8 * * 1-5", timezone: "Asia/Manila", humanText: "Every weekday at 8:00 AM" }
        : { cron: "0 16 * * 5", timezone: "Asia/Manila", humanText: "Every Friday at 4:00 PM" },
      location: { ai: "local", files: "this-computer" },
      allowedActions: mail ? ["read-mail", "write-outputs"] : ["read-files", "write-outputs"],
      missedRun: "catch-up-once",
      overlap: "skip",
      enabled: true,
      createdAt: nowIso(),
    };
  }

  // ------------------------------------------------------------ seed demo history
  if (onboarded) {
    const t = makeTask("ws-business", "spreadsheet-compare", {}, { "match-key": "receipt" });
    tasks.set(t.id, {
      ...t,
      title: "Compare two spreadsheets",
      state: "complete",
      createdAt: ago(26 * 3_600_000),
      updatedAt: ago(26 * 3_600_000),
      summary: "Compared **Sept expenses** with the receipts list. 140 of 141 rows matched.",
      steps: [{ at: ago(26 * 3_600_000), label: "Looking at your files" }, { at: ago(26 * 3_600_000), label: "Matching rows by receipt number" }],
      outputs: [{ path: `${folderOf("Business")}\\NONON Output\\sept-comparison.xlsx`, label: "Comparison report", kind: "xlsx" }],
      checks: [{ id: "rows", label: "Every row was read", status: "pass" }],
    });
    chat.set("ws-business", [
      { id: "seed-1", workspaceId: "ws-business", at: ago(26 * 3_600_000 + 60_000), role: "user", text: "Compare September expenses with the receipts list.", attachments: [{ path: `${folderOf("Business")}\\sept-expenses.xlsx`, name: "sept-expenses.xlsx" }] },
      { id: "seed-2", workspaceId: "ws-business", at: ago(26 * 3_600_000), role: "companion", text: "Done. Here is what I found.", taskId: t.id },
    ]);
  }

  // ------------------------------------------------------------ handlers
  const appState = (): AppState => ({ settings, workspaces, runtime, hardware, providers, gmail: { state: "not-configured", configHint: "Add your Google sign-in file to enable Gmail.", cachedMessages: 0, scopes: [] }, version: "0.1.0-demo", platform: "win32" });

  // ------------------------------------------------------------ shared compute (demo only: no network is touched)
  let lan: LanStatus = {
    host: { running: false, port: 18765, address: "192.168.1.20", devices: [], pending: [], code: null, busy: false },
    client: { state: "not-paired" },
  };
  const setLan = (next: LanStatus): LanStatus => {
    lan = next;
    emit("lan:updated", lan);
    return lan;
  };
  const demoPairing = (): string =>
    "nonon-pair-1." +
    btoa(JSON.stringify({ v: 1, h: "192.168.1.20", p: 18765, f: "a".repeat(64), s: "demoDemoDemoDemoDemoDemo01", n: "Desk PC (demo)" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const handlers: Handlers = {
    "app:state": () => appState(),
    "settings:update": (patch) => {
      settings = { ...settings, ...patch };
      emit("settings:updated", settings);
      return settings;
    },
    "shell:reveal": ({ path }) => toast(`Demo: this would show ${baseName(path)} in its folder.`, "info"),
    "shell:open": ({ path }) => toast(`Demo: this would open ${baseName(path)}.`, "info"),
    "output:preview": async ({ path }) => {
      await wait(250);
      if (/\.xlsx$/i.test(path)) {
        return {
          kind: "table" as const,
          sheets: [
            { name: "Summary", rows: [["Group", "Rows in A", "Rows in B", "Amount in A"], ["Matched", "146", "146", "12,480.00"], ["Only in file A", "2", "0", "310.00"], ["Only in file B", "0", "2", "95.50"]], totalRows: 3, totalCols: 4, truncated: false },
            { name: "Matched", rows: [["Date", "Description", "Amount"], ["2026-05-01", "Paper and toner", "120.50"], ["2026-05-02", "Courier", "35.00"]], totalRows: 2, totalCols: 3, truncated: false },
          ],
        };
      }
      if (/\.csv$/i.test(path)) return { kind: "table" as const, sheets: [{ name: baseName(path), rows: [["Receipt", "Vendor", "Amount"], ["1001", "Print Supply Co", "88.20"], ["1002", "Courier", "35.00"]], totalRows: 2, totalCols: 3, truncated: false }] };
      return { kind: "markdown" as const, text: "# Demo document\n\nThis is made-up text for the browser preview.\n\n- First point\n- Second point\n", truncated: false, bytes: 90 };
    },

    "workspace:create": ({ name, folder, pack, policy }) => {
      const w: Workspace = { id: uid("ws"), name, folder, pack, policy: policy ?? "local-only", autoApply: false, createdAt: nowIso() };
      workspaces = [...workspaces, w];
      return w;
    },
    "workspace:update": ({ id, patch }) => {
      workspaces = workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w));
      const w = workspaces.find((x) => x.id === id);
      if (!w) throw new Error("That project was not found.");
      return w;
    },
    "workspace:remove": ({ id }) => {
      workspaces = workspaces.filter((w) => w.id !== id);
    },
    "workspace:pick-folder": async () => {
      await wait(300);
      return folderOf(workspaces.length === 0 ? "Business" : `Folder ${workspaces.length + 1}`);
    },
    "workspace:files": ({ id }): FileEntry[] =>
      ["weekly-expenses.xlsx", "receipts-october.csv", "meeting-notes.docx"].map((name, i) => ({
        path: `${wsFolder(id)}\\${name}`,
        name,
        ext: name.slice(name.lastIndexOf(".")),
        size: 40_000 + i * 90_000,
        mtimeMs: Date.now() - i * 86_400_000,
        supported: true,
      })),
    "workspace:pick-files": async ({ accept }) => {
      await wait(250);
      const ext = accept?.[0] ?? ".xlsx";
      return [`C:\\Users\\Demo\\Documents\\Business\\weekly-expenses${ext}`, `C:\\Users\\Demo\\Documents\\Business\\receipts-october${ext === ".xlsx" ? ".csv" : ext}`];
    },
    "workspace:add-samples": async ({ id }): Promise<FileEntry[]> => {
      await wait(500);
      const base = `${wsFolder(id)}\\Samples`;
      const pack = workspaces.find((w) => w.id === id)?.pack;
      const names = pack === "education" ? ["sample-lecture-notes.md", "sample-reading.txt"] : pack === "business" ? ["sample-meeting-notes.txt"] : ["sample-expenses.xlsx", "sample-receipts.csv"];
      return names.map((name, i) => ({ path: `${base}\\${name}`, name, ext: name.slice(name.lastIndexOf(".")), size: 3_100 + i * 19_000, mtimeMs: Date.now(), supported: true }));
    },

    "hardware:assess": async () => {
      await wait(1100);
      return { report: hardware, recommendation: hardware.supported ? recommendation : null, alternatives: [] };
    },
    "runtime:status": () => runtime,
    "runtime:install": ({ modelId }) => startInstall(modelId),
    "runtime:cancel": () => {
      if (installTimer) window.clearInterval(installTimer);
      installTimer = null;
      setRuntime({ phase: "not-installed", progress: null, bytesDone: null, bytesTotal: null, detail: "Setup was cancelled" });
    },
    "runtime:start": () => setRuntime({ phase: "running" }),
    "runtime:stop": () => setRuntime({ phase: "sleeping" }),

    "procedure:list": ({ pack }) => procedures.filter((p) => !pack || p.pack === pack),
    "task:list": ({ workspaceId }) => [...tasks.values()].filter((t) => t.workspaceId === workspaceId),
    "task:get": ({ id }) => tasks.get(id) ?? null,
    "task:start": ({ workspaceId, procedureId, text, answers }) => startTask(workspaceId, procedureId, text ?? {}, answers ?? {}),
    "task:answer": ({ id, answers }) => {
      const t = tasks.get(id);
      if (!t) throw new Error("That task no longer exists.");
      patchTask(id, { answers: { ...t.answers, ...answers } });
      work(id);
      return tasks.get(id) as Task;
    },
    "task:stop": ({ id }) => {
      clearTimers(id);
      return patchTask(id, { state: "interrupted" });
    },
    "task:resume": ({ id }) => {
      const t = tasks.get(id);
      if (t) patchTask(id, { text: { ...t.text, __scenario: "" } });
      begin(id);
      return tasks.get(id) as Task;
    },

    "chat:history": ({ workspaceId }) => chat.get(workspaceId) ?? [],
    "chat:send": async ({ workspaceId, text, files }) => {
      const added: ChatEntry[] = [];
      added.push(pushChat({ workspaceId, role: "user", text, attachments: files?.map((p) => ({ path: p, name: baseName(p) })) }));
      await wait(700);
      if (/\b(every|each|daily|weekly|weekday|monday|tuesday|wednesday|thursday|friday)\b/i.test(text)) {
        added.push(pushChat({ workspaceId, role: "companion", text: "Here is what I would set up. Nothing is saved until you say OK.", routine: proposeRoutine(workspaceId, text) }));
        return added;
      }
      if (/\b(expense|spreadsheet|compare|total|workbook|receipt|broken|corrupt|crash)\b/i.test(text)) {
        const scenario = /crash/i.test(text) ? "failed" : /broken|corrupt/i.test(text) ? "attention" : "";
        const t = startTask(workspaceId, "spreadsheet-compare", { __scenario: scenario }, {});
        added.push(pushChat({ workspaceId, role: "companion", text: "On it. I will compare the records and show you any changes before I make them.", taskId: t.id }));
        return added;
      }
      added.push(await streamDemoReply(workspaceId, "I can help with that. Add the files you want me to use, or pick an idea on the Home screen."));
      return added;
    },
    "chat:stop": ({ workspaceId }) => {
      stopped.add(workspaceId);
    },

    "change:list": ({ workspaceId, taskId }) => [...changes.values()].filter((c) => (!workspaceId || c.workspaceId === workspaceId) && (!taskId || c.taskId === taskId)),
    "change:apply": ({ id }) => settleChange(id, "applied"),
    "change:reject": ({ id }) => settleChange(id, "rejected"),
    "change:recover": ({ id }) => settleChange(id, "recovered"),

    "routine:list": ({ workspaceId }) => routines.filter((r) => !workspaceId || r.workspaceId === workspaceId),
    "routine:propose": ({ workspaceId, text }) => proposeRoutine(workspaceId, text),
    "routine:save": ({ routine }) => {
      const i = routines.findIndex((r) => r.id === routine.id);
      if (i >= 0) routines[i] = routine;
      else routines.push(routine);
      emit("routine:updated", routine);
      return routine;
    },
    "routine:set-enabled": ({ id, enabled }) => {
      const r = routines.find((x) => x.id === id);
      if (!r) throw new Error("That routine was not found.");
      r.enabled = enabled;
      return r;
    },
    "routine:run-now": ({ id }): RoutineRun => ({ id: uid("run"), routineId: id, trigger: "manual", scheduledFor: nowIso(), startedAt: nowIso(), status: "running" }),
    "routine:remove": ({ id }) => {
      const i = routines.findIndex((r) => r.id === id);
      if (i >= 0) routines.splice(i, 1);
    },
    "routine:runs": () => [],

    "gmail:status": () => appState().gmail,
    "gmail:connect": () => appState().gmail,
    "gmail:disconnect": () => appState().gmail,
    "gmail:brief": () => ({ generatedAt: nowIso(), freshness: "cached", lastSyncAt: null, items: [], summary: "Demo data: no inbox connected." }),

    "provider:list": () => providers,
    "provider:probe": ({ id }) => providers.find((p) => p.id === id) ?? (providers[0] as ProviderStatus),
    "provider:sign-in": ({ id }) => providers.find((p) => p.id === id) ?? (providers[0] as ProviderStatus),
    "roles:get": ({ workspaceId }) => ({ workspaceId, roles: {} }),
    "roles:set": ({ workspaceId }) => ({ workspaceId, roles: {} }),

    "lan:status": () => lan,
    "lan:host-start": () => setLan({ ...lan, host: { ...lan.host, running: true } }),
    "lan:host-stop": () => setLan({ ...lan, host: { ...lan.host, running: false, code: null, pending: [] } }),
    "lan:pairing-code": () => {
      const code = { pairing: demoPairing(), shortCode: "482 913", expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
      setLan({ ...lan, host: { ...lan.host, code } });
      setTimeout(() => {
        if (!lan.host.running || lan.host.pending.length > 0) return;
        const req = { id: uid("pr"), deviceName: "Demo laptop", address: "192.168.1.31", at: nowIso(), shortCode: code.shortCode };
        setLan({ ...lan, host: { ...lan.host, code: null, pending: [req] } });
      }, 4000);
      return code;
    },
    "lan:approve": ({ requestId }) => {
      const req = lan.host.pending.find((p) => p.id === requestId);
      const devices = req ? [...lan.host.devices, { id: uid("dev"), name: req.deviceName, createdAt: nowIso() }] : lan.host.devices;
      return setLan({ ...lan, host: { ...lan.host, devices, pending: lan.host.pending.filter((p) => p.id !== requestId) } });
    },
    "lan:deny": ({ requestId }) => setLan({ ...lan, host: { ...lan.host, pending: lan.host.pending.filter((p) => p.id !== requestId) } }),
    "lan:revoke": ({ deviceId }) => setLan({ ...lan, host: { ...lan.host, devices: lan.host.devices.filter((d) => d.id !== deviceId) } }),
    "lan:pair": async ({ pairing, deviceName }) => {
      if (!pairing.startsWith("nonon-pair-1.")) throw new Error("That link code is not valid. Copy the whole code from the other computer and try again.");
      await wait(900);
      const client = { state: "connected" as const, hostName: "Desk PC (demo)", address: "192.168.1.20", deviceName, pairedAt: nowIso(), detail: "Connected." };
      setLan({ ...lan, client });
      return client;
    },
    "lan:client-status": () => lan.client,
    "lan:unpair": () => {
      setLan({ ...lan, client: { state: "not-paired" } });
      return lan.client;
    },

    "diagnostics:snapshot": () => ({ runtime, hardware, log: ["Demo data: no real log."] }),
  };

  function settleChange(id: string, status: ChangeProposal["status"]): ChangeProposal {
    const c = changes.get(id);
    if (!c) throw new Error("That change was not found.");
    const next = { ...c, status, appliedAt: status === "applied" ? nowIso() : c.appliedAt };
    changes.set(id, next);
    emit("change:updated", next);
    const siblings = [...changes.values()].filter((x) => x.taskId === c.taskId);
    if (siblings.every((x) => x.status !== "staged")) {
      patchTask(c.taskId, { state: siblings.some((x) => x.status === "applied") ? "complete" : "rejected" });
    }
    return next;
  }

  const bridge: NononBridge = {
    async call(channel, arg) {
      await wait(90);
      const h = handlers[channel] as (a: unknown) => unknown;
      return clone(await h(arg)) as never;
    },
    on(event, cb) {
      const set = listeners.get(event) ?? new Set();
      set.add(cb as (p: never) => void);
      listeners.set(event, set);
      return () => set.delete(cb as (p: never) => void);
    },
    pathForFile: (file) => `C:\\Users\\Demo\\Downloads\\${file.name}`,
    platform: "win32",
  };

  (window as unknown as { __NONON_MOCK__: boolean }).__NONON_MOCK__ = true;
  window.nonon = bridge;
}
