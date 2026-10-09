import { useState } from "react";
import { Clock, ExternalLink, Hourglass } from "lucide-react";
import { api, useChanges, useTask } from "../lib/bridge";
import { baseName, isActive, plainError, stateLabel } from "../lib/format";
import { Markdown } from "../lib/markdown";
import { Icon } from "../components/Icon";
import { CheckList, FileIcon, Spinner } from "../components/ui";
import { InlinePreview } from "../results/InlinePreview";
import { primaryOutput } from "../results/usePreview";
import { QuestionForm } from "./QuestionForm";

const MAX_STEPS = 5;

/** Task card shown inline in the conversation. Bound to a task id and live through task:updated. */
export function TaskCard({ taskId, onReview, onViewResults }: { taskId: string; onReview: (taskId: string) => void; onViewResults: (taskId: string, path?: string) => void }) {
  const task = useTask(taskId);
  const changes = useChanges(task?.workspaceId ?? null);
  const [showAll, setShowAll] = useState(false);
  const [retrying, setRetrying] = useState(false);

  if (!task) {
    return (
      <div className="task-card" role="status">
        <div className="task-head">
          <Spinner />
          <span className="muted">Loading...</span>
        </div>
      </div>
    );
  }

  const active = isActive(task.state);
  const primary = primaryOutput(task.outputs);
  const staged = changes.filter((c) => c.taskId === task.id && c.status === "staged").length;
  const steps = showAll ? task.steps : task.steps.slice(-MAX_STEPS);
  const hidden = task.steps.length - steps.length;
  const tone = task.state === "needs-attention" || task.state === "failed" ? "attn" : task.state === "review" || task.state === "complete" ? "ok" : task.state === "clarifying" ? "info" : "";

  const openFile = (path: string) => void api.call("shell:open", { path }).catch(() => undefined);

  async function resume() {
    setRetrying(true);
    try {
      await api.call("task:resume", { id: taskId });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <section className={`task-card ${tone ? `task-${tone}` : ""}`} aria-label={`Task: ${task.title}`} aria-live="polite">
      <header className="task-head">
        <span className="task-icon" aria-hidden="true">
          {active ? <Spinner size={18} /> : task.state === "complete" ? <Icon name="check" size={20} tone="current" /> : task.state === "review" ? <Icon name="review" size={20} tone="current" /> : task.state === "clarifying" ? <Icon name="info" size={20} tone="current" /> : task.state === "waiting" ? <Hourglass size={18} /> : task.state === "interrupted" ? <Icon name="stop" size={18} tone="current" /> : <Icon name="alert" size={20} tone="current" />}
        </span>
        <h3 className="task-title">{task.title}</h3>
        <span className={`chip ${tone ? `chip-${tone}` : ""}`}>{stateLabel(task.state)}</span>
      </header>

      {task.steps.length > 0 && task.state !== "review" && task.state !== "complete" && task.state !== "waiting" && (
        <ol className="task-steps">
          {hidden > 0 && (
            <li className="step-more">
              <button type="button" className="btn-link" onClick={() => setShowAll(true)}>
                Show {hidden} earlier {hidden === 1 ? "step" : "steps"}
              </button>
            </li>
          )}
          {steps.map((s, i) => {
            const running = active && i === steps.length - 1;
            return (
              <li key={`${s.at}-${i}`} className={running ? "running" : "done"} style={{ "--i": i % 5 } as React.CSSProperties}>
                <span className="step-mark" aria-hidden="true">
                  {running ? <Spinner size={14} /> : <Icon name="check" size={14} tone="current" />}
                </span>
                <span>
                  {s.label}
                  {s.detail && <span className="muted"> ({s.detail})</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {task.state === "clarifying" && task.questions.length > 0 && (
        <QuestionForm
          questions={task.questions}
          onSubmit={async (answers, remember) => {
            await api.call("task:answer", { id: task.id, answers, remember });
          }}
        />
      )}

      {task.state === "waiting" && (
        <div className="notice notice-info" role="status">
          <Clock size={18} aria-hidden="true" />
          <div>
            <p className="notice-title">{task.waitingOn ? `Waiting for ${task.waitingOn.replace(/[.!?]+$/, "")}` : "Waiting for the built-in AI to finish setting up"}</p>
            <p className="muted">Your task is saved. It will start on its own.</p>
          </div>
        </div>
      )}

      {(task.state === "needs-attention" || task.state === "failed") && (
        <div className="notice notice-attn" role="alert">
          <Icon name="alert" size={20} tone="current" />
          <div>
            <p className="notice-title">{task.state === "failed" ? "This task could not be finished." : "This task needs a look from you."}</p>
            <p className="muted">{task.error ? plainError(task.error) : "Something went wrong. You can try again."}</p>
            <button type="button" className="btn" onClick={() => void resume()} disabled={retrying}>
              {retrying ? <Spinner /> : <Icon name="restore" size={16} tone="current" />} Try again
            </button>
          </div>
        </div>
      )}

      {task.state === "interrupted" && (
        <div className="notice" role="status">
          <Icon name="stop" size={18} tone="current" />
          <div>
            <p className="notice-title">Stopped.</p>
            <p className="muted">Nothing was changed. You can carry on from where it stopped.</p>
            <button type="button" className="btn" onClick={() => void resume()} disabled={retrying}>
              <Icon name="restore" size={16} tone="current" /> Carry on
            </button>
          </div>
        </div>
      )}

      {task.state === "rejected" && <p className="muted">You said no to these changes. Your files were not touched.</p>}

      {(task.state === "review" || task.state === "complete" || task.state === "applying") && (
        <div className="task-result">
          {task.summary && <Markdown text={task.summary} />}
          {primary && <InlinePreview output={primary} version={task.updatedAt} onExpand={() => onViewResults(task.id, primary.path)} onOpen={() => openFile(primary.path)} />}
          {task.outputs.length > 0 && (
            <div className="result-chips" aria-label="Files NONON made">
              {task.outputs.map((o) => {
                const name = baseName(o.path);
               return (
                  <button key={o.path} type="button" className="result-chip" onClick={() => onViewResults(task.id, o.path)} title={name} aria-label={`View ${o.label}`}>
                    <FileIcon name={name} size={18} />
                    <span>{o.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          <CheckList checks={task.checks} />
          {(primary || task.state === "review") && (
            <div className="task-actions">
              {primary && (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => onViewResults(task.id, primary.path)}>
                    <Icon name="review" size={18} tone="current" />
                    View results
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => openFile(primary.path)}>
                    <ExternalLink size={15} aria-hidden="true" />
                    Open the file
                  </button>
                </>
              )}
              {task.state === "review" && (
                <button type="button" className={`btn ${primary ? "" : "btn-primary"}`} onClick={() => onReview(task.id)}>
                  <Icon name="review" size={18} />
                  Changes to check{staged > 0 ? ` (${staged})` : ""}
                </button>
              )}
              {task.state === "review" && <span className="muted small">Nothing in your files changes until you say OK.</span>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
