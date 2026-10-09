import { useEffect, useState } from "react";

import type { MissedRunPolicy, Routine } from "../../../shared/contracts";
import { api } from "../lib/bridge";
import { aiLabel } from "../lib/format";
import { Spinner } from "../components/ui";
import { Icon } from "../components/Icon";

const ACTION_TEXT: Record<Routine["allowedActions"][number], string> = {
  "read-files": "Read files in the folder",
  "write-outputs": "Save what it makes in the NONON Output folder",
  "read-mail": "Read email (never send or delete)",
};

const PRESETS = [
  { cron: "0 8 * * 1-5", humanText: "Every weekday at 8:00 AM" },
  { cron: "0 8 * * *", humanText: "Every day at 8:00 AM" },
  { cron: "0 16 * * 5", humanText: "Every Friday at 4:00 PM" },
  { cron: "0 9 * * 1", humanText: "Every Monday at 9:00 AM" },
];

const MISSED_TEXT: Record<MissedRunPolicy, string> = {
  "catch-up-once": "Run it once when the computer is back on",
  skip: "Skip it",
};

function dismissedKey(id: string): string {
  return `nonon.routine.dismissed.${id}`;
}

function wasDismissed(id: string): boolean {
  try {
    return window.localStorage.getItem(dismissedKey(id)) === "1";
  } catch {
    return false;
  }
}

/** Nothing is saved until the person confirms; the card says so and shows every setting that matters. */
export function RoutineCard({ routine }: { routine: Routine }) {
  const [draft, setDraft] = useState<Routine>(routine);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dismissed, setDismissed] = useState(() => wasDismissed(routine.id));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void api.call("routine:list", { workspaceId: routine.workspaceId }, { silent: true }).then(
      (list) => alive && setSaved(list.some((r) => r.id === routine.id)),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [routine.id, routine.workspaceId]);

  if (dismissed) {
    return <p className="muted small routine-note">You chose not to save this routine.</p>;
  }

  const outputDir = `${draft.inputScope.folder.replace(/[\\/]+$/, "")}${draft.inputScope.folder.includes("/") ? "/" : "\\"}NONON Output`;
  const presets = PRESETS.some((p) => p.cron === draft.schedule.cron) ? PRESETS : [{ cron: draft.schedule.cron, humanText: draft.schedule.humanText }, ...PRESETS];

  async function confirm() {
    setBusy(true);
    try {
      await api.call("routine:save", { routine: draft });
      setSaved(true);
      setEditing(false);
    } catch {
      /* the toast already explained */
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    try {
      window.localStorage.setItem(dismissedKey(routine.id), "1");
    } catch {
      /* private mode: dismissal just lasts until reload */
    }
    setDismissed(true);
  }

  return (
    <section className="routine-card" aria-label={`Suggested routine: ${draft.title}`}>
      <header className="task-head">
        <span className="task-icon" aria-hidden="true">
          {saved ? <Icon name="check" size={20} tone="current" /> : <Icon name="calendar" size={20} tone="accent" />}
        </span>
        <h3 className="task-title">{draft.title}</h3>
        <span className={`chip ${saved ? "chip-ok" : "chip-info"}`}>{saved ? "Saved" : "Not saved yet"}</span>
      </header>
      <p className="muted">{draft.description}</p>

      {editing ? (
        <div className="routine-edit">
          <label className="field">
            <span>Name</span>
            <input className="input" value={draft.title} maxLength={60} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label className="field">
            <span>When</span>
            <select
              className="input"
              value={draft.schedule.cron}
              onChange={(e) => {
                const p = presets.find((x) => x.cron === e.target.value);
                if (p) setDraft({ ...draft, schedule: { ...draft.schedule, cron: p.cron, humanText: p.humanText } });
              }}
            >
              {presets.map((p) => (
                <option key={p.cron} value={p.cron}>
                  {p.humanText}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>If the computer is off at that time</span>
            <select className="input" value={draft.missedRun} onChange={(e) => setDraft({ ...draft, missedRun: e.target.value as MissedRunPolicy })}>
              {(Object.keys(MISSED_TEXT) as MissedRunPolicy[]).map((k) => (
                <option key={k} value={k}>
                  {MISSED_TEXT[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <dl className="routine-rows">
          <dt>When</dt>
          <dd>
            {draft.schedule.humanText} <span className="muted">({draft.schedule.timezone})</span>
          </dd>
          <dt>Works in</dt>
          <dd className="break">{draft.inputScope.folder}</dd>
          <dt>Results go to</dt>
          <dd className="break">{outputDir}</dd>
          <dt>It is allowed to</dt>
          <dd>
            <ul>
              {draft.allowedActions.map((a) => (
                <li key={a}>{ACTION_TEXT[a]}</li>
              ))}
            </ul>
          </dd>
          <dt>AI used</dt>
          <dd>{aiLabel(draft.location.ai)}</dd>
          <dt>If the computer is off</dt>
          <dd>{MISSED_TEXT[draft.missedRun]}</dd>
        </dl>
      )}

      {saved ? (
        <p className="muted small">Saved. You can pause or remove it any time in Routines.</p>
      ) : (
        <div className="task-actions">
          <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={busy || !draft.title.trim()}>
            {busy && <Spinner />}
            Save routine
          </button>
          {!editing && (
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={editing ? () => (setDraft(routine), setEditing(false)) : cancel}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
