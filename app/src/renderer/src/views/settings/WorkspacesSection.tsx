import { useEffect, useState } from "react";

import { PACKS, type PackId, type Workspace } from "../../../../shared/contracts";
import { call, useAttempt } from "../lib";
import { ConfirmButton, ErrorLine } from "../ui";
import type { SettingsCtx } from "./types";
import { Icon } from "../../components/Icon";

function WorkspaceRow({ ws, ctx }: { ws: Workspace; ctx: SettingsCtx }) {
  const [name, setName] = useState(ws.name);
  const { error, attempt } = useAttempt();
  useEffect(() => setName(ws.name), [ws.name]);

  const commitName = () => {
    const next = name.trim();
    if (!next) return setName(ws.name);
    if (next !== ws.name) void attempt(() => ctx.patchWorkspace(ws.id, { name: next }));
  };

  const changeFolder = () =>
    attempt(async () => {
      const f = await call("workspace:pick-folder", undefined);
      if (f) await ctx.patchWorkspace(ws.id, { folder: f });
    });

  return (
    <li className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <label htmlFor={`ws-name-${ws.id}`} className="text-[14px] font-medium">
            Name
          </label>
          <input
            id={`ws-name-${ws.id}`}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </div>
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <label htmlFor={`ws-pack-${ws.id}`} className="text-[14px] font-medium">
            What you use it for
          </label>
          <select
            id={`ws-pack-${ws.id}`}
            className="input"
            value={ws.pack}
            onChange={(e) => void attempt(() => ctx.patchWorkspace(ws.id, { pack: e.target.value as PackId }))}
          >
            {PACKS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[14px] font-medium">Folder</span>
        <div className="flex items-center gap-3">
          <Icon name="folder" size={20} tone="accent" className="shrink-0 muted" />
          {ws.folder ? <code className="mono min-w-0 flex-1 break-all text-[13px]">{ws.folder}</code> : <span className="flex-1 muted">No folder chosen yet</span>}
          <button type="button" className="btn shrink-0" onClick={changeFolder}>
            {ws.folder ? "Change folder" : "Choose folder"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`chip ${ws.policy === "cloud-allowed" ? "chip-attn" : "chip-ok"}`}>
          {ws.policy === "cloud-allowed" ? "Online AI allowed" : "Stays on this computer"}
        </span>
        <div className="flex items-center gap-3">
          <ConfirmButton
            className="btn btn-ghost btn-danger"
            label="Remove project"
            confirmLabel="Yes, remove it"
            onConfirm={() => void attempt(() => ctx.removeWorkspace(ws.id))}
          />
        </div>
      </div>
      <p className="m-0 text-[13px] muted">Removing a project only removes it from NONON. The files in its folder are not deleted.</p>
      {error && <ErrorLine>{error}</ErrorLine>}
    </li>
  );
}

export function WorkspacesSection({ ctx }: { ctx: SettingsCtx }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2>Projects</h2>
        <p className="m-0 mt-1 muted">A project is a folder NONON can work in. It never looks outside the folders you choose.</p>
      </div>
      {ctx.workspaces.length === 0 ? (
        <div className="panel p-5 muted">No projects yet. Use Add a project in the sidebar.</div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {ctx.workspaces.map((w) => (
            <WorkspaceRow key={w.id} ws={w} ctx={ctx} />
          ))}
        </ul>
      )}
    </div>
  );
}
