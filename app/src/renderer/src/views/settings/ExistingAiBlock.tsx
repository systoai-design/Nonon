import { useState } from "react";
import type { Settings } from "../../../../shared/contracts";
import { api } from "../../lib/bridge";
import { formatBytes, plainError } from "../../lib/format";
import { FoundList, LookingLine, TrustTag, useChooseFound, useFoundModels } from "../../onboarding/ExistingAi";
import { Spinner } from "../../components/ui";
import { ErrorLine } from "../ui";

const fileNameOf = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Settings > Advanced: use an AI file the person already has, where it is. */
export function ExistingAiBlock({ settings }: { settings: Settings }) {
  const found = useFoundModels(true, false);
  const choose = useChooseFound();
  const [picking, setPicking] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = settings.customModel;

  const chooseFile = async () => {
    setPicking(true);
    setError(null);
    try {
      await api.call("runtime:use-file", undefined, { silent: true });
    } catch (e) {
      setError(plainError(e));
    } finally {
      setPicking(false);
    }
  };

  const stopUsing = async () => {
    setStopping(true);
    setError(null);
    try {
      await api.call("runtime:forget-existing", undefined, { silent: true });
    } catch (e) {
      setError(plainError(e));
    } finally {
      setStopping(false);
    }
  };

  const options = found.state.phase === "done" ? found.state.models.filter((m) => m.kind !== "unknown") : [];

  return (
    <section className="card flex max-w-2xl flex-col gap-4 p-5" aria-labelledby="existing-ai-title">
      <h3 id="existing-ai-title">Use an AI I already have</h3>
      <p className="m-0 text-[14px] muted">
        If another app on this computer, like LM Studio or Ollama, already downloaded an AI, NONON can use that file where it is. You do not need to download it again.
      </p>

      {current && (
        <div className="notice notice-ok">
          <div>
            <p className="notice-title">NONON is using {current.label}</p>
            <p className="muted small" title={current.path}>
              {formatBytes(current.bytes)}. File: {fileNameOf(current.path)}
            </p>
            <TrustTag kind={current.kind} />
            <button type="button" className="btn btn-sm" disabled={stopping} onClick={() => void stopUsing()}>
              {stopping ? <Spinner size={14} /> : null} Stop using it
            </button>
            <p className="muted small">This does not touch the file. It stays where it is.</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn" disabled={found.state.phase === "looking" || picking} onClick={found.run}>
          {found.state.phase === "looking" ? <Spinner /> : null} {found.state.phase === "done" ? "Look again" : "Look for AI on this computer"}
        </button>
        <button type="button" className="btn" disabled={picking || choose.busyId !== null} onClick={() => void chooseFile()}>
          {picking ? <Spinner /> : null} Choose a file...
        </button>
      </div>

      {found.state.phase === "looking" && <LookingLine />}
      {found.state.phase === "error" && <ErrorLine>{found.state.message}</ErrorLine>}
      {found.state.phase === "done" && options.length === 0 && (
        <p className="m-0 text-[14px] muted" role="status">
          NONON did not find an AI it can use. You can pick a file yourself with Choose a file.
        </p>
      )}
      {options.length > 0 && (
        <FoundList models={options} busyId={choose.busyId} currentFile={current ? fileNameOf(current.path) : undefined} disabled={picking} onUse={(id) => void choose.choose(id)} />
      )}
      {(choose.error || error) && <ErrorLine>{choose.error ?? error}</ErrorLine>}

      <p className="m-0 text-[13px] muted">Your own file stays where it is. NONON reads it but never changes, moves or copies it. If the AI engine is missing, NONON downloads that small part once (about 30 to 150 MB).</p>
    </section>
  );
}
