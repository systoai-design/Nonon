import { useEffect, useState } from "react";
import { Stethoscope } from "lucide-react";
import type { HardwareReport, RuntimePhase, RuntimeStatus } from "../../../../shared/contracts";
import { call, errMsg, formatBytes, useAttempt, useCall, useEvent } from "../lib";
import { ConfirmButton, CopyButton, ErrorLine, Loading, Spinner } from "../ui";
import type { SettingsCtx } from "./types";
import { Icon } from "../../components/Icon";
import { ExistingAiBlock } from "./ExistingAiBlock";

export const PHASE_WORDS: Record<RuntimePhase, { label: string; tone: string }> = {
  "not-installed": { label: "Not set up yet", tone: "chip-attn" },
  "downloading-runtime": { label: "Getting the AI ready", tone: "chip-info" },
  "downloading-model": { label: "Downloading the built-in AI", tone: "chip-info" },
  verifying: { label: "Checking the download", tone: "chip-info" },
  installing: { label: "Setting up", tone: "chip-info" },
  ready: { label: "Ready, resting", tone: "chip-ok" },
  starting: { label: "Starting", tone: "chip-info" },
  running: { label: "Running on this computer", tone: "chip-ok" },
  sleeping: { label: "Resting to save memory", tone: "chip-ok" },
  failed: { label: "Needs a look", tone: "chip-red" },
};

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="muted">{k}</dt>
      <dd className="m-0 break-all">{v}</dd>
    </>
  );
}

function HardwareBlock({ report }: { report: HardwareReport }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[14px]">
      <Row k="Processor" v={`${report.cpu} (${report.cores} cores)`} />
      <Row k="Memory" v={`${formatBytes(report.ramBytes)} total, ${formatBytes(report.freeRamBytes)} free`} />
      <Row k="Graphics card" v={report.gpuName ? `${report.gpuName}${report.gpuMemoryBytes ? `, ${formatBytes(report.gpuMemoryBytes)}` : ""}` : "None found"} />
      <Row k="Speed-up used" v={report.accel === "cpu" ? "None (processor only)" : report.accel} />
      <Row k="Free disk space" v={formatBytes(report.diskFreeBytes)} />
      <Row k="AI files are in" v={report.modelDir} />
      <Row k="System" v={`${report.platform} ${report.arch}`} />
      <Row k="Works with NONON" v={report.supported ? "Yes" : `No. ${report.unsupportedReason ?? ""}`} />
    </dl>
  );
}

export function AdvancedAiSection({ ctx }: { ctx: SettingsCtx }) {
  const status = useCall("runtime:status", undefined);
  useEvent("runtime:status", (s: RuntimeStatus) => status.setData(s));
  const rt = status.data;

  const [minutes, setMinutes] = useState(String(Math.round(ctx.settings.idleUnloadSeconds / 60)));
  useEffect(() => setMinutes(String(Math.round(ctx.settings.idleUnloadSeconds / 60))), [ctx.settings.idleUnloadSeconds]);

  const power = useAttempt();
  const idle = useAttempt();
  const hw = useAttempt();
  const diag = useAttempt();
  const [busy, setBusy] = useState<null | "start" | "stop">(null);
  const [hardware, setHardware] = useState<HardwareReport | null>(null);
  const [diagText, setDiagText] = useState<string | null>(null);
  const [loadingHw, setLoadingHw] = useState(false);
  const [loadingDiag, setLoadingDiag] = useState(false);

  const phase = rt ? PHASE_WORDS[rt.phase] : null;
  const running = rt?.phase === "running" || rt?.phase === "starting" || rt?.phase === "sleeping";
  const canStart = rt && ["ready", "sleeping", "failed"].includes(rt.phase);

  const startStop = async (kind: "start" | "stop") => {
    setBusy(kind);
    await power.attempt(async () => {
      await call(kind === "start" ? "runtime:start" : "runtime:stop", undefined);
      status.setData(await call("runtime:status", undefined));
    });
    setBusy(null);
  };

  const commitMinutes = () => {
    const n = Math.round(Number(minutes));
    if (!Number.isFinite(n) || n < 1 || n > 600) {
      setMinutes(String(Math.round(ctx.settings.idleUnloadSeconds / 60)));
      return;
    }
    if (n * 60 !== ctx.settings.idleUnloadSeconds) void idle.attempt(() => ctx.patchSettings({ idleUnloadSeconds: n * 60 }));
  };

  const loadHardware = async () => {
    setLoadingHw(true);
    const r = await hw.attempt(() => call("hardware:assess", undefined));
    if (r) setHardware(r.report);
    setLoadingHw(false);
  };

  const loadDiagnostics = async () => {
    setLoadingDiag(true);
    const r = await diag.attempt(() => call("diagnostics:snapshot", undefined));
    if (r) setDiagText(`${JSON.stringify({ runtime: r.runtime, hardware: r.hardware }, null, 2)}\n\nRecent activity\n${r.log.join("\n")}`);
    setLoadingDiag(false);
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2>Advanced</h2>
        <p className="m-0 mt-1 muted">Most people never need this page. NONON looks after the AI on this computer for you.</p>
      </div>

      <section className="card flex max-w-2xl flex-col gap-4 p-5" aria-label="AI on this computer">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2">
            <Icon name="device" size={20} tone="accent" /> AI on this computer
          </h3>
          {phase && <span className={`chip ${phase.tone}`}>{phase.label}</span>}
        </div>
        {status.loading && <Loading />}
        {status.error && <ErrorLine>{status.error}</ErrorLine>}
        {rt && (
          <>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[14px]">
              <Row k={ctx.settings.customModel ? "AI in use" : "Built-in AI"} v={rt.modelLabel ?? rt.modelId ?? "Not chosen yet"} />
              <Row k="Status" v={rt.detail} />
              {rt.progress !== null && <Row k="Progress" v={`${Math.round(rt.progress * 100)}%`} />}
              {rt.peakRssBytes ? <Row k="Most memory used" v={formatBytes(rt.peakRssBytes)} /> : null}
            </dl>
            {rt.error && <ErrorLine>{errMsg(rt.error)}</ErrorLine>}
          </>
        )}
        <div className="flex flex-wrap gap-3">
          {running ? (
            <button type="button" className="btn" disabled={busy !== null} onClick={() => startStop("stop")}>
              {busy === "stop" ? <Spinner /> : <Icon name="stop" size={17} tone="current" />} Stop the built-in AI
            </button>
          ) : (
            <button type="button" className="btn" disabled={busy !== null || !canStart} onClick={() => startStop("start")}>
              {busy === "start" ? <Spinner /> : <Icon name="play" size={17} tone="current" />} Start the built-in AI
            </button>
          )}
          <ConfirmButton
            className="btn"
            label="Run setup again"
            confirmLabel="Yes, open setup again"
            onConfirm={() => void power.attempt(() => ctx.patchSettings({ onboarded: false }))}
          />
        </div>
        <p className="m-0 text-[13px] muted">Running setup again takes you through the first steps again. Your projects and files are not touched.</p>
        {power.error && <ErrorLine>{power.error}</ErrorLine>}
      </section>

      <ExistingAiBlock settings={ctx.settings} />

      <section className="flex max-w-2xl flex-col gap-2" aria-label="Free up memory">
        <label htmlFor="idle-min" className="font-medium">
          Free up memory when idle
        </label>
        <div className="flex items-center gap-3">
          <input
            id="idle-min"
            type="number"
            min={1}
            max={600}
            className="input !w-24"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            onBlur={commitMinutes}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <span className="muted">minutes without use</span>
        </div>
        <p className="m-0 text-[14px] muted">After this long, the AI rests so your computer has its memory back. It wakes up on its own when you need it.</p>
        {idle.error && <ErrorLine>{idle.error}</ErrorLine>}
      </section>

      <section className="flex max-w-2xl flex-col gap-3" aria-label="This computer">
        <h3>This computer</h3>
        <div>
          <button type="button" className="btn" disabled={loadingHw} onClick={loadHardware}>
            {loadingHw ? <Spinner /> : <Icon name="device" size={17} tone="accent" />} {hardware ? "Check again" : "Check this computer"}
          </button>
        </div>
        {hardware && <HardwareBlock report={hardware} />}
        {hw.error && <ErrorLine>{hw.error}</ErrorLine>}
      </section>

      <section className="flex max-w-2xl flex-col gap-3" aria-label="Troubleshooting">
        <h3>Troubleshooting</h3>
        <p className="m-0 text-[14px] muted">Technical details that help when something goes wrong. Look them over before you share them with anyone.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn" disabled={loadingDiag} onClick={loadDiagnostics}>
            {loadingDiag ? <Spinner /> : <Stethoscope size={15} aria-hidden />} {diagText ? "Refresh details" : "Show details"}
          </button>
          {diagText && <CopyButton text={diagText} label="Copy details" />}
        </div>
        {diagText && (
          <pre
            className="mono m-0 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl border p-3 text-[12.5px]"
            style={{ borderColor: "var(--line)", background: "var(--card)" }}
            tabIndex={0}
          >
            {diagText}
          </pre>
        )}
        {diag.error && <ErrorLine>{diag.error}</ErrorLine>}
      </section>
    </div>
  );
}
