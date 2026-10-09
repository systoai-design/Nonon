import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatEntry, Task, Workspace } from "../../../shared/contracts";
import { api, useAppState, useChat, useProcedures, useTasks } from "../lib/bridge";
import { formatTime, isActive } from "../lib/format";
import { Markdown } from "../lib/markdown";
import { Icon } from "../components/Icon";
import { Non } from "../components/Non";
import { useNonMood } from "../lib/companion";
import { motionOff } from "../lib/motion";
import { AttachmentChip } from "../components/ui";
import { Composer } from "./Composer";
import { ProcedureStarter, autoAssignFiles } from "./ProcedureStarter";
import { RoutineCard } from "./RoutineCard";
import { TaskCard } from "./TaskCard";

export interface StarterRequest {
  procedureId: string;
  files?: string[];
  nonce: number;
}

type Item = { kind: "entry"; at: string; entry: ChatEntry } | { kind: "task"; at: string; task: Task };

export function ConversationView({ workspace, starter, onStarterDone, onReview, onViewResults }: { workspace: Workspace; starter: StarterRequest | null; onStarterDone: () => void; onReview: (taskId: string) => void; onViewResults: (taskId: string, path?: string) => void }) {
  const app = useAppState();
  const settings = app?.settings;
  const companionName = settings?.companionName ?? "Non";
  const mood = useNonMood();

  const chat = useChat(workspace.id);
  const tasks = useTasks(workspace.id);
  const procedures = useProcedures(workspace.pack);
  const [attached, setAttached] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [localStarter, setLocalStarter] = useState<StarterRequest | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const dragDepth = useRef(0);

  useEffect(() => {
    if (starter) setLocalStarter(starter);
  }, [starter]);

  // Tasks started from a starter card have no chat entry; show them in time order too.
  const items = useMemo<Item[]>(() => {
    const linked = new Set(chat.entries.map((e) => e.taskId).filter(Boolean));
    const list: Item[] = chat.entries.map((entry) => ({ kind: "entry", at: entry.at, entry }));
    tasks.filter((t) => !linked.has(t.id)).forEach((task) => list.push({ kind: "task", at: task.createdAt, task }));
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [chat.entries, tasks]);

  const activity = tasks.map((t) => `${t.id}:${t.state}:${t.steps.length}`).join("|");
  const streamedLength = chat.streaming?.text.length ?? 0;
  // New items glide to the bottom; token-by-token growth follows instantly so the smooth scroll never lags behind the text.
  const lastCount = useRef(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    const grew = items.length !== lastCount.current;
    lastCount.current = items.length;
    el.scrollTo({ top: el.scrollHeight, behavior: grew && !motionOff() && lastCount.current > 1 ? "smooth" : "auto" });
  }, [items.length, activity, chat.sending, chat.streaming?.entryId, streamedLength, localStarter]);

  // Only items that arrive after the conversation has loaded animate in; the history that was already there just appears.
  const known = useRef<Set<string> | null>(null);
  const born = useRef<Set<string>>(new Set());
  const keyOf = (i: Item) => (i.kind === "entry" ? `e:${i.entry.id}` : `t:${i.task.id}`);
  if (known.current === null && !chat.loading) known.current = new Set(items.map(keyOf));
  // The in-flight bubbles already animated in; the saved entry that replaces them must not play the entrance a second time.
  const sendingAt = useRef(0);
  if (chat.sending) sendingAt.current = Date.now();
  const isNew = (i: Item) => {
    const k = keyOf(i);
    if (known.current && !known.current.has(k)) {
      if (i.kind === "task" || Date.now() - sendingAt.current > 2500) born.current.add(k);
      known.current.add(k);
    }
    return born.current.has(k);
  };

  const addFiles = (paths: string[]) => setAttached((cur) => [...new Set([...cur, ...paths])]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    if (paths.length) addFiles(paths);
  }

  const starterProc = localStarter ? procedures.find((p) => p.id === localStarter.procedureId) : undefined;
  const anyActive = tasks.some((t) => isActive(t.state));
  const chips = procedures.slice(0, 3);
  const empty = items.length === 0 && !chat.loading;

  return (
    <div
      className="convo"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <Icon name="upload" size={32} tone="current" />
          <strong>Drop files to add them</strong>
        </div>
      )}
      <div
        className="timeline"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="timeline-inner">
          {empty && (
            <div className="convo-empty">
              <Non state={mood.state} replayKey={mood.epoch} size={104} />
              <h2>Hi, I&apos;m {companionName}.</h2>
              <p className="muted small">{mood.status}</p>
              <p className="muted">Tell me what you would like to do, or add some files. I will show you any change before it happens.</p>
            </div>
          )}

          {items.map((item) =>
            item.kind === "entry" ? (
              <EntryView key={item.entry.id} entry={item.entry} enter={isNew(item)} companionName={companionName} onReview={onReview} onViewResults={onViewResults} />
            ) : (
              <div className={`msg msg-companion ${isNew(item) ? "msg-enter" : ""}`} key={item.task.id}>
                <Non size={40} still />
                <div className="msg-body">
                  <TaskCard taskId={item.task.id} onReview={onReview} onViewResults={onViewResults} />
                </div>
              </div>
            ),
          )}

          {chat.sending && !chat.entries.some((e) => e.role === "user" && e.at >= chat.sending!.since) && (
            <div className="msg msg-user msg-enter">
              <div className="msg-body">
                <div className="bubble bubble-user">{chat.sending.text}</div>
              </div>
            </div>
          )}
          {chat.sending && (
            <div className="msg msg-companion msg-enter" role="status">
              <Non state={chat.streaming ? "talking" : "thinking"} size={40} />
              <div className="msg-body">
                {chat.streaming ? (
                  <div className="bubble bubble-companion">
                    <Markdown text={chat.streaming.text} />
                  </div>
                ) : (
                  <div className="bubble bubble-companion typing">
                    <span aria-hidden="true" />
                    <span aria-hidden="true" />
                    <span aria-hidden="true" />
                    <span className="typing-label">{companionName} is working on it</span>
                  </div>
                )}
                {chat.streaming && <span className="stamp">{companionName} is writing a reply</span>}
              </div>
            </div>
          )}

          {localStarter && starterProc && (
            <div className="msg msg-companion">
              <Non size={40} still />
              <div className="msg-body">
                <ProcedureStarter
                  key={localStarter.nonce}
                  procedure={starterProc}
                  workspaceId={workspace.id}
                  initialFiles={localStarter.files ? autoAssignFiles(starterProc, localStarter.files) : undefined}
                  onClose={() => {
                    setLocalStarter(null);
                    onStarterDone();
                  }}
                  onStarted={() => {
                    setLocalStarter(null);
                    onStarterDone();
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="convo-foot">
        <div className="convo-foot-inner">
          {!anyActive && !localStarter && (
            <div className="suggestions" aria-label="Ideas">
              <button type="button" className="suggest" onClick={() => void api.call("workspace:pick-files", {}).then((p) => p.length && addFiles(p))}>
                <Icon name="plus" size={18} /> Add files
              </button>
              {chips.map((p) => (
                <button key={p.id} type="button" className="suggest" onClick={() => setLocalStarter({ procedureId: p.id, nonce: Date.now() })} title={p.summary}>
                  {p.title}
                </button>
              ))}
              <button type="button" className="suggest" onClick={() => setPrefill({ text: "Every weekday at 8 AM, ", nonce: Date.now() })}>
                Set up a routine
              </button>
            </div>
          )}
          <Composer
            placeholder={`Tell ${companionName} what you need...`}
            attached={attached}
            sending={chat.sending !== null}
            prefill={prefill}
            onAttach={addFiles}
            onStop={chat.stop}
            onRemove={(p) => setAttached((cur) => cur.filter((x) => x !== p))}
            onSend={async (text) => {
              stick.current = true;
              const ok = await chat.send(text, attached);
              if (ok) setAttached([]);
              return ok;
            }}
          />
        </div>
      </div>
    </div>
  );
}

function EntryView({ entry, enter, companionName, onReview, onViewResults }: { entry: ChatEntry; enter: boolean; companionName: string; onReview: (taskId: string) => void; onViewResults: (taskId: string, path?: string) => void }) {
  if (entry.role === "system") {
    return (
      <div className="msg-system muted small" role="note">
        {entry.text}
      </div>
    );
  }
  if (entry.role === "user") {
    return (
      <div className={`msg msg-user ${enter ? "msg-enter" : ""}`}>
        <div className="msg-body">
          <div className="bubble bubble-user">{entry.text}</div>
          {entry.attachments && entry.attachments.length > 0 && (
            <div className="attached attached-right">
              {entry.attachments.map((a) => (
                <AttachmentChip key={a.path} path={a.path} name={a.name} />
              ))}
            </div>
          )}
          <time className="stamp" dateTime={entry.at}>
            {formatTime(entry.at)}
          </time>
        </div>
      </div>
    );
  }
  return (
    <div className={`msg msg-companion ${enter ? "msg-enter" : ""}`}>
      <Non size={40} still label={companionName} />
      <div className="msg-body">
        {entry.text && (
          <div className="bubble bubble-companion">
            <Markdown text={entry.text} />
          </div>
        )}
        {entry.routine && <RoutineCard routine={entry.routine} />}
        {entry.taskId && <TaskCard taskId={entry.taskId} onReview={onReview} onViewResults={onViewResults} />}
        <time className="stamp" dateTime={entry.at}>
          {formatTime(entry.at)}
        </time>
      </div>
    </div>
  );
}
