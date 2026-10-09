import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Task } from "../../../shared/contracts";
import { api, useStreamingCount } from "./bridge";
import { isActive } from "./format";

export type NonState = "idle" | "greeting" | "listening" | "thinking" | "talking" | "success";

export interface NonMood {
  state: NonState;
  /** Plain words next to the avatar, so the state never depends on seeing the animation. */
  status: string;
  /** Bumps on every one-shot (greeting, success) so the hop replays. */
  epoch: number;
}

export const NonMoodContext = createContext<NonMood>({ state: "idle", status: "", epoch: 0 });
export const useNonMood = (): NonMood => useContext(NonMoodContext);

export function statusFor(state: NonState, name: string): string {
  switch (state) {
    case "talking":
      return `${name} is writing a reply`;
    case "thinking":
      return `${name} is working on it`;
    case "listening":
      return `${name} is listening`;
    case "success":
      return "Done";
    case "greeting":
      return `Hi, I'm ${name}`;
    default:
      return `${name} is ready`;
  }
}

// ---- the composer reports typing here; the avatar reads it. A tiny store keeps the two components unrelated.
let typing = false;
const typingListeners = new Set<() => void>();

export function setComposerTyping(value: boolean): void {
  if (typing === value) return;
  typing = value;
  typingListeners.forEach((l) => l());
}

function useComposerTyping(): boolean {
  return useSyncExternalStore(
    (cb) => {
      typingListeners.add(cb);
      return () => typingListeners.delete(cb);
    },
    () => typing,
  );
}

// ---- one-shots

const greeted = new Set<string>();
const GREETING_MS = 1800;
const SUCCESS_MS = 2200;

/** A short-lived state (greeting, success) that clears itself. The timer is cleaned up on unmount. */
export function useOneShot(): { shot: { state: "greeting" | "success"; epoch: number } | null; fire: (state: "greeting" | "success") => void } {
  const [shot, setShot] = useState<{ state: "greeting" | "success"; epoch: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const epoch = useRef(0);
  const fire = useCallback((state: "greeting" | "success") => {
    window.clearTimeout(timer.current);
    epoch.current += 1;
    setShot({ state, epoch: epoch.current });
    timer.current = window.setTimeout(() => setShot(null), state === "success" ? SUCCESS_MS : GREETING_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { shot, fire };
}

const FINISHED = new Set<Task["state"]>(["complete", "review"]);

/**
 * Non's mood in the app shell, driven by real events:
 * task:updated (a running task is thinking; one that finishes is success), change:updated (a change applied is success),
 * chat:delta (a reply streaming is talking), the composer (typing is listening), and the first time a project is shown (greeting).
 * Order when several apply: success, talking, thinking, listening, greeting, idle.
 */
export function useShellMood({ name, workspaceId, working }: { name: string; workspaceId: string | null; working: boolean }): NonMood {
  const { shot, fire } = useOneShot();
  const streaming = useStreamingCount() > 0;
  const typingNow = useComposerTyping();

  useEffect(() => {
    if (!workspaceId || greeted.has(workspaceId)) return;
    greeted.add(workspaceId);
    fire("greeting");
  }, [workspaceId, fire]);

  useEffect(() => {
    const taskStates = new Map<string, Task["state"]>();
    const changeStates = new Map<string, string>();
    const offTask = api.on("task:updated", (t) => {
      const before = taskStates.get(t.id);
      taskStates.set(t.id, t.state);
      if (before && FINISHED.has(t.state) && (isActive(before) || before === "waiting" || before === "clarifying")) fire("success");
    });
    const offChange = api.on("change:updated", (c) => {
      const before = changeStates.get(c.id);
      changeStates.set(c.id, c.status);
      if (before && before !== "applied" && c.status === "applied") fire("success");
    });
    return () => {
      offTask();
      offChange();
    };
  }, [fire]);

  const state: NonState = shot?.state === "success" ? "success" : streaming ? "talking" : working ? "thinking" : typingNow ? "listening" : shot?.state === "greeting" ? "greeting" : "idle";
  return { state, status: statusFor(state, name), epoch: shot?.epoch ?? 0 };
}
