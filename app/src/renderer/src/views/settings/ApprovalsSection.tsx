import { useMemo, useState } from "react";
import { History } from "lucide-react";
import type { ChangeProposal, Workspace } from "../../../../shared/contracts";
import { baseName, call, formatDateTime, useAttempt, useCall } from "../lib";
import { ConfirmButton, ErrorLine, Loading, Notice, Switch } from "../ui";
import { STATUS_CHIP } from "../review/describe";
import type { SettingsCtx } from "./types";

const AUTO_APPLY_EXPLANATION = "NONON changes files in this folder without asking, but only after it saves a backup copy. It never sends anything, deletes files, runs commands or uses online AI.";

function RadioCard({ checked, title, children, onSelect }: { checked: boolean; title: string; children: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className="flex w-full items-start gap-3 rounded-2xl border p-4 text-left"
      style={checked ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : { borderColor: "var(--line-strong)", background: "var(--card)" }}
    >
      <span
        className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2"
        style={{ borderColor: checked ? "var(--accent)" : "var(--control-line)" }}
        aria-hidden
      >
        {checked && <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--accent)" }} />}
      </span>
      <span>
        <span className="block text-[16px] font-semibold">{title}</span>
        <span className="block text-[14px] muted">{children}</span>
      </span>
    </button>
  );
}

function AutoApplyRow({ ws, ctx }: { ws: Workspace; ctx: SettingsCtx }) {
  const [asking, setAsking] = useState(false);
  const { error, attempt } = useAttempt();
  const noFolder = !ws.folder;

  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium">{ws.name}</div>
          <div className="truncate text-[13px] muted">{ws.folder ?? "Choose a folder for this project first."}</div>
        </div>
        <Switch
          checked={ws.autoApply}
          disabled={noFolder}
          label={`Make changes without asking in ${ws.name}`}
          onChange={(next) => (next ? setAsking(true) : void attempt(() => ctx.patchWorkspace(ws.id, { autoApply: false })))}
        />
      </div>
      <p className="m-0 text-[13.5px] muted">{AUTO_APPLY_EXPLANATION}</p>
      {asking && !ws.autoApply && (
        <Notice tone="warn" title={`Let NONON make changes without asking in "${ws.name}"?`}>
          {AUTO_APPLY_EXPLANATION} You can turn it off any time, and you can undo any change.
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              className="btn btn-primary"
              autoFocus
              onClick={() => void attempt(() => ctx.patchWorkspace(ws.id, { autoApply: true })).then(() => setAsking(false))}
            >
              Turn on
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </Notice>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </li>
  );
}

function HistoryList({ workspaces }: { workspaces: Workspace[] }) {
  const list = useCall("change:list", {});
  const { error, attempt } = useAttempt();
  const names = useMemo(() => new Map(workspaces.map((w) => [w.id, w.name])), [workspaces]);
  const rows = useMemo(
    () => [...(list.data ?? [])].filter((c) => c.status !== "staged").sort((a, b) => (b.appliedAt ?? b.createdAt).localeCompare(a.appliedAt ?? a.createdAt)).slice(0, 20),
    [list.data],
  );
  const undo = (c: ChangeProposal) =>
    attempt(async () => {
      const next = await call("change:recover", { id: c.id });
      list.setData((prev) => (prev ?? []).map((x) => (x.id === next.id ? next : x)));
    });

  return (
    <div className="flex flex-col gap-3">
      {list.loading && <Loading />}
      {list.error && <ErrorLine>{list.error}</ErrorLine>}
      {!list.loading && rows.length === 0 && <p className="m-0 muted">No changes have been made yet.</p>}
      {rows.length > 0 && (
        <ul className="m-0 list-none divide-y divide-[color:var(--line)] p-0">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[14px]">
              <span className="font-medium">{baseName(c.target)}</span>
              <span className={`chip ${STATUS_CHIP[c.status].tone}`}>{STATUS_CHIP[c.status].label}</span>
              <span className="muted">
                {names.get(c.workspaceId) ?? "Project"} &middot; {formatDateTime(c.appliedAt ?? c.createdAt)}
              </span>
              {c.status === "applied" && (
                <span className="ml-auto">
                  <ConfirmButton className="btn !py-1 text-[13px]" label="Undo this change" confirmLabel="Yes, undo it" onConfirm={() => void undo(c)} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}

export function ApprovalsSection({ ctx }: { ctx: SettingsCtx }) {
  const anyAuto = ctx.workspaces.some((w) => w.autoApply);
  const [wantAuto, setWantAuto] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const { error, attempt } = useAttempt();
  const autoMode = anyAuto || wantAuto;

  const chooseReview = () => {
    setWantAuto(false);
    void attempt(async () => {
      for (const w of ctx.workspaces.filter((x) => x.autoApply)) await ctx.patchWorkspace(w.id, { autoApply: false });
    });
  };

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h2>How should changes to your files work?</h2>
        <p className="m-0 mt-1 muted">These settings apply to documents, spreadsheets and files in your projects.</p>
      </div>

      <div role="radiogroup" aria-label="How changes are handled" className="flex max-w-2xl flex-col gap-3">
        <RadioCard checked={!autoMode} title="Check with me first" onSelect={chooseReview}>
          NONON shows each change and waits for your OK. This is the default.
        </RadioCard>
        <RadioCard checked={autoMode} title="Make changes without asking, in projects I choose" onSelect={() => setWantAuto(true)}>
          NONON makes supported changes in the folders you pick. It always saves a backup first.
        </RadioCard>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}

      {autoMode && (
        <div className="flex max-w-2xl flex-col gap-3">
          <h3>Choose projects</h3>
          {ctx.workspaces.length === 0 ? (
            <p className="m-0 muted">You have no projects yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {ctx.workspaces.map((w) => (
                <AutoApplyRow key={w.id} ws={w} ctx={ctx} />
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="m-0 max-w-2xl border-t pt-5 text-[14px] muted" style={{ borderColor: "var(--line)" }}>
        Sending email, deleting files and running commands are never included, even in this mode.
      </p>

      <div className="flex max-w-2xl flex-col gap-3">
        <h2 style={{ fontSize: 22 }}>Backups</h2>
        <label className="flex items-start gap-3">
          <input type="checkbox" checked disabled className="always-on mt-1.5" aria-describedby="recovery-help" />
          <span>
            <span className="block font-medium">Keep backup copies</span>
            <span id="recovery-help" className="block text-[14px] muted">
              Always on. NONON saves a backup copy before it changes any file, so you can undo a change.
            </span>
          </span>
        </label>
        <div>
          <button type="button" className="btn" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
            <History size={16} aria-hidden /> {showHistory ? "Hide change history" : "View change history"}
          </button>
        </div>
        {showHistory && <HistoryList workspaces={ctx.workspaces} />}
      </div>
      <p className="m-0 text-[14px] muted">You can change these settings any time.</p>
    </div>
  );
}
