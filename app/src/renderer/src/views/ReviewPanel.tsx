import { useCallback, useMemo } from "react";

import type { ChangeProposal, Task } from "../../../shared/contracts";
import { useCall, useEvent } from "./lib";
import { ErrorLine, Loading } from "./ui";
import { ProposalCard } from "./review/ProposalCard";
import { ResultsCard } from "./review/ResultsCard";
import { Icon } from "../components/Icon";

export interface ReviewPanelProps {
  workspaceId: string;
  /** Show only this task's changes and results when set. */
  taskId?: string | null;
  onClose: () => void;
}

const ORDER: Record<string, number> = { staged: 0, applying: 0, partial: 1, failed: 1, stale: 1, applied: 2, recovered: 3, rejected: 4 };

export function ReviewPanel({ workspaceId, taskId, onClose }: ReviewPanelProps) {
  const changes = useCall("change:list", { workspaceId, taskId: taskId ?? undefined });
  const task = useCall("task:get", { id: taskId ?? "" }, Boolean(taskId));

  const matches = useCallback((p: ChangeProposal) => p.workspaceId === workspaceId && (!taskId || p.taskId === taskId), [workspaceId, taskId]);

  useEvent("change:updated", (p) => {
    if (!matches(p)) return;
    changes.setData((prev) => {
      const list = prev ?? [];
      return list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];
    });
  });
  useEvent("task:updated", (t: Task) => {
    if (taskId && t.id === taskId) task.setData(t);
  });

  const updateOne = (p: ChangeProposal) => changes.setData((prev) => (prev ?? []).map((x) => (x.id === p.id ? p : x)));

  const sorted = useMemo(
    () => [...(changes.data ?? [])].sort((a, b) => (ORDER[a.status] ?? 5) - (ORDER[b.status] ?? 5) || b.createdAt.localeCompare(a.createdAt)),
    [changes.data],
  );
  const waiting = sorted.filter((p) => p.status === "staged").length;

  return (
    <aside
      className="flex h-full min-h-0 flex-col"
      style={{ background: "var(--bg)", borderLeft: "1px solid var(--line)" }}
      aria-label="Changes to check"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement)) onClose();
      }}
    >
      <header className="flex items-start justify-between gap-3 px-6 pb-3 pt-6">
        <div>
          <h2 style={{ fontSize: 24 }}>Changes to check</h2>
          <p className="m-0 mt-1 text-[14px] muted" aria-live="polite">
            {changes.loading
              ? "Looking for changes..."
              : sorted.length === 0
                ? "Nothing to check right now."
                : waiting > 0
                  ? `${waiting} ${waiting === 1 ? "change is" : "changes are"} waiting. Your files stay the same until you say OK.`
                  : "Nothing is waiting for your OK."}
          </p>
        </div>
        <button type="button" className="btn btn-ghost !p-2" onClick={onClose} aria-label="Close">
          <Icon name="close" size={20} tone="current" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-8 pt-2">
        {task.data && <ResultsCard task={task.data} />}

        {changes.loading && <Loading />}
        {changes.error && <ErrorLine>{changes.error}</ErrorLine>}

        {!changes.loading && !changes.error && sorted.length === 0 && (
          <div className="panel p-5 text-[14.5px]">
            <strong>No changes to check.</strong>
            <p className="m-0 mt-1 muted">
              When NONON wants to change one of your files, it shows the change here first. Nothing changes until you say OK.
            </p>
          </div>
        )}

        {sorted.map((p) => (
          <ProposalCard key={p.id} proposal={p} taskTitle={task.data?.title} onUpdate={updateOne} />
        ))}
      </div>
    </aside>
  );
}
