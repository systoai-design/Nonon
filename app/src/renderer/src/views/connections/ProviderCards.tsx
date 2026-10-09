import { useState } from "react";
import { Cloud, RefreshCw } from "lucide-react";
import type { ProviderState, ProviderStatus } from "../../../../shared/contracts";
import { call, errMsg, useCall, useEvent } from "../lib";
import { ErrorLine, Loading, Notice, Spinner } from "../ui";

export const PROVIDER_STATE: Record<ProviderState, { label: string; tone: string; help?: string }> = {
  "not-installed": { label: "Not installed", tone: "", help: "It is not on this computer. Install it from the company's website, then check again." },
  "not-connected": { label: "Not connected", tone: "" },
  "needs-sign-in": { label: "Needs you to sign in", tone: "chip-attn" },
  ready: { label: "Ready", tone: "chip-ok" },
  unavailable: { label: "Not available right now", tone: "chip-attn" },
  incompatible: { label: "Needs an update", tone: "chip-red", help: "The version on this computer does not work with NONON. Update it, then check again." },
  failed: { label: "Could not start", tone: "chip-red" },
};

const VERIFIED_WORDS: Record<ProviderStatus["verified"], string> = {
  "probe-only": "NONON checked that it starts and replies. The quality of its answers has not been tested.",
  "turn-tested": "A real test question was answered successfully.",
  untested: "Not tested yet.",
};

function ProviderCard({ p, onUpdate }: { p: ProviderStatus; onUpdate: (p: ProviderStatus) => void }) {
  const [busy, setBusy] = useState<null | "sign-in" | "probe">(null);
  const [error, setError] = useState<string | null>(null);
  const st = PROVIDER_STATE[p.state];

  const act = async (kind: "sign-in" | "probe") => {
    setBusy(kind);
    setError(null);
    try {
      onUpdate(await call(kind === "sign-in" ? "provider:sign-in" : "provider:probe", { id: p.id }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const canSignIn = p.state === "needs-sign-in" || p.state === "not-connected";
  return (
    <article className="card flex flex-col gap-3 p-5" aria-label={p.label}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2">
          <Cloud size={17} className="muted" aria-hidden /> {p.label}
          {p.version && <span className="text-[12.5px] font-normal muted">version {p.version}</span>}
        </h3>
        <span className={`chip ${st.tone}`}>{st.label}</span>
      </div>
      {st.help && <p className="m-0 text-[14px] muted">{st.help}</p>}
      {p.detail && <p className="m-0 text-[14px]">{p.detail}</p>}
      <div className="rounded-xl p-3 text-[14px]" style={{ background: "var(--panel)" }}>
        <div className="mb-0.5 text-[12.5px] font-semibold uppercase tracking-wide muted">Before you turn this on</div>
        {p.disclosure}
      </div>
      <p className="m-0 text-[13px] muted">{VERIFIED_WORDS[p.verified]}</p>
      {error && <ErrorLine>{error}</ErrorLine>}
      <div className="flex flex-wrap gap-3">
        {canSignIn && (
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => act("sign-in")}>
            {busy === "sign-in" && <Spinner />} Connect
          </button>
        )}
        <button type="button" className="btn" disabled={busy !== null} onClick={() => act("probe")}>
          {busy === "probe" ? <Spinner /> : <RefreshCw size={15} aria-hidden />} Check again
        </button>
      </div>
    </article>
  );
}

export function ProviderCards() {
  const list = useCall("provider:list", undefined);
  useEvent("providers:updated", (l) => list.setData(l));
  const update = (p: ProviderStatus) => list.setData((prev) => (prev ?? []).map((x) => (x.id === p.id ? p : x)));

  return (
    <section className="flex flex-col gap-3" aria-label="Optional online AI">
      <div>
        <h2>Online AI (optional)</h2>
        <p className="m-0 mt-1 text-[14.5px] muted">
          NONON works fully with the AI on this computer. You can also connect an online AI like Claude for steps you choose.
        </p>
      </div>
      <Notice tone="info" title="Online AI sends the parts of your files a task needs to that company.">
        Off by default. The AI on this computer never sends anything away.
      </Notice>
      {list.loading && <Loading />}
      {list.error && <ErrorLine>{list.error}</ErrorLine>}
      <div className="grid gap-4">
        {(list.data ?? []).map((p) => (
          <ProviderCard key={p.id} p={p} onUpdate={update} />
        ))}
      </div>
    </section>
  );
}
