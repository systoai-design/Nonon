import { useState } from "react";

import type { EmailBrief, GmailStatus } from "../../../../shared/contracts";
import { call, errMsg, formatDateTime, useCall, useEvent } from "../lib";
import { CopyButton, ErrorLine, Loading, Notice, Spinner } from "../ui";
import { BriefView } from "./BriefView";
import { Icon } from "../../components/Icon";

const STATE_WORDS: Record<GmailStatus["state"], { label: string; tone: string }> = {
  "not-configured": { label: "Not set up yet", tone: "chip-attn" },
  disconnected: { label: "Not connected", tone: "" },
  connected: { label: "Connected", tone: "chip-ok" },
  error: { label: "Needs a look", tone: "chip-red" },
};

function scopeWords(scope: string): string {
  if (scope.endsWith("gmail.readonly")) return "Read your email (cannot send or delete)";
  if (scope.endsWith("gmail.metadata")) return "See email subjects and senders only";
  return scope.split("/").pop() ?? scope;
}

export function GmailCard({ workspaceId }: { workspaceId: string | null }) {
  const status = useCall("gmail:status", undefined);
  const [busy, setBusy] = useState<null | "connect" | "disconnect" | "brief">(null);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<EmailBrief | null>(null);

  useEvent("gmail:updated", (s) => status.setData(s));

  const s = status.data;
  const run = async (kind: "connect" | "disconnect") => {
    setBusy(kind);
    setError(null);
    try {
      status.setData(await call(kind === "connect" ? "gmail:connect" : "gmail:disconnect", undefined));
      if (kind === "disconnect") setBrief(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const prepare = async (forceOffline: boolean) => {
    if (!workspaceId) return;
    setBusy("brief");
    setError(null);
    try {
      setBrief(await call("gmail:brief", { workspaceId, forceOffline }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const connected = s?.state === "connected";
  const hasSaved = (s?.cachedMessages ?? 0) > 0;
  const canBrief = Boolean(workspaceId) && (connected || hasSaved) && busy === null;

  return (
    <section className="card flex flex-col gap-4 p-5" aria-label="Gmail">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
            <Icon name="mail" size={20} tone="accent" />
          </span>
          <div>
            <h2 style={{ fontSize: 18 }}>Gmail</h2>
            <p className="m-0 text-[14px] muted">NONON reads your email to write a short summary. It never sends or deletes anything. It needs the internet to get new email.</p>
          </div>
        </div>
        {s && <span className={`chip shrink-0 ${STATE_WORDS[s.state].tone}`}>{STATE_WORDS[s.state].label}</span>}
      </div>

      {status.loading && <Loading />}
      {status.error && <ErrorLine>{status.error}</ErrorLine>}

      {s?.state === "not-configured" && (
        <Notice tone="warn" title="One-time setup needed">
          {s.configHint ? (
            <div className="mt-1 flex flex-col gap-2">
              <span>Gmail needs a one-time setup in your Google account before it can connect. If you are not sure how, ask the person who set up NONON for you.</span>
              <details>
                <summary className="cursor-pointer text-[13.5px]">Show the setup steps</summary>
                <pre className="mono m-0 mt-2 whitespace-pre-wrap break-all rounded-lg p-3 text-[12.5px]" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
                  {s.configHint}
                </pre>
              </details>
              <div>
                <CopyButton text={s.configHint} label="Copy the steps" className="btn !py-1.5 text-[13px]" />
              </div>
            </div>
          ) : (
            "NONON could not find the setup file it needs to connect to Gmail."
          )}
          <p className="m-0 mt-2 text-[13px] muted">NONON never asks you to type a password here. The setup file stays on this computer.</p>
        </Notice>
      )}

      {s?.state === "error" && <Notice tone="bad" title="Gmail needs a look">Try disconnecting and connecting again.</Notice>}

      {s && s.state !== "not-configured" && (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
          {s.account && (
            <>
              <dt className="muted">Account</dt>
              <dd className="m-0">{s.account}</dd>
            </>
          )}
          <dt className="muted">Last updated</dt>
          <dd className="m-0">{s.lastSyncAt ? formatDateTime(s.lastSyncAt) : "Never"}</dd>
          <dt className="muted">Saved on this computer</dt>
          <dd className="m-0">{s.cachedMessages} emails</dd>
          {s.scopes.length > 0 && (
            <>
              <dt className="muted">NONON may</dt>
              <dd className="m-0">{s.scopes.map(scopeWords).join(", ")}</dd>
            </>
          )}
        </dl>
      )}

      {error && <ErrorLine>{error}</ErrorLine>}

      <div className="flex flex-wrap items-center gap-3">
        {s && !connected && (
          <button type="button" className="btn btn-primary" disabled={s.state === "not-configured" || busy !== null} onClick={() => run("connect")}>
            {busy === "connect" && <Spinner />} Connect Gmail
          </button>
        )}
        {connected && (
          <button type="button" className="btn" disabled={busy !== null} onClick={() => run("disconnect")}>
            {busy === "disconnect" && <Spinner />} Disconnect
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={!canBrief} onClick={() => prepare(false)}>
          {busy === "brief" && <Spinner />} Summarize my email
        </button>
        {!connected && hasSaved && (
          <span className="text-[13px] muted">Uses email saved earlier. It may be out of date.</span>
        )}
        {connected && hasSaved && (
          <button type="button" className="btn btn-ghost" disabled={!canBrief} onClick={() => prepare(true)}>
            Use saved email only
          </button>
        )}
      </div>
      {!workspaceId && <p className="m-0 text-[13.5px] muted">Add a project first, then summarize your email from there.</p>}
      {workspaceId && s && !connected && !hasSaved && s.state !== "not-configured" && (
        <p className="m-0 text-[13.5px] muted">Connect Gmail to summarize your email.</p>
      )}

      {brief && (
        <div className="border-t pt-4" style={{ borderColor: "var(--line)" }}>
          <BriefView brief={brief} />
        </div>
      )}
    </section>
  );
}
