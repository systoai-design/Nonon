import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { Routine } from "../../../../shared/contracts";
import { call, errMsg } from "../lib";
import { ErrorLine, Spinner } from "../ui";
import { buildCron, DAY_SHORT, humanSchedule, parseCron, type SimpleSchedule } from "./schedule";
import { ACTION_WORDS, AI_WHERE } from "./words";

const pad = (n: number) => String(n).padStart(2, "0");

function Confirmation({
  initial,
  procedureTitle,
  onSaved,
  onCancel,
}: {
  initial: Routine;
  procedureTitle?: string;
  onSaved: (r: Routine) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const parsed = parseCron(initial.schedule.cron);
  const [sched, setSched] = useState<SimpleSchedule | null>(parsed);
  const [folder, setFolder] = useState(initial.inputScope.folder);
  const [writeOutputs, setWriteOutputs] = useState(initial.allowedActions.includes("write-outputs"));
  const [missed, setMissed] = useState(initial.missedRun);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: number) => {
    if (!sched) return;
    const has = sched.days.includes(d);
    if (has && sched.days.length === 1) return;
    setSched({ ...sched, days: has ? sched.days.filter((x) => x !== d) : [...sched.days, d].sort((a, b) => a - b) });
  };

  const pickFolder = async () => {
    try {
      const f = await call("workspace:pick-folder", undefined);
      if (f) setFolder(f);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const others = initial.allowedActions.filter((a) => a !== "write-outputs");
    const routine: Routine = {
      ...initial,
      title: title.trim() || initial.title,
      inputScope: { ...initial.inputScope, folder },
      schedule: sched
        ? { cron: buildCron(sched), timezone: initial.schedule.timezone, humanText: humanSchedule(sched) }
        : initial.schedule,
      allowedActions: writeOutputs ? [...others, "write-outputs"] : others,
      missedRun: missed,
      enabled: true,
    };
    try {
      onSaved(await call("routine:save", { routine }));
    } catch (e) {
      setError(errMsg(e));
      setSaving(false);
    }
  };

  const pickLines = Object.entries(initial.inputScope.pick).map(([key, p]) => {
    const kinds = p.extensions.join(", ");
    const newest = p.newest === 1 ? "the newest file" : `the ${p.newest} newest files`;
    const what = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
    return `${what.charAt(0).toUpperCase()}${what.slice(1)}: ${newest} (${kinds})${p.nameContains ? ` with "${p.nameContains}" in the name` : ""}`;
  });

  return (
    <section className="card flex flex-col gap-5 p-5" aria-label="Confirm this routine">
      <div>
        <h3>Here is what I understood</h3>
        <p className="m-0 mt-1 text-[14px] muted">Check the details and change anything that is not right. Nothing runs until you save.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="nr-title" className="text-[14px] font-medium">
          Name
        </label>
        <input id="nr-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-[14px] font-medium">When</legend>
        {sched ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="nr-time" className="text-[14px] muted">
                Time
              </label>
              <input
                id="nr-time"
                type="time"
                className="input !w-auto"
                value={`${pad(sched.hour)}:${pad(sched.minute)}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  if (h !== undefined && m !== undefined && !Number.isNaN(h) && !Number.isNaN(m)) setSched({ ...sched, hour: h, minute: m });
                }}
              />
              <span className="text-[14px] muted">Time zone: {initial.schedule.timezone}</span>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Days of the week">
              {DAY_SHORT.map((d, i) => {
                const on = sched.days.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(i)}
                    className="rounded-full border px-3.5 py-1.5 text-[13.5px]"
                    style={on ? { background: "var(--accent-soft)", borderColor: "var(--accent)", color: "var(--accent-ink)", fontWeight: 600 } : { borderColor: "var(--line)", background: "var(--card)" }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <p className="m-0 text-[14px]">{humanSchedule(sched)}</p>
          </>
        ) : (
          <p className="m-0 text-[14px]">
            {initial.schedule.humanText} <span className="muted">({initial.schedule.timezone}). This timing cannot be edited here.</span>
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <span className="text-[14px] font-medium">Folder it reads from</span>
        <div className="flex items-center gap-3">
          <code className="mono min-w-0 flex-1 break-all rounded-lg px-3 py-2 text-[13px]" style={{ background: "var(--panel)" }}>
            {folder}
          </code>
          <button type="button" className="btn shrink-0" onClick={pickFolder}>
            Choose folder
          </button>
        </div>
        {pickLines.length > 0 && (
          <ul className="m-0 list-none p-0 text-[13.5px] muted">
            {pickLines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </div>

      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
        <dt className="muted">What it does</dt>
        <dd className="m-0">{procedureTitle ?? initial.procedureId}</dd>
        <dt className="muted">AI used</dt>
        <dd className="m-0">
          {AI_WHERE[initial.location.ai]} <span className="muted">&middot; Files: This computer</span>
        </dd>
      </dl>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-[14px] font-medium">What it is allowed to do</legend>
        <p className="m-0 text-[14px]">{ACTION_WORDS["read-files"]}.</p>
        {initial.allowedActions.includes("read-mail") && <p className="m-0 text-[14px]">{ACTION_WORDS["read-mail"]}.</p>}
        <label className="flex items-start gap-2.5 text-[14px]">
          <input type="checkbox" className="mt-1" checked={writeOutputs} onChange={(e) => setWriteOutputs(e.target.checked)} />
          <span>
            Save what it makes as new files in the NONON Output folder
            <span className="block muted">Your own files are never overwritten. Any change to them still waits for your OK.</span>
          </span>
        </label>
        <p className="m-0 text-[13.5px] muted">Routines can never send messages, delete files or run commands.</p>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="nr-missed" className="text-[14px] font-medium">
          If the computer was off at that time
        </label>
        <select id="nr-missed" className="input" value={missed} onChange={(e) => setMissed(e.target.value as Routine["missedRun"])}>
          <option value="catch-up-once">Run it once when I am back (recommended)</option>
          <option value="skip">Skip it</option>
        </select>
        <p className="m-0 text-[13.5px] muted">Your computer must be turned on and awake for routines to run.</p>
      </div>

      {error && <ErrorLine>{error}</ErrorLine>}

      <div className="flex gap-3">
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !title.trim()}>
          {saving && <Spinner />} Save routine
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </section>
  );
}

export function NewRoutine({
  workspaceId,
  procedureTitleFor,
  onSaved,
  onCancel,
}: {
  workspaceId: string;
  procedureTitleFor: (id: string) => string | undefined;
  onSaved: (r: Routine) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<Routine | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const propose = async () => {
    setBusy(true);
    setError(null);
    try {
      setProposal(await call("routine:propose", { workspaceId, text: text.trim() }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (proposal) {
    return <Confirmation initial={proposal} procedureTitle={procedureTitleFor(proposal.procedureId)} onSaved={onSaved} onCancel={onCancel} />;
  }

  return (
    <section className="card flex flex-col gap-3 p-5" aria-label="New routine">
      <label htmlFor="nr-text" className="text-[16px] font-semibold">
        Describe it in your own words
      </label>
      <textarea
        id="nr-text"
        className="input"
        rows={3}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="For example: every weekday at 8, compare the newest bank export with my ledger"
      />
      <p className="m-0 text-[13.5px] muted">NONON turns this into a routine for you to check. It is not saved until you say OK.</p>
      {error && <ErrorLine>{error}</ErrorLine>}
      <div className="flex gap-3">
        <button type="button" className="btn btn-primary" onClick={propose} disabled={busy || text.trim().length < 6}>
          {busy ? <Spinner /> : <Sparkles size={16} aria-hidden />} Prepare routine
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </section>
  );
}
