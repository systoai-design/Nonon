import type { AiLocation, PackId, RuntimePhase, TaskState } from "../../../shared/contracts";

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDay(iso)}, ${formatTime(iso)}`;
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function aiLabel(ai: AiLocation): string {
  switch (ai) {
    case "local":
      return "This computer";
    case "paired":
      return "Your other computer";
    case "claude":
      return "Claude (online)";
    case "codex":
      return "Codex (online)";
    case "antigravity":
      return "Antigravity (online)";
  }
}

/** Hover text for the "AI:" line. Says only what is true about where the work happens. */
export function aiHint(ai: AiLocation): string {
  switch (ai) {
    case "local":
      return "The thinking happens on this computer. Nothing is sent to the internet.";
    case "paired":
      return "The thinking happens on your other computer, over your home or office network. Nothing goes to the internet.";
    case "claude":
      return "The parts of your files this task needs are sent to Claude.";
    case "codex":
      return "The parts of your files this task needs are sent to Codex.";
    case "antigravity":
      return "The parts of your files this task needs are sent to Antigravity.";
  }
}

export function isCloud(ai: AiLocation): boolean {
  return ai === "claude" || ai === "codex" || ai === "antigravity";
}

export const ACTIVE_STATES: TaskState[] = ["inspecting", "running", "validating", "applying"];

export function isActive(state: TaskState): boolean {
  return ACTIVE_STATES.includes(state);
}

export function stateLabel(state: TaskState): string {
  switch (state) {
    case "inspecting":
      return "Looking at your files";
    case "clarifying":
      return "Needs a quick answer from you";
    case "running":
      return "Working on it";
    case "validating":
      return "Double-checking";
    case "review":
      return "Ready for you to check";
    case "applying":
      return "Making the change";
    case "complete":
      return "Done";
    case "interrupted":
      return "Stopped";
    case "waiting":
      return "Waiting";
    case "needs-attention":
      return "Needs a look";
    case "rejected":
      return "You said no";
    case "failed":
      return "Something went wrong";
  }
}

/** Beginner wording for the setup phases. */
export function setupPhaseLabel(phase: RuntimePhase): string {
  switch (phase) {
    case "not-installed":
      return "Not set up yet";
    case "downloading-runtime":
      return "Getting the AI ready";
    case "downloading-model":
      return "Downloading the built-in AI";
    case "verifying":
    case "installing":
      return "Checking the download";
    case "ready":
    case "starting":
    case "running":
    case "sleeping":
      return "Ready";
    case "failed":
      return "Something went wrong";
  }
}

export function isRuntimeReady(phase: RuntimePhase): boolean {
  return phase === "ready" || phase === "starting" || phase === "running" || phase === "sleeping";
}

export function isRuntimeBusy(phase: RuntimePhase): boolean {
  return phase === "downloading-runtime" || phase === "downloading-model" || phase === "verifying" || phase === "installing";
}

export function packLabel(id: PackId): string {
  switch (id) {
    case "general":
      return "General";
    case "business":
      return "Business and office";
    case "bookkeeping":
      return "Bookkeeping";
    case "education":
      return "Study and teaching";
  }
}

const GENERIC_ERROR = "Something went wrong. Please try again. If it keeps happening, restart NONON.";

const ERROR_HINTS: [RegExp, string][] = [
  [/\bENOENT\b|no such file/i, "NONON could not find that file or folder. It may have been moved or renamed."],
  [/\bEACCES\b|\bEPERM\b|permission denied|operation not permitted/i, "NONON is not allowed to open that file or folder. Check that it is not locked or open in another app."],
  [/\bEBUSY\b|resource busy/i, "That file is open in another app. Close it and try again."],
  [/\bENOSPC\b|no space left/i, "There is not enough free space on the drive. Free up some space and try again."],
  [/\bECONN\w*|\bENOTFOUND\b|\bETIMEDOUT\b|\bEAI_AGAIN\b|fetch failed|socket hang up/i, "NONON could not reach the internet. Check your connection and try again."],
];

/** Errors that read like code or internals, not like a sentence for a person. */
const TECHNICAL = /\bipc\b|invoking remote method|\bhandler\b|\n\s+at |\bat \S+ \(|\.(?:ts|js|tsx|mjs):\d+|\b(?:undefined|NaN)\b|\[object|^[{[]|\bzod\b|\bjson\b|\bstatus code\b|\bHTTP \d{3}\b|\bexit code\b|\bE[A-Z]{3,}:/i;

/** Turns anything thrown into one calm sentence a person can act on. Never returns raw error text. */
export function plainError(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const msg = raw
    .replace(/^Error invoking remote method '[^']*':\s*/, "")
    .replace(/^(?:[A-Za-z]*Error:\s*)+/, "")
    .trim();
  if (!msg) return GENERIC_ERROR;
  const hint = ERROR_HINTS.find(([re]) => re.test(msg));
  if (hint) return hint[1];
  if (msg.length > 220 || TECHNICAL.test(msg)) return GENERIC_ERROR;
  return /[.!?]$/.test(msg) ? msg : `${msg}.`;
}
