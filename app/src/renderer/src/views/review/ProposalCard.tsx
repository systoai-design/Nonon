import { useState } from "react";
import type { ChangeProposal } from "../../../../shared/contracts";
import { baseName, call, errMsg, formatDateTime } from "../lib";
import { ConfirmButton, ErrorLine, Notice, Spinner } from "../ui";
import { ChecksList } from "./ChecksList";
import { describeEdit, fileExt, STATUS_CHIP } from "./describe";
import { PreviewView } from "./PreviewView";
import { Icon } from "../../components/Icon";

export function ProposalCard({
  proposal,
  taskTitle,
  onUpdate,
}: {
  proposal: ChangeProposal;
  taskTitle?: string;
  onUpdate: (p: ChangeProposal) => void;
}) {
  const [busy, setBusy] = useState<null | "apply" | "reject" | "recover">(null);
  const [error, setError] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [revisionText, setRevisionText] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  const { status } = proposal;
  const name = baseName(proposal.target);
  const ext = fileExt(proposal.target);
  const fileGlyph = ext === "xlsx" || ext === "csv" ? "spreadsheet" : "file";
  const failed = proposal.checks.filter((c) => c.status === "fail");
  const chip = STATUS_CHIP[status];

  const run = async (kind: "apply" | "reject" | "recover") => {
    setBusy(kind);
    setError(null);
    try {
      const channel = kind === "apply" ? "change:apply" : kind === "reject" ? "change:reject" : "change:recover";
      onUpdate(await call(channel, { id: proposal.id }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const reveal = () => {
    call("shell:reveal", { path: proposal.target }).catch((e) => setError(errMsg(e)));
  };

  const sendToChat = async (text: string) => {
    setBusy(null);
    setError(null);
    try {
      await call("chat:send", { workspaceId: proposal.workspaceId, text });
      setSent("Sent to the conversation. NONON will reply there with a new version.");
      setRevising(false);
      setRevisionText("");
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const askRevision = () => {
    const about = taskTitle ? ` (task: ${taskTitle})` : "";
    const wish = revisionText.trim() || "Please prepare a different version.";
    void sendToChat(`Please redo the change to ${name}${about}. ${wish}`);
  };

  const askAgain = () => {
    const forTask = taskTitle ? ` for "${taskTitle}"` : "";
    if (status === "stale") {
      return sendToChat(`${name} changed after you prepared the change${forTask}. Please prepare it again from the current file.`);
    }
    return sendToChat(`The change to ${name}${forTask} did not finish. Please check the file and prepare it again.`);
  };

  return (
    <article className="card flex flex-col gap-4 p-5" aria-label={`Change to ${name}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex max-w-full items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--panel)" }} title={proposal.target}>
          <Icon name={fileGlyph} size={22} />
          <span className="truncate font-medium">{name}</span>
        </span>
        <span className="min-w-0 truncate text-[13.5px] muted">{proposal.preview.title}</span>
        <span className={`chip ${chip.tone} ml-auto`}>{chip.label}</span>
      </div>

      <p className="m-0">{proposal.reason}</p>

      <PreviewView preview={proposal.preview} />

      {proposal.checks.length > 0 && <ChecksList checks={proposal.checks} />}

      <StatusBody proposal={proposal} failedLabels={failed.map((c) => c.label)} />

      {error && <ErrorLine>{error}</ErrorLine>}
      {sent && <Notice tone="good">{sent}</Notice>}

      {revising && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`rev-${proposal.id}`} className="text-[13.5px] font-medium">
            What should be different?
          </label>
          <textarea
            id={`rev-${proposal.id}`}
            className="input"
            rows={3}
            autoFocus
            value={revisionText}
            onChange={(e) => setRevisionText(e.target.value)}
            placeholder="For example: leave row 12 out, or round to whole numbers"
          />
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={askRevision}>
              <Icon name="send" size={17} tone="current" /> Send
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setRevising(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <Actions
        proposal={proposal}
        busy={busy}
        blocked={failed.length > 0}
        onApply={() => run("apply")}
        onReject={() => run("reject")}
        onRecover={() => run("recover")}
        onReveal={reveal}
        onRevise={() => {
          setSent(null);
          setRevising(true);
        }}
        onAskAgain={askAgain}
      />
    </article>
  );
}

function StatusBody({ proposal, failedLabels }: { proposal: ChangeProposal; failedLabels: string[] }) {
  switch (proposal.status) {
    case "staged":
      return failedLabels.length > 0 ? (
        <Notice tone="bad" title="This change is on hold">
          A check did not pass ({failedLabels.join(", ")}), so NONON will not change your file. Ask for a different version and NONON will try again.
        </Notice>
      ) : (
        <div className="flex items-center gap-2.5 border-t pt-4 text-[14px] muted" style={{ borderColor: "var(--line)" }}>
          <Icon name="info" size={20} tone="accent" /> NONON saves a backup copy of your file first, so you can undo this.
        </div>
      );
    case "applying":
      return (
        <Notice tone="info">
          <span className="inline-flex items-center gap-2">
            <Spinner /> Making the change now. Please wait.
          </span>
        </Notice>
      );
    case "applied":
      return (
        <Notice tone="good" title="Change made">
          Your file was changed{proposal.appliedAt ? ` on ${formatDateTime(proposal.appliedAt)}` : ""}. A backup copy was saved first, so you can undo it.
        </Notice>
      );
    case "recovered":
      return (
        <Notice tone="good" title="Change undone">
          Your file is back the way it was before this change.
        </Notice>
      );
    case "rejected":
      return <Notice tone="info" title="You said no">Your file was not changed.</Notice>;
    case "stale":
      return (
        <Notice tone="warn" title="Not made">
          This file changed after NONON prepared this. Your file was not changed. Ask NONON to prepare it again.
        </Notice>
      );
    case "partial": {
      const results = proposal.editResults ?? [];
      return (
        <Notice tone="warn" title="Only some of the changes were made">
          {results.length > 0 ? (
            <ul className="m-0 mt-1 list-none p-0">
              {results.map((r) => {
                const edit = proposal.edits[r.index];
                return (
                  <li key={r.index} className="py-0.5">
                    <strong>{r.ok ? "Done" : "Not done"}:</strong> {edit ? describeEdit(edit) : `Change ${r.index + 1}`}
                    {!r.ok && r.error ? <span className="muted"> ({errMsg(r.error)})</span> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <span>NONON could not tell which changes went through. Open the file and check it before you continue.</span>
          )}
          {proposal.error && <div className="mt-1 muted">{errMsg(proposal.error)}</div>}
          {proposal.recoveryPath && <div className="mt-1">You can undo the changes that were made.</div>}
        </Notice>
      );
    }
    case "failed":
      return (
        <Notice tone="bad" title="This change did not work">
          {proposal.error ? errMsg(proposal.error) : "NONON could not finish the change."} Check the file before you continue.
          {proposal.recoveryPath ? " A backup copy exists, so you can undo it." : ""}
        </Notice>
      );
  }
}

function Actions({
  proposal,
  busy,
  blocked,
  onApply,
  onReject,
  onRecover,
  onReveal,
  onRevise,
  onAskAgain,
}: {
  proposal: ChangeProposal;
  busy: null | "apply" | "reject" | "recover";
  blocked: boolean;
  onApply: () => void;
  onReject: () => void;
  onRecover: () => void;
  onReveal: () => void;
  onRevise: () => void;
  onAskAgain: () => void;
}) {
  const working = busy !== null;
  const showFile = (
    <button type="button" className="btn" onClick={onReveal}>
      <Icon name="folder" size={18} tone="accent" /> Show file
    </button>
  );
  const undo = (
    <ConfirmButton
      className="btn"
      label={
        <>
          <Icon name="restore" size={18} tone="current" /> Undo this change
        </>
      }
      confirmLabel="Yes, undo it"
      onConfirm={onRecover}
      disabled={working}
    />
  );

  switch (proposal.status) {
    case "staged":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" disabled={blocked || working} onClick={onApply}>
            {busy === "apply" ? <Spinner /> : null} Make the change
          </button>
          <button type="button" className="btn" disabled={working} onClick={onRevise}>
            Ask for a different version
          </button>
          <button type="button" className="btn btn-ghost" disabled={working} onClick={onReject}>
            Say no
          </button>
        </div>
      );
    case "applied":
      return (
        <div className="flex flex-wrap gap-3">
          {undo}
          {showFile}
        </div>
      );
    case "recovered":
      return <div className="flex flex-wrap gap-3">{showFile}</div>;
    case "stale":
      return (
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary" onClick={onAskAgain}>
            Ask NONON to prepare it again
          </button>
          <button type="button" className="btn btn-ghost" disabled={working} onClick={onReject}>
            Dismiss
          </button>
        </div>
      );
    case "partial":
      return (
        <div className="flex flex-wrap gap-3">
          {proposal.recoveryPath && undo}
          {showFile}
          <button type="button" className="btn" onClick={onAskAgain}>
            Ask NONON to prepare it again
          </button>
        </div>
      );
    case "failed":
      return (
        <div className="flex flex-wrap gap-3">
          {proposal.recoveryPath && undo}
          {showFile}
          <button type="button" className="btn" onClick={onAskAgain}>
            Ask NONON to try again
          </button>
        </div>
      );
    case "applying":
    case "rejected":
      return null;
  }
}
