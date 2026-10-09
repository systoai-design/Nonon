import { useState } from "react";

import type { ProcedureInfo, Task } from "../../../shared/contracts";
import { api } from "../lib/bridge";
import { extOf } from "../lib/format";
import { AttachmentChip, Spinner } from "../components/ui";
import { Icon } from "../components/Icon";

/** Hands each file to the first matching file input, so "Try the sample" needs no manual picking. */
export function autoAssignFiles(proc: ProcedureInfo, paths: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const used = new Set<string>();
  for (const input of proc.inputs) {
    if (input.kind !== "file" && input.kind !== "files") continue;
    const matches = paths.filter((p) => !used.has(p) && (!input.accept || input.accept.includes(extOf(p))));
    const take = input.kind === "file" ? matches.slice(0, 1) : matches;
    take.forEach((p) => used.add(p));
    if (take.length) out[input.key] = take;
  }
  return out;
}

/** Inline form that starts a procedure from its declared inputs. */
export function ProcedureStarter({
  procedure,
  workspaceId,
  initialFiles,
  onClose,
  onStarted,
}: {
  procedure: ProcedureInfo;
  workspaceId: string;
  initialFiles?: Record<string, string[]>;
  onClose: () => void;
  onStarted: (task: Task) => void;
}) {
  const [files, setFiles] = useState<Record<string, string[]>>(initialFiles ?? {});
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const missing = procedure.inputs.filter((i) => {
    if (i.optional) return false;
    if (i.kind === "file" || i.kind === "files") return (files[i.key] ?? []).length === 0;
    return (text[i.key] ?? "").trim() === "";
  });

  async function pick(key: string, kind: "file" | "files", accept?: string[]) {
    const paths = await api.call("workspace:pick-files", { accept }).catch(() => []);
    if (!paths.length) return;
    setFiles((cur) => ({ ...cur, [key]: kind === "file" ? paths.slice(0, 1) : [...new Set([...(cur[key] ?? []), ...paths])] }));
  }

  async function start() {
    setBusy(true);
    try {
      const cleanText = Object.fromEntries(Object.entries(text).filter(([, v]) => v.trim() !== ""));
      const task = await api.call("task:start", { workspaceId, procedureId: procedure.id, files, text: cleanText });
      onStarted(task);
    } catch {
      setBusy(false);
    }
  }

  return (
    <section className="starter-form" aria-label={`Start: ${procedure.title}`}>
      <header className="task-head">
        <h3 className="task-title">{procedure.title}</h3>
        <button type="button" className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Close">
          <Icon name="close" size={18} tone="current" />
        </button>
      </header>
      <p className="muted">{procedure.supports}</p>
      {procedure.inputs.map((input) => (
        <div className="field" key={input.key}>
          <span className="field-label">
            {input.label.replace(/\s*\(optional\)\s*$/i, "")}
            {input.optional && <span className="muted"> (optional)</span>}
          </span>
          {(input.kind === "file" || input.kind === "files") && (
            <div className="starter-files">
              {(files[input.key] ?? []).map((p) => (
                <AttachmentChip key={p} path={p} onRemove={() => setFiles((cur) => ({ ...cur, [input.key]: (cur[input.key] ?? []).filter((x) => x !== p) }))} />
              ))}
              <button type="button" className="btn" onClick={() => void pick(input.key, input.kind as "file" | "files", input.accept)}>
                <Icon name="attachment" size={17} tone="current" /> {(files[input.key] ?? []).length ? "Change" : "Add"} {input.kind === "files" ? "files" : "file"}
              </button>
            </div>
          )}
          {input.kind === "text" && <textarea className="input" rows={3} value={text[input.key] ?? ""} onChange={(e) => setText({ ...text, [input.key]: e.target.value })} />}
          {input.kind === "number" && <input className="input" type="number" value={text[input.key] ?? ""} onChange={(e) => setText({ ...text, [input.key]: e.target.value })} />}
          {input.kind === "choice" && (
            <select className="input" value={text[input.key] ?? ""} onChange={(e) => setText({ ...text, [input.key]: e.target.value })}>
              <option value="">Choose one...</option>
              {input.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {input.help && <span className="muted small">{input.help}</span>}
        </div>
      ))}
      <div className="task-actions">
        <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={missing.length > 0 || busy}>
          {busy && <Spinner />}
          Start
        </button>
        {missing.length > 0 && <span className="muted small">Still needed: {missing.map((m) => m.label.toLowerCase()).join(", ")}</span>}
      </div>
    </section>
  );
}
