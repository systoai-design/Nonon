import { useState } from "react";
import type { CloudPolicy, ProjectRoles, ProviderId, RoleName, Workspace } from "../../../../shared/contracts";
import { call, errMsg, useCall, useEvent } from "../lib";
import { ErrorLine, Loading, Notice, Switch } from "../ui";

const ROLES: { id: RoleName; label: string; help: string }[] = [
  { id: "design", label: "Plan", help: "Decides how the work should go." },
  { id: "implement", label: "Write", help: "Writes the first version." },
  { id: "review", label: "Check", help: "Checks the result before it reaches you." },
];

function PolicyCard({ ws, onChange }: { ws: Workspace; onChange: (w: Workspace) => void }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cloud = ws.policy === "cloud-allowed";

  const set = async (policy: CloudPolicy) => {
    setError(null);
    try {
      onChange(await call("workspace:update", { id: ws.id, patch: { policy } }));
      setAsking(false);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <section className="card flex flex-col gap-3 p-5" aria-label="Online AI in this project">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3>Online AI in &ldquo;{ws.name}&rdquo;</h3>
          <p className="m-0 mt-1 text-[14px] muted">
            {cloud
              ? "On. Online AI can be used for the steps you choose below. The parts of your files those steps need are sent to that company."
              : "Off. Everything in this project stays on this computer. Only the AI on this computer is used, including for routines."}
          </p>
        </div>
        <Switch
          checked={cloud}
          label={`Allow online AI in ${ws.name}`}
          onChange={(next) => (next ? setAsking(true) : void set("local-only"))}
        />
      </div>
      {asking && !cloud && (
        <Notice tone="warn" title={`Allow online AI in "${ws.name}"?`}>
          <p className="m-0">
            Only the parts of your files a step needs are sent, and only for steps where you choose Claude, Codex or Antigravity. You can turn this off
            any time.
          </p>
          <div className="mt-3 flex gap-3">
            <button type="button" className="btn btn-primary" autoFocus onClick={() => set("cloud-allowed")}>
              Yes, allow it
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setAsking(false)}>
              Keep it on this computer
            </button>
          </div>
        </Notice>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </section>
  );
}

function Roles({ ws }: { ws: Workspace }) {
  const roles = useCall("roles:get", { workspaceId: ws.id });
  const providers = useCall("provider:list", undefined);
  useEvent("providers:updated", (l) => providers.setData(l));
  const [error, setError] = useState<string | null>(null);

  const choose = async (role: RoleName, provider: ProviderId | "local") => {
    setError(null);
    try {
      roles.setData(await call("roles:set", { workspaceId: ws.id, role, provider }));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const options: { id: ProviderId | "local"; label: string; ready: boolean }[] = [
    { id: "local", label: "This computer", ready: true },
    ...(providers.data ?? []).map((p) => ({ id: p.id as ProviderId | "local", label: p.label, ready: p.state === "ready" })),
  ];
  const current = (r: RoleName): ProjectRoles["roles"][RoleName] => roles.data?.roles[r] ?? "local";

  return (
    <section className="card flex flex-col gap-4 p-5" aria-label="Who does each step">
      <div>
        <h3>Who does each step</h3>
        <p className="m-0 mt-1 text-[14px] muted">Optional. Pick which AI does each step. Any step you do not pick uses the AI on this computer.</p>
      </div>
      {(roles.loading || providers.loading) && <Loading />}
      {roles.error && <ErrorLine>{roles.error}</ErrorLine>}
      {roles.data &&
        ROLES.map((r) => (
          <div key={r.id} role="radiogroup" aria-label={`${r.label} step`} className="flex flex-col gap-1.5">
            <div className="text-[14.5px]">
              <span className="font-medium">{r.label}</span> <span className="muted">&middot; {r.help}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {options.map((o) => {
                const on = current(r.id) === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={!o.ready && !on}
                    title={o.ready ? undefined : "Not ready. Sign in on this page first."}
                    onClick={() => choose(r.id, o.id)}
                    className="rounded-full border px-4 py-1.5 text-[13.5px] disabled:cursor-not-allowed disabled:opacity-45"
                    style={on ? { background: "var(--accent-soft)", borderColor: "var(--accent)", color: "var(--accent-ink)", fontWeight: 600 } : { borderColor: "var(--line)", background: "var(--card)" }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      {error && <ErrorLine>{error}</ErrorLine>}
    </section>
  );
}

export function WorkspaceAiPanel({ workspaceId }: { workspaceId: string }) {
  const state = useCall("app:state", undefined);
  const ws = state.data?.workspaces.find((w) => w.id === workspaceId);
  const update = (w: Workspace) => state.setData((prev) => (prev ? { ...prev, workspaces: prev.workspaces.map((x) => (x.id === w.id ? w : x)) } : prev));

  if (state.loading) return <Loading />;
  if (!ws) return null;
  return (
    <div className="flex flex-col gap-4">
      <PolicyCard ws={ws} onChange={update} />
      {ws.policy === "cloud-allowed" && <Roles ws={ws} />}
    </div>
  );
}
