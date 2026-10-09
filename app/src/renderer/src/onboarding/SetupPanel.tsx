import { useEffect, useState } from "react";
import { HardDrive, MemoryStick } from "lucide-react";
import type { HardwareReport, ModelRecommendation } from "../../../shared/contracts";
import { api, useAppState } from "../lib/bridge";
import { formatBytes, isRuntimeBusy, isRuntimeReady, plainError, setupPhaseLabel } from "../lib/format";
import { Spinner } from "../components/ui";
import { Icon } from "../components/Icon";

interface Assessment {
  report: HardwareReport;
  recommendation: ModelRecommendation | null;
}

const STEPS = ["Getting the AI ready", "Downloading the built-in AI", "Checking the download", "Ready"];

const GB = 1024 ** 3;

function stepIndex(phase: string): number {
  if (phase === "downloading-runtime") return 0;
  if (phase === "downloading-model") return 1;
  if (phase === "verifying" || phase === "installing") return 2;
  return 3;
}

/** Shared by first-run onboarding and the "AI setup not finished" dialog. */
export function SetupPanel() {
  const app = useAppState();
  const runtime = app?.runtime;
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .call("hardware:assess", undefined, { silent: true })
      .then((r) => alive && setAssessment({ report: r.report, recommendation: r.recommendation }))
      .catch((e) => alive && setError(plainError(e)));
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (error) {
    return (
      <div className="notice notice-attn" role="alert">
        <Icon name="alert" size={20} tone="current" />
        <div>
          <p className="notice-title">NONON could not check this computer.</p>
          <p className="muted">{error}</p>
          <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!assessment || !runtime) {
    return (
      <div className="setup-loading" role="status">
        <Spinner size={20} />
        <span>Checking this computer...</span>
      </div>
    );
  }

  const { report, recommendation } = assessment;

  if (!report.supported || !recommendation) {
    return (
      <div className="notice notice-attn" role="status">
        <Icon name="alert" size={20} tone="current" />
        <div>
          <p className="notice-title">The built-in AI will not run on this computer.</p>
          <p className="muted">{report.unsupportedReason ?? "This computer does not have enough memory for it."}</p>
          <p className="muted">You can skip this step. Later, you can connect an online AI like Claude in Connections.</p>
        </div>
      </div>
    );
  }

  const phase = runtime.phase;

  if (isRuntimeReady(phase)) {
    return (
      <div className="notice notice-ok" role="status">
        <Icon name="check" size={20} tone="current" />
        <div>
          <p className="notice-title">The built-in AI is ready.</p>
          <p className="muted">It runs on this computer, so it works without the internet.</p>
        </div>
      </div>
    );
  }

  if (isRuntimeBusy(phase)) {
    const active = stepIndex(phase);
    const pct = runtime.progress != null ? Math.round(runtime.progress * 100) : null;
    return (
      <div className="setup-progress" role="status" aria-live="polite">
        <h3>{setupPhaseLabel(phase)}</h3>
        <ol className="setup-steps">
          {STEPS.map((label, i) => (
            <li key={label} className={i < active ? "done" : i === active ? "active" : ""}>
              <span className="setup-mark" aria-hidden="true">
                {i < active ? <Icon name="check" size={20} tone="current" /> : i === active ? <Spinner size={18} /> : <span className="setup-dot" />}
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
        <div
          className={`bar ${pct == null ? "bar-indeterminate" : ""}`}
          role="progressbar"
          aria-label={setupPhaseLabel(phase)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
        >
          <div className="bar-fill" style={pct == null ? undefined : { width: `${pct}%` }} />
        </div>
        <p className="muted small">
          {pct != null && runtime.bytesTotal ? `${formatBytes(runtime.bytesDone)} of ${formatBytes(runtime.bytesTotal)} (${pct}%)` : "Working on it. This can take a few minutes."}
        </p>
        <button type="button" className="btn" onClick={() => void api.call("runtime:cancel", undefined)}>
          Cancel
        </button>
      </div>
    );
  }

  const failed = phase === "failed";
  const good = recommendation.mode !== "limited";
  const tightDisk = report.diskFreeBytes < Math.max(6 * GB, recommendation.downloadBytes * 1.5);
  return (
    <div className="setup-intro">
      {failed ? (
        <div className="notice notice-attn" role="alert">
          <Icon name="alert" size={20} tone="current" />
          <div>
            <p className="notice-title">The setup did not finish.</p>
            <p className="muted">{runtime.error ? plainError(runtime.error) : "Something went wrong while getting the built-in AI. Check your internet connection and try again."}</p>
          </div>
        </div>
      ) : (
        <div className={`notice ${good ? "notice-ok" : "notice-info"}`}>
          {good ? <Icon name="check" size={20} tone="current" /> : <Icon name="alert" size={20} tone="current" />}
          <div>
            <p className="notice-title">{good ? "Your computer is a good fit" : "This computer may be slow with the built-in AI. You can still use it."}</p>
            <p className="muted">NONON will download its built-in AI once (about {formatBytes(recommendation.downloadBytes)}). After that it works without the internet.</p>
          </div>
        </div>
      )}
      <ul className="facts" aria-label="About this computer">
        <li>
          <MemoryStick size={18} aria-hidden="true" />
          <span>Memory</span>
          <strong>{formatBytes(report.ramBytes)}</strong>
        </li>
        <li>
          <Icon name="device" size={20} tone="accent" />
          <span>Graphics card</span>
          <strong>{report.gpuName ?? "None found"}</strong>
        </li>
        <li>
          <HardDrive size={18} aria-hidden="true" />
          <span>Free space</span>
          <strong>{formatBytes(report.diskFreeBytes)}</strong>
        </li>
      </ul>
      <div className="reco">
        <div className="reco-head">
          <h3>Built-in AI</h3>
          <span className="chip chip-ok">{good ? "Good fit" : "May be slow"}</span>
        </div>
        <p>It runs on this computer. No account needed.</p>
        <p className="muted small">One-time download: {formatBytes(recommendation.downloadBytes)}.</p>
        {tightDisk && <p className="muted small">This computer is short on free space. Free up some space before you start.</p>}
        <p className="muted small">How fast it feels depends on your computer and what else is open.</p>
      </div>
      <button type="button" className="btn btn-primary btn-lg" onClick={() => void api.call("runtime:install", { modelId: recommendation.modelId })}>
        {failed ? "Try again" : "Download and set up"}
      </button>
    </div>
  );
}
