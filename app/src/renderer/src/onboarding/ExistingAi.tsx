import { useCallback, useEffect, useRef, useState } from "react";
import type { DiscoveredModel } from "../../../shared/contracts";
import { api } from "../lib/bridge";
import { formatBytes, plainError } from "../lib/format";
import { Spinner } from "../components/ui";

export type FoundState =
  | { phase: "idle" }
  | { phase: "looking" }
  | { phase: "done"; models: DiscoveredModel[] }
  | { phase: "error"; message: string };

/**
 * Looks for AI files already on this computer. With `auto`, the search starts once, as soon as `enabled` is true;
 * otherwise it only runs when `run()` is called. Main never sends back a path, only ids it can accept again.
 */
export function useFoundModels(enabled: boolean, auto: boolean) {
  const [state, setState] = useState<FoundState>({ phase: "idle" });
  const ticket = useRef(0);
  const started = useRef(false);
  const alive = useRef(true);

  const run = useCallback(() => {
    const mine = ++ticket.current;
    setState({ phase: "looking" });
    api
      .call("runtime:discover", undefined, { silent: true })
      .then((models) => {
        if (alive.current && ticket.current === mine) setState({ phase: "done", models });
      })
      .catch((e) => {
        if (alive.current && ticket.current === mine) setState({ phase: "error", message: plainError(e) });
      });
  }, []);

  useEffect(() => {
    if (!auto || !enabled || started.current) return;
    started.current = true;
    run();
  }, [auto, enabled, run]);

  // Not a ticket bump: React's dev double-mount would throw away the one search that was started.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  return { state, run };
}

/** "Use this one" for a found file. Errors come back as one plain sentence. */
export function useChooseFound() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choose = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.call("runtime:use-existing", { id }, { silent: true });
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusyId(null);
    }
  }, []);
  return { busyId, error, choose };
}

export function TrustTag({ kind }: { kind: DiscoveredModel["kind"] }) {
  if (kind === "exact") return <span className="chip chip-ok">Tested with NONON</span>;
  return <span className="chip chip-info">Works, but not tested with NONON</span>;
}

export function LookingLine({ children = "Looking for AI that is already on this computer..." }: { children?: string }) {
  return (
    <div className="setup-looking" role="status">
      <Spinner size={16} />
      <span>{children}</span>
    </div>
  );
}

export function FoundList({
  models,
  busyId,
  currentFile,
  onUse,
  disabled,
}: {
  models: DiscoveredModel[];
  busyId: string | null;
  /** File name of the AI in use now, so its row says so instead of offering it again. */
  currentFile?: string;
  onUse: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="found-list" aria-label="AI found on this computer">
      {models.map((m) => {
        const inUse = currentFile !== undefined && m.fileName === currentFile;
        return (
          <li key={m.id} className="found-row">
            <div className="found-main">
              <strong className="found-name">{m.label}</strong>
              <span className="muted small">
                {formatBytes(m.bytes)}. Found in {m.where}.
              </span>
              <TrustTag kind={m.kind} />
            </div>
            <button
              type="button"
              className="btn btn-sm"
              disabled={inUse || disabled || busyId !== null}
              aria-label={inUse ? `In use: ${m.label}` : `Use this one, ${m.label}`}
              onClick={() => onUse(m.id)}
            >
              {busyId === m.id ? <Spinner size={14} /> : null}
              {inUse ? "In use" : "Use this one"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
