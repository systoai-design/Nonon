import { useState } from "react";

import type { Routine, RoutineRun } from "../../../../shared/contracts";
import { call, errMsg, formatDateTime, useEvent } from "../lib";
import { ConfirmButton, ErrorLine, Spinner, Switch } from "../ui";
import { ACTION_WORDS, AI_WHERE, MISSED_WORDS, RUN_STATUS, TRIGGER_WORDS } from "./words";
import { Icon } from "../../components/Icon";

function RunRow({ run }: { run: RoutineRun }) {
  const s = RUN_STATUS[run.status];
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13.5px]">
      <span className={`chip ${s.tone}`}>{s.label}</span>
      <span>{formatDateTime(run.startedAt)}</span>
      <span className="muted">{TRIGGER_WORDS[run.trigger]}</span>
      {run.detail && (
        <span className="basis-full" style={{ color: run.status === "failed" ? "var(--red)" : "var(--muted)" }}>
          {run.status === "failed" ? "Why: " : ""}
          {run.status === "failed" ? errMsg(run.detail) : run.detail}
        </span>
      )}
      {run.status === "needs-review" && <span className="basis-full muted">The result is waiting for you in your project. Nothing in your files has changed yet.</span>}
      {run.status === "waiting-for-input" && <span className="basis-full muted">NONON needs an answer from you before it can finish.</span>}
    </li>
  );
}

export function RoutineCard({
  routine,
  procedureTitle,
  onChanged,
  onRemoved,
}: {
  routine: Routine;
  procedureTitle?: string;
  onChanged: (r: Routine) => void;
  onRemoved: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RoutineRun[] | null>(null);
  const [busy, setBusy] = useState<null | "toggle" | "run">(null);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = () =>
    call("routine:runs", { routineId: routine.id, limit: 10 })
      .then(setRuns)
      .catch((e) => setError(errMsg(e)));

  useEvent("routine:run", (run) => {
    if (run.routineId !== routine.id) return;
    setRuns((prev) => (prev ? [run, ...prev.filter((r) => r.id !== run.id)] : prev));
  });

  const toggleHistory = () => {
    const next = !open;
    setOpen(next);
    if (next) void loadRuns();
  };

  const setEnabled = async (enabled: boolean) => {
    setBusy("toggle");
    setError(null);
    try {
      onChanged(await call("routine:set-enabled", { id: routine.id, enabled }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    setBusy("run");
    setError(null);
    try {
      const run = await call("routine:run-now", { id: routine.id });
      setRuns((prev) => [run, ...(prev ?? []).filter((r) => r.id !== run.id)]);
      setOpen(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setError(null);
    try {
      await call("routine:remove", { id: routine.id });
      onRemoved(routine.id);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const last = routine.lastRunStatus ? RUN_STATUS[routine.lastRunStatus] : null;
  const regionId = `runs-${routine.id}`;

  return (
    <article className="card p-5" aria-label={routine.title}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3>{routine.title}</h3>
          {routine.description && <p className="m-0 mt-1 text-[14px] muted">{routine.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[13.5px]">
          <span className="muted" aria-hidden>
            {routine.enabled ? "On" : "Paused"}
          </span>
          <Switch checked={routine.enabled} onChange={setEnabled} busy={busy === "toggle"} label={`${routine.title} is ${routine.enabled ? "on" : "paused"}`} />
        </div>
      </div>

      <dl className="m-0 mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
        <dt className="flex items-center gap-1.5 muted">
          <Icon name="calendar" size={17} tone="accent" /> When
        </dt>
        <dd className="m-0">
          {routine.schedule.humanText} <span className="muted">({routine.schedule.timezone})</span>
        </dd>

        <dt className="muted">Next run</dt>
        <dd className="m-0">{routine.enabled ? (routine.nextDueAt ? formatDateTime(routine.nextDueAt) : "Not scheduled yet") : "Paused. It will not run."}</dd>

        <dt className="muted">Last run</dt>
        <dd className="m-0 flex flex-wrap items-center gap-2">
          {last && routine.lastRunAt ? (
            <>
              <span className={`chip ${last.tone}`}>{last.label}</span>
              <span className="muted">{formatDateTime(routine.lastRunAt)}</span>
            </>
          ) : (
            <span className="muted">Has not run yet</span>
          )}
        </dd>

        <dt className="flex items-center gap-1.5 muted">
          <Icon name="device" size={17} tone="accent" /> Where
        </dt>
        <dd className="m-0">
          AI: {AI_WHERE[routine.location.ai]} <span className="muted">&middot;</span> Files: This computer
        </dd>

        <dt className="flex items-center gap-1.5 muted">
          <Icon name="folder" size={17} tone="accent" /> Folder
        </dt>
        <dd className="m-0 break-all">{routine.inputScope.folder}</dd>

        {procedureTitle && (
          <>
            <dt className="muted">Does</dt>
            <dd className="m-0">{procedureTitle}</dd>
          </>
        )}

        <dt className="muted">Allowed to</dt>
        <dd className="m-0">
          <ul className="m-0 list-none p-0">
            {routine.allowedActions.map((a) => (
              <li key={a}>{ACTION_WORDS[a]}</li>
            ))}
            <li className="muted">Never sends, deletes or runs commands</li>
          </ul>
        </dd>

        <dt className="muted">If the computer was off</dt>
        <dd className="m-0">{MISSED_WORDS[routine.missedRun]}</dd>
      </dl>

      {error && (
        <div className="mt-3">
          <ErrorLine>{error}</ErrorLine>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn" onClick={runNow} disabled={busy === "run"}>
          {busy === "run" ? <Spinner /> : <Icon name="play" size={17} tone="current" />} Run now
        </button>
        <button type="button" className="btn btn-ghost" onClick={toggleHistory} aria-expanded={open} aria-controls={regionId}>
          {open ? <Icon name="chevron-down" size={18} tone="current" /> : <Icon name="chevron-right" size={18} tone="current" />} Past runs
        </button>
        <span className="ml-auto">
          <ConfirmButton className="btn btn-ghost btn-danger" label="Remove" confirmLabel="Yes, remove this routine" onConfirm={remove} />
        </span>
      </div>

      {open && (
        <div id={regionId} className="mt-3 border-t pt-2" style={{ borderColor: "var(--line)" }}>
          {runs === null ? (
            <p className="m-0 py-2 text-[14px] muted">Loading past runs...</p>
          ) : runs.length === 0 ? (
            <p className="m-0 py-2 text-[14px] muted">No runs yet.</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-[color:var(--line)] p-0">
              {runs.map((r) => (
                <RunRow key={r.id} run={r} />
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
