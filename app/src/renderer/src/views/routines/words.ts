import type { AiLocation, Routine, RoutineRun, RoutineRunStatus } from "../../../../shared/contracts";

export const RUN_STATUS: Record<RoutineRunStatus, { label: string; tone: "chip-ok" | "chip-attn" | "chip-red" | "chip-info" | "" }> = {
  running: { label: "Working on it", tone: "chip-info" },
  succeeded: { label: "Done", tone: "chip-ok" },
  "needs-review": { label: "Ready for you to check", tone: "chip-attn" },
  failed: { label: "Something went wrong", tone: "chip-red" },
  "waiting-for-input": { label: "Needs a quick answer from you", tone: "chip-attn" },
  "skipped-overlap": { label: "Skipped: the last run was still going", tone: "" },
  "skipped-missed": { label: "Skipped: the computer was off", tone: "" },
  interrupted: { label: "Stopped", tone: "chip-attn" },
};

export const TRIGGER_WORDS: Record<RoutineRun["trigger"], string> = {
  due: "On schedule",
  "catch-up": "Run late, after the computer was off",
  manual: "Started by you",
};

export const AI_WHERE: Record<AiLocation, string> = {
  local: "On this computer",
  paired: "On your other computer",
  claude: "Claude (online)",
  codex: "Codex (online)",
  antigravity: "Antigravity (online)",
};

export const ACTION_WORDS: Record<Routine["allowedActions"][number], string> = {
  "read-files": "Read files in the folder",
  "write-outputs": "Save what it makes in the NONON Output folder",
  "read-mail": "Read your Gmail",
};

export const MISSED_WORDS: Record<Routine["missedRun"], string> = {
  "catch-up-once": "If the computer was off, NONON runs it once when you are back.",
  skip: "If the computer was off, NONON skips that run.",
};
