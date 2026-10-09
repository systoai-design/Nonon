import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AppState, ChangeProposal, ChatEntry, ProcedureInfo, PackId, Settings, Task } from "../../../shared/contracts";
import type { ChannelName, Channels, EventName, Events } from "../../../shared/ipc";
import { isActive, plainError } from "./format";

// ---------------------------------------------------------------- toasts

export interface Toast {
  id: number;
  message: string;
  kind: "error" | "info" | "success";
}

let toasts: Toast[] = [];
let toastSeq = 1;
const toastListeners = new Set<() => void>();

function emitToasts(): void {
  toasts = [...toasts];
  toastListeners.forEach((l) => l());
}

export function toast(message: string, kind: Toast["kind"] = "info"): void {
  if (toasts.some((t) => t.message === message)) return;
  const id = toastSeq++;
  toasts = [...toasts, { id, message, kind }];
  toastListeners.forEach((l) => l());
  setTimeout(() => dismissToast(id), kind === "error" ? 8000 : 4000);
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      toastListeners.add(cb);
      return () => toastListeners.delete(cb);
    },
    () => toasts,
  );
}

// ---------------------------------------------------------------- api

/** True when the renderer is running against the in-browser demo bridge instead of Electron. */
export function isMock(): boolean {
  return (window as unknown as { __NONON_MOCK__?: boolean }).__NONON_MOCK__ === true;
}

export const api = {
  /** Calls main. Failures show a plain-language toast unless `silent`, and still reject so callers can stop. */
  async call<K extends ChannelName>(channel: K, arg: Channels[K]["arg"], opts?: { silent?: boolean }): Promise<Channels[K]["res"]> {
    try {
      return await window.nonon.call(channel, arg);
    } catch (e) {
      if (!opts?.silent) toast(plainError(e), "error");
      throw e;
    }
  },
  on<K extends EventName>(event: K, cb: (payload: Events[K]) => void): () => void {
    return window.nonon.on(event, cb);
  },
  pathForFile(file: File): string {
    return window.nonon.pathForFile(file);
  },
};

// ---------------------------------------------------------------- app state

let appState: AppState | null = null;
const appListeners = new Set<() => void>();

function setAppState(next: AppState): void {
  appState = next;
  appListeners.forEach((l) => l());
}

export async function refreshAppState(): Promise<AppState> {
  const s = await api.call("app:state", undefined);
  setAppState(s);
  return s;
}

export function useAppState(): AppState | null {
  return useSyncExternalStore(
    (cb) => {
      appListeners.add(cb);
      return () => appListeners.delete(cb);
    },
    () => appState,
  );
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const settings = await api.call("settings:update", patch);
  if (appState) setAppState({ ...appState, settings });
  return settings;
}

// ---------------------------------------------------------------- tasks and changes stores

const taskMap = new Map<string, Task>();
let taskVersion = 0;
const taskListeners = new Set<() => void>();
const loadedTaskWorkspaces = new Set<string>();
const readyTaskWorkspaces = new Set<string>();

/** True once the first task:list for this workspace has answered (avoids flashing empty states). */
export function tasksReady(workspaceId: string): boolean {
  return readyTaskWorkspaces.has(workspaceId);
}

function bumpTasks(): void {
  taskVersion++;
  taskListeners.forEach((l) => l());
}

function putTask(t: Task): void {
  const prev = taskMap.get(t.id);
  if (prev && prev.updatedAt > t.updatedAt) return;
  taskMap.set(t.id, t);
  bumpTasks();
}

/**
 * Tasks seen working during this session and not started by a routine are the ones the user just started.
 * Tasks restored from history never pass through here while active, so they never auto-open their results.
 */
const startedThisSession = new Set<string>();
const announcedResults = new Set<string>();
const resultsListeners = new Set<(task: Task) => void>();

function onTaskEvent(t: Task): void {
  if ((isActive(t.state) || t.state === "clarifying" || t.state === "waiting") && !t.routineRunId) startedThisSession.add(t.id);
  putTask(t);
  const done = t.state === "review" || t.state === "complete";
  if (done && t.outputs.length > 0 && startedThisSession.has(t.id) && !announcedResults.has(t.id)) {
    announcedResults.add(t.id);
    resultsListeners.forEach((l) => l(t));
  }
}

/** Calls back once when a task the user started in this session finishes with files to show. */
export function onResultsReady(cb: (task: Task) => void): () => void {
  resultsListeners.add(cb);
  return () => resultsListeners.delete(cb);
}

const changeMap = new Map<string, ChangeProposal>();
let changeVersion = 0;
const changeListeners = new Set<() => void>();
let changesLoaded = false;

function bumpChanges(): void {
  changeVersion++;
  changeListeners.forEach((l) => l());
}

let started = false;

/** Loads app state once and wires the push events that keep every store live. Safe to call repeatedly. */
export function startBridge(): void {
  if (started) return;
  started = true;
  void refreshAppState().catch(() => undefined);
  api.on("settings:updated", (settings) => {
    if (appState) setAppState({ ...appState, settings });
  });
  api.on("runtime:status", (runtime) => {
    if (appState) setAppState({ ...appState, runtime });
  });
  api.on("providers:updated", (providers) => {
    if (appState) setAppState({ ...appState, providers });
  });
  api.on("gmail:updated", (gmail) => {
    if (appState) setAppState({ ...appState, gmail });
  });
  wireChat();
  api.on("task:updated", onTaskEvent);
  api.on("change:updated", (c) => {
    changeMap.set(c.id, c);
    bumpChanges();
  });
}

export function useEvent<K extends EventName>(event: K, cb: (payload: Events[K]) => void): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => api.on(event, (p) => ref.current(p)), [event]);
}

export function loadTasks(workspaceId: string): Promise<void> {
  loadedTaskWorkspaces.add(workspaceId);
  return api.call("task:list", { workspaceId }, { silent: true }).then(
    (list) => {
      list.forEach((t) => {
        const prev = taskMap.get(t.id);
        if (!prev || prev.updatedAt <= t.updatedAt) taskMap.set(t.id, t);
      });
      readyTaskWorkspaces.add(workspaceId);
      bumpTasks();
    },
    () => {
      loadedTaskWorkspaces.delete(workspaceId);
    },
  );
}

function useTaskVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      taskListeners.add(cb);
      return () => taskListeners.delete(cb);
    },
    () => taskVersion,
  );
}

/** Newest first. Loads the workspace's tasks the first time it is asked for. */
export function useTasks(workspaceId: string | null): Task[] {
  const v = useTaskVersion();
  useEffect(() => {
    if (workspaceId && !loadedTaskWorkspaces.has(workspaceId)) void loadTasks(workspaceId);
  }, [workspaceId]);
  return useMemo(
    () =>
      [...taskMap.values()]
        .filter((t) => workspaceId == null || t.workspaceId === workspaceId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [v, workspaceId],
  );
}

/** All tasks across workspaces, for the sidebar's "working" dots. */
export function useAllTasks(workspaceIds: string[]): Task[] {
  const v = useTaskVersion();
  const key = workspaceIds.join("|");
  useEffect(() => {
    workspaceIds.forEach((id) => {
      if (!loadedTaskWorkspaces.has(id)) void loadTasks(id);
    });
  }, [key]);
  return useMemo(() => [...taskMap.values()], [v]);
}

export function useTask(id: string | undefined): Task | null {
  const v = useTaskVersion();
  const known = id ? taskMap.get(id) : undefined;
  useEffect(() => {
    if (id && !taskMap.has(id)) {
      void api.call("task:get", { id }, { silent: true }).then((t) => {
        if (t) putTask(t);
      });
    }
  }, [id]);
  // v is read so the component re-renders when any task changes.
  void v;
  return known ?? null;
}

export function useChanges(workspaceId: string | null): ChangeProposal[] {
  const v = useSyncExternalStore(
    (cb) => {
      changeListeners.add(cb);
      return () => changeListeners.delete(cb);
    },
    () => changeVersion,
  );
  useEffect(() => {
    if (changesLoaded) return;
    changesLoaded = true;
    void api.call("change:list", {}, { silent: true }).then(
      (list) => {
        list.forEach((c) => changeMap.set(c.id, c));
        bumpChanges();
      },
      () => {
        changesLoaded = false;
      },
    );
  }, []);
  return useMemo(
    () => [...changeMap.values()].filter((c) => workspaceId == null || c.workspaceId === workspaceId),
    [v, workspaceId],
  );
}

// ---------------------------------------------------------------- chat

const chatMap = new Map<string, ChatEntry[]>();
const chatLoaded = new Set<string>();
let chatVersion = 0;
const chatListeners = new Set<() => void>();
let chatWired = false;

function bumpChat(): void {
  chatVersion++;
  chatListeners.forEach((l) => l());
}

function mergeEntries(workspaceId: string, incoming: ChatEntry[]): void {
  const cur = chatMap.get(workspaceId) ?? [];
  const byId = new Map(cur.map((e) => [e.id, e]));
  incoming.forEach((e) => byId.set(e.id, e));
  chatMap.set(
    workspaceId,
    [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)),
  );
  bumpChat();
}

// Replies being written right now, keyed by entry id. The final chat:entry with the same id ends the stream.
interface Stream {
  entryId: string;
  workspaceId: string;
  text: string;
}
const streams = new Map<string, Stream>();
let streamVersion = 0;
const streamListeners = new Set<() => void>();

function bumpStreams(): void {
  streamVersion++;
  streamListeners.forEach((l) => l());
}

function endStreams(workspaceId: string): void {
  let any = false;
  for (const [id, s] of streams) {
    if (s.workspaceId === workspaceId) {
      streams.delete(id);
      any = true;
    }
  }
  if (any) bumpStreams();
}

function wireChat(): void {
  if (chatWired) return;
  chatWired = true;
  api.on("chat:delta", (d) => {
    const cur = streams.get(d.entryId);
    streams.set(d.entryId, { entryId: d.entryId, workspaceId: d.workspaceId, text: (cur?.text ?? "") + d.text });
    bumpStreams();
  });
  api.on("chat:entry", (e) => {
    mergeEntries(e.workspaceId, [e]);
    if (streams.delete(e.id)) bumpStreams();
  });
}

function useStreamVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      streamListeners.add(cb);
      return () => streamListeners.delete(cb);
    },
    () => streamVersion,
  );
}

/** How many companion replies are being written right now, in any project. Drives Non's talking state. */
export function useStreamingCount(): number {
  useStreamVersion();
  return streams.size;
}

export interface ChatApi {
  entries: ChatEntry[];
  loading: boolean;
  sending: { text: string; files: string[]; since: string } | null;
  /** The reply being written for this project, if any. */
  streaming: { entryId: string; text: string } | null;
  send(text: string, files?: string[]): Promise<boolean>;
  stop(): void;
}

export function useChat(workspaceId: string | null): ChatApi {
  const v = useSyncExternalStore(
    (cb) => {
      chatListeners.add(cb);
      return () => chatListeners.delete(cb);
    },
    () => chatVersion,
  );
  const sv = useStreamVersion();
  const [sending, setSending] = useState<ChatApi["sending"]>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    wireChat();
    if (!workspaceId || chatLoaded.has(workspaceId)) return;
    chatLoaded.add(workspaceId);
    setLoading(true);
    void api
      .call("chat:history", { workspaceId }, { silent: true })
      .then((list) => mergeEntries(workspaceId, list))
      .catch(() => chatLoaded.delete(workspaceId))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const send = useCallback(
    async (text: string, files?: string[]) => {
      if (!workspaceId) return false;
      setSending({ text, files: files ?? [], since: new Date().toISOString() });
      try {
        const added = await api.call("chat:send", { workspaceId, text, files });
        mergeEntries(workspaceId, added);
        return true;
      } catch {
        return false;
      } finally {
        // Whatever happened, no reply is still being written once the call is over.
        endStreams(workspaceId);
        setSending(null);
      }
    },
    [workspaceId],
  );

  const stop = useCallback(() => {
    if (workspaceId) void api.call("chat:stop", { workspaceId }, { silent: true }).catch(() => undefined);
  }, [workspaceId]);

  const streaming = useMemo(() => {
    for (const s of streams.values()) if (s.workspaceId === workspaceId) return { entryId: s.entryId, text: s.text };
    return null;
  }, [sv, workspaceId]);

  const entries = useMemo(
    () => (workspaceId ? (chatMap.get(workspaceId) ?? []) : []),
    [v, workspaceId],
  );
  return { entries, loading, sending, streaming, send, stop };
}

// ---------------------------------------------------------------- procedures

const procCache = new Map<PackId, ProcedureInfo[]>();

export function useProcedures(pack: PackId | null): ProcedureInfo[] {
  // Keyed by pack so a workspace switch never shows the previous pack's list while the new one loads.
  const [fetched, setFetched] = useState<{ pack: PackId; list: ProcedureInfo[] } | null>(null);
  useEffect(() => {
    if (!pack) return;
    let alive = true;
    void api.call("procedure:list", { pack }, { silent: true }).then(
      (res) => {
        procCache.set(pack, res);
        if (alive) setFetched({ pack, list: res });
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [pack]);
  if (!pack) return [];
  return fetched?.pack === pack ? fetched.list : (procCache.get(pack) ?? []);
}
