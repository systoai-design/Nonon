import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Share2 } from "lucide-react";
import type { LanClientStatus, LanStatus, PairRequest } from "../../../../shared/contracts";
import { call, errMsg, formatDateTime, relativeTime, useCall, useEvent } from "../lib";
import { ConfirmButton, CopyButton, ErrorLine, Loading, Notice, Spinner, Switch } from "../ui";
import { countdown, previewPairing, type PairingPreview } from "./pairingPreview";
import { Icon } from "../../components/Icon";

const CLIENT_WORDS: Record<LanClientStatus["state"], { label: string; tone: string }> = {
  "not-paired": { label: "Not linked", tone: "" },
  connected: { label: "Connected", tone: "chip-ok" },
  unreachable: { label: "Cannot reach it", tone: "chip-attn" },
  unpaired: { label: "Unlinked", tone: "chip-red" },
};

function IconTile({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
      {children}
    </span>
  );
}

function useTicker(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

// ---------------------------------------------------------------- this computer shares its AI

function ShareCard({ status, onStatus }: { status: LanStatus; onStatus: (s: LanStatus) => void }) {
  const host = status.host;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useTicker(host.code !== null);
  const left = host.code ? countdown(host.code.expiresAt, now) : null;

  const run = async (fn: () => Promise<LanStatus | unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (res && typeof res === "object" && "host" in res) onStatus(res as LanStatus);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card flex flex-col gap-4 p-5" aria-label="Share this computer's AI">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconTile>
            <Share2 size={20} aria-hidden />
          </IconTile>
          <div>
            <h2 style={{ fontSize: 18 }}>Share this computer&rsquo;s AI</h2>
            <p className="m-0 text-[14px] muted">Let your other computer use the AI that runs here. Off until you turn it on.</p>
          </div>
        </div>
        <Switch
          checked={host.running}
          busy={busy}
          label="Share this computer's AI"
          onChange={(next) => run(() => call(next ? "lan:host-start" : "lan:host-stop", undefined))}
        />
      </div>

      {host.error && <Notice tone="bad" title="Sharing could not start">{host.error}</Notice>}

      {!host.running && (
        <p className="m-0 text-[14px] muted">
          When this is on, computers you approve can ask this one for AI answers. Your files never leave this computer, and nothing is shared outside your
          network. The first time, Windows may ask whether NONON can use your network. Choose &ldquo;Private networks&rdquo;.
        </p>
      )}

      {host.running && (
        <>
          {host.pending.map((req) => (
            <PendingRequest key={req.id} req={req} busy={busy} run={run} />
          ))}

          <div className="flex flex-col gap-3 rounded-xl p-4" style={{ background: "var(--panel)" }}>
            {host.code && left ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-[14px]">
                    Check that the other computer shows <span className="mono text-[18px] font-semibold">{host.code.shortCode}</span>
                  </div>
                  <span className="text-[13px] muted" role="timer" aria-label="Time left on this link code">
                    Works once, for {left} more
                  </span>
                </div>
                <textarea
                  readOnly
                  aria-label="Link code"
                  className="input mono !text-[12px]"
                  rows={4}
                  value={host.code.pairing}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <CopyButton text={host.code.pairing} label="Copy link code" className="btn btn-primary" />
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(() => call("lan:pairing-code", undefined).then(() => call("lan:status", undefined)))}>
                    Make a new code
                  </button>
                </div>
                <p className="m-0 text-[13px] muted">On the other computer, open Connections, paste this code and press Link. You will be asked here to say yes.</p>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => call("lan:pairing-code", undefined).then(() => call("lan:status", undefined)))}>
                  {busy && <Spinner />} Make a link code
                </button>
                <span className="text-[13px] muted">{host.code ? "That code ran out. Make a new one." : "A code works once and lasts 5 minutes."}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 style={{ fontSize: 15 }}>Computers that can use this AI</h3>
            {host.devices.length === 0 && <p className="m-0 text-[14px] muted">None yet.</p>}
            {host.devices.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5" style={{ borderColor: "var(--line)" }}>
                <div className="min-w-0">
                  <div className="truncate font-medium">{d.name}</div>
                  <div className="text-[13px] muted">
                    Added {formatDateTime(d.createdAt)} &middot; {d.lastSeenAt ? `last used ${relativeTime(d.lastSeenAt)}` : "not used yet"}
                  </div>
                </div>
                <ConfirmButton label="Remove" confirmLabel="Yes, remove" disabled={busy} onConfirm={() => run(() => call("lan:revoke", { deviceId: d.id }))} />
              </div>
            ))}
            {host.busy && <p className="m-0 text-[13px] muted">Answering a request from another computer right now.</p>}
          </div>

          <p className="m-0 text-[13px] muted">
            This only works while this computer is on, awake and on the same network. Work you do here always comes first: other computers wait their turn.
            
          </p>
        </>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </section>
  );
}

function PendingRequest({
  req,
  busy,
  run,
}: {
  req: PairRequest;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <Notice tone="warn" title={`Allow “${req.deviceName}” to use this computer’s AI?`}>
      <p className="m-0">
        It asked from {req.address} with the code <span className="mono font-semibold">{req.shortCode}</span>. Only say yes if you just started this on your
        own other computer.
      </p>
      <div className="mt-3 flex gap-3">
        <button type="button" className="btn btn-primary" autoFocus disabled={busy} onClick={() => run(() => call("lan:approve", { requestId: req.id }))}>
          Allow
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(() => call("lan:deny", { requestId: req.id }))}>
          Do not allow
        </button>
      </div>
    </Notice>
  );
}

// ---------------------------------------------------------------- this computer uses another computer's AI

function UseCard({ status, workspaceId }: { status: LanStatus; workspaceId: string | null }) {
  const client = status.client;
  const app = useCall("app:state", undefined);
  const ws = workspaceId ? app.data?.workspaces.find((w) => w.id === workspaceId) : undefined;

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<PairingPreview | null>(null);
  const [busy, setBusy] = useState<null | "pair" | "check" | "unpair" | "prefer">(null);
  const [error, setError] = useState<string | null>(null);
  const checked = useRef(false);

  useEffect(() => {
    let live = true;
    void previewPairing(code).then((p) => live && setPreview(p));
    return () => {
      live = false;
    };
  }, [code]);

  const paired = client.state === "connected" || client.state === "unreachable";

  const check = useCallback(async () => {
    setBusy("check");
    setError(null);
    try {
      await call("lan:client-status", undefined);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (paired && !checked.current) {
      checked.current = true;
      void check();
    }
    if (!paired) checked.current = false;
  }, [paired, check]);

  const pair = async () => {
    setBusy("pair");
    setError(null);
    try {
      await call("lan:pair", { pairing: code.trim(), deviceName: name.trim() });
      setCode("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const unpair = async () => {
    setBusy("unpair");
    setError(null);
    try {
      await call("lan:unpair", undefined);
      if (ws?.preferredAi === "paired" && workspaceId) await call("workspace:update", { id: workspaceId, patch: { preferredAi: "local" } });
      app.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const prefer = async (next: boolean) => {
    if (!workspaceId) return;
    setBusy("prefer");
    setError(null);
    try {
      const updated = await call("workspace:update", { id: workspaceId, patch: { preferredAi: next ? "paired" : "local" } });
      app.setData((prev) => (prev ? { ...prev, workspaces: prev.workspaces.map((w) => (w.id === updated.id ? updated : w)) } : prev));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const words = CLIENT_WORDS[client.state];
  const canPair = code.trim().length > 0 && name.trim().length > 0 && busy === null;

  return (
    <section className="card flex flex-col gap-4 p-5" aria-label="Use another computer's AI">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconTile>
            <Icon name="device" size={20} tone="accent" />
          </IconTile>
          <div>
            <h2 style={{ fontSize: 18 }}>Use another computer&rsquo;s AI</h2>
            <p className="m-0 text-[14px] muted">Use a stronger computer of yours on the same network. It is only used when you choose it.</p>
          </div>
        </div>
        <span className={`chip shrink-0 ${words.tone}`}>{busy === "check" ? "Checking..." : words.label}</span>
      </div>

      {client.state === "unpaired" && (
        <Notice tone="bad" title="This computer was unlinked">
          {client.detail ?? "The other computer removed this one."} Jobs that were using it are waiting. Link again to continue them.
        </Notice>
      )}

      {paired ? (
        <>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
            <dt className="muted">Other computer</dt>
            <dd className="m-0">{client.hostName}</dd>
            <dt className="muted">Network address</dt>
            <dd className="m-0">{client.address}</dd>
            <dt className="muted">This computer is called</dt>
            <dd className="m-0">{client.deviceName}</dd>
            <dt className="muted">Linked</dt>
            <dd className="m-0">{formatDateTime(client.pairedAt)}</dd>
          </dl>
          {client.state === "unreachable" && (
            <Notice tone="warn" title="Cannot reach it right now">
              {client.detail && client.detail !== "Checking..." ? client.detail : "NONON will keep trying."} Jobs using it wait, and carry on when it is back. They are never moved to this
              computer&rsquo;s AI without you.
            </Notice>
          )}
          {client.state === "connected" && client.detail && <p className="m-0 text-[13.5px] muted">{client.detail}</p>}

          <div className="flex items-center justify-between gap-4 rounded-xl p-4" style={{ background: "var(--panel)" }}>
            <div>
              <div className="font-medium">Use it for new jobs in this project</div>
              <div className="text-[13.5px] muted">
                {workspaceId
                  ? ws?.policy === "local-only"
                    ? "This project stays off the internet. Your other computer is yours, so it is allowed. Every job shows “AI: Your other computer”."
                    : "Every job shows “AI: Your other computer”."
                  : "Add a project first."}
              </div>
            </div>
            <Switch checked={ws?.preferredAi === "paired"} disabled={!ws || busy !== null} busy={busy === "prefer"} label="Use the other computer's AI for new jobs in this project" onChange={prefer} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn" disabled={busy !== null} onClick={check}>
              {busy === "check" && <Spinner />} Check again
            </button>
            <ConfirmButton label="Unlink" confirmLabel="Yes, unlink" disabled={busy !== null} onConfirm={unpair} />
          </div>
          <p className="m-0 text-[13px] muted">Unlinking here forgets the link on this computer. To remove it completely, also press Remove next to this computer on the other one.</p>
        </>
      ) : (
        <>
          <label className="field">
            <span>Link code from the other computer</span>
            <textarea className="input mono !text-[12px]" rows={3} value={code} placeholder="Paste it here" onChange={(e) => setCode(e.target.value)} spellCheck={false} />
          </label>
          {preview && (
            <Notice tone="info" title={`From ${preview.hostName} (${preview.address})`}>
              Check that the other computer shows <span className="mono font-semibold">{preview.shortCode}</span>. If it does not, do not continue.
            </Notice>
          )}
          {code.trim() && !preview && <ErrorLine>That does not look like a link code. Copy the whole code from the other computer.</ErrorLine>}
          <label className="field">
            <span>What should the other computer call this one?</span>
            <input className="input" value={name} maxLength={60} placeholder="For example, Kyle's laptop" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary" disabled={!canPair || !preview} onClick={pair}>
              {busy === "pair" && <Spinner />} Link
            </button>
            {busy === "pair" && <span className="text-[13.5px] muted">Waiting for you to say yes on the other computer&hellip;</span>}
          </div>
          <p className="m-0 text-[13px] muted">
            On the other computer: open Connections, turn on &ldquo;Share this computer&rsquo;s AI&rdquo;, then press &ldquo;Make a link code&rdquo;.
          </p>
        </>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </section>
  );
}

// ---------------------------------------------------------------- both cards

export function PairedDevices({ workspaceId }: { workspaceId: string | null }) {
  const status = useCall("lan:status", undefined);
  useEvent("lan:updated", (s) => status.setData(s));
  useEvent("lan:pair-request", () => status.reload());

  if (status.loading && !status.data) return <Loading />;
  if (status.error || !status.data) return <ErrorLine>{status.error ?? "Could not read the sharing settings."}</ErrorLine>;
  const s = status.data;
  return (
    <div className="flex flex-col gap-6">
      <ShareCard status={s} onStatus={(next) => status.setData(next)} />
      <UseCard status={s} workspaceId={workspaceId} />
    </div>
  );
}
