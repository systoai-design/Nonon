import { ArrowRight, FlaskConical } from "lucide-react";
import type { ProcedureInfo, Workspace } from "../../../shared/contracts";
import { api, tasksReady, toast, useAppState, useProcedures, useTasks } from "../lib/bridge";
import { formatWhen, greeting, isRuntimeBusy, stateLabel } from "../lib/format";
import { useNonMood } from "../lib/companion";
import { useFirstShow } from "../lib/motion";
import { Icon } from "./Icon";
import { Non } from "./Non";
import { PACK_ICONS } from "./ui";

function StarterCard({ proc, onStart, index }: { proc: ProcedureInfo; onStart: () => void; index: number }) {
  const PackIcon = PACK_ICONS[proc.pack];
  const tipId = `limits-${proc.id}`;
  return (
    <article className="starter card" style={{ "--i": index } as React.CSSProperties}>
      <div className="starter-top">
        <span className="pack-icon">
          <PackIcon size={22} />
        </span>
        <div className="tip-wrap">
          <button type="button" className="icon-btn icon-btn-sm" aria-describedby={tipId} aria-label={`Good to know about ${proc.title}`}>
            <Icon name="info" size={18} />
          </button>
          <div role="tooltip" id={tipId} className="tip">
            <strong>Good to know</strong>
            <ul>
              {proc.limits.slice(0, 2).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <h3>{proc.title}</h3>
      <p>{proc.summary}</p>
      <p className="muted small starter-supports">{proc.supports}</p>
      <button type="button" className="btn starter-go" onClick={onStart}>
        Start <ArrowRight size={15} aria-hidden="true" />
      </button>
    </article>
  );
}

export function HomeView({
  workspace,
  onStart,
  onOpenWorkspace,
  onAddWorkspace,
  onViewResults,
}: {
  workspace: Workspace | null;
  onStart: (procedureId: string, files?: string[]) => void;
  onOpenWorkspace: () => void;
  onAddWorkspace: () => void;
  onViewResults?: (taskId: string, path?: string) => void;
}) {
  const app = useAppState();
  const settings = app?.settings;
  const procedures = useProcedures(workspace?.pack ?? null);
  const tasks = useTasks(workspace?.id ?? null);
  const ready = workspace ? tasksReady(workspace.id) : false;
  const name = settings?.companionName ?? "Non";
  const mood = useNonMood();
  const firstStarters = useFirstShow("home-starters");
  const firstRecent = useFirstShow("home-recent");
  const aiBusy = app ? isRuntimeBusy(app.runtime.phase) : false;

  if (!workspace) {
    return (
      <div className="page">
<div className="home">
        <div className="home-hero">
          <Non state={mood.state} replayKey={mood.epoch} size={96} />
          <div>
            <h2 className="hero-title">{greeting()}.</h2>
            <p className="muted small">{mood.status}</p>
            <p className="muted">Add a project to get started. A project is a folder on this computer that NONON can work in.</p>
            <button type="button" className="btn btn-primary" onClick={onAddWorkspace}>
              Add a project
            </button>
          </div>
        </div>
      </div>
      </div>
    );
  }

  async function trySample() {
    if (!workspace) return;
    try {
      let folder = workspace.folder;
      if (!folder) {
        toast("Choose or create an empty folder. We will put sample files in it.", "info");
        folder = await api.call("workspace:pick-folder", undefined);
        if (!folder) return;
        await api.call("workspace:update", { id: workspace.id, patch: { folder } });
      }
      const files = await api.call("workspace:add-samples", { id: workspace.id });
      toast("Sample files were added to a Samples folder inside your folder.", "success");
      const first = (procedures.length ? procedures : await api.call("procedure:list", { pack: workspace.pack }))[0];
      if (first) onStart(first.id, files.filter((f) => f.supported).map((f) => f.path));
    } catch {
      /* toast already shown */
    }
  }

  const recent = tasks.slice(0, 5);
  const showSample = ready && tasks.length === 0 && procedures.length > 0;

  return (
    <div className="page">
<div className="home">
      <div className="home-hero">
        <Non state={mood.state} replayKey={mood.epoch} size={96} />
        <div>
          <h2 className="hero-title">{greeting()}.</h2>
          <p className="muted small">{mood.status}</p>
          <p className="lead">
            {name} is ready to help in <strong>{workspace.name}</strong>. Pick something to start, or just tell {name} what you need.
          </p>
          {aiBusy && <p className="muted small">The built-in AI is still being set up. You can start now. Your task will begin when it is ready.</p>}
        </div>
      </div>

      <section aria-labelledby="starters">
        <h2 id="starters">Ways to start</h2>
        <div className="starter-grid" data-stagger={firstStarters || undefined}>
          {procedures.map((p, i) => (
            <StarterCard key={p.id} proc={p} index={i} onStart={() => onStart(p.id)} />
          ))}
          {showSample && (
            <article className="starter card sample">
              <div className="starter-top">
                <span className="pack-icon">
                  <FlaskConical size={20} aria-hidden="true" />
                </span>
              </div>
              <h3>Try the sample</h3>
              <p>See how it works with practice files. Nothing of yours is touched.</p>
              <p className="muted small starter-supports">NONON puts the practice files in a folder called Samples inside your project folder.</p>
              <button type="button" className="btn btn-primary starter-go" onClick={() => void trySample()}>
                Try the sample <ArrowRight size={15} aria-hidden="true" />
              </button>
            </article>
          )}
        </div>
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="recent">
          <h2 id="recent">Recent</h2>
          <ul className="recent card" data-stagger={firstRecent || undefined}>
            {recent.map((t, i) => (
              <li key={t.id} style={{ "--i": i } as React.CSSProperties}>
                <button type="button" onClick={onOpenWorkspace}>
                  <span className="recent-title">{t.title}</span>
                  <span className={`chip ${t.state === "complete" || t.state === "review" ? "chip-ok" : t.state === "needs-attention" || t.state === "failed" ? "chip-attn" : ""}`}>{stateLabel(t.state)}</span>
                  <span className="muted small recent-time">{formatWhen(t.updatedAt)}</span>
                </button>
                {onViewResults && t.outputs.length > 0 && (
                  <button type="button" className="recent-results" onClick={() => onViewResults(t.id)} aria-label={`See the results of ${t.title}`}>
                    <Icon name="review" size={16} /> See results
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
    </div>
  );
}
