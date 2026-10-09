import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { PACKS, type CompanionCharacter, type PackId } from "../../../shared/contracts";
import { api, isMock, refreshAppState, useAppState } from "../lib/bridge";
import { baseName, isRuntimeBusy, isRuntimeReady } from "../lib/format";
import logo from "../assets/brand/nonon-logo-horizontal-color.svg";
import { COMPANIONS, DEFAULT_COMPANION } from "../components/companions";
import { Icon } from "../components/Icon";
import { Non, NonArt } from "../components/Non";
import { statusFor, useOneShot, type NonState } from "../lib/companion";
import { PACK_ICONS, Spinner } from "../components/ui";
import { SetupPanel } from "./SetupPanel";

const STEP_TITLES = ["Meet Non", "What do you want help with?", "Get the built-in AI", "Pick a folder to work in"];

type FolderMode = "folder" | "sample";

export function Onboarding() {
  const app = useAppState();
  const runtime = app?.runtime;
  const [step, setStepRaw] = useState(0);
  // Which way the last step change went, so the next card slides in from the right (Continue) or the left (Back).
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const setStep = (n: number) => {
    setDir(n >= step ? "fwd" : "back");
    setStepRaw(n);
  };
  const [character, setCharacter] = useState<CompanionCharacter>(DEFAULT_COMPANION.id);
  const [name, setName] = useState(DEFAULT_COMPANION.name);
  const [nameTouched, setNameTouched] = useState(false);
  const [pack, setPack] = useState<PackId>("general");
  const [mode, setMode] = useState<FolderMode>("folder");
  const [folder, setFolder] = useState<string | null>(null);
  const [wsName, setWsName] = useState("");
  const [busy, setBusy] = useState(false);

  const ready = runtime ? isRuntimeReady(runtime.phase) : false;
  const downloading = runtime ? isRuntimeBusy(runtime.phase) : false;
  // Non waves once on arrival, thinks while the AI downloads, and celebrates once when it is ready.
  const { shot, fire } = useOneShot();
  useEffect(() => fire("greeting"), [fire]);
  useEffect(() => {
    if (step === 2 && ready) fire("success");
  }, [step, ready, fire]);
  const nonState: NonState = step === 2 && downloading ? "thinking" : (shot?.state ?? "idle");
  const nonName = name.trim() || DEFAULT_COMPANION.name;

  const outputPath = useMemo(() => {
    if (!folder) return "";
    const sep = folder.includes("\\") ? "\\" : "/";
    return `${folder.replace(/[\\/]+$/, "")}${sep}NONON Output`;
  }, [folder]);

  const pickCharacter = (c: CompanionCharacter) => {
    setCharacter(c);
    if (!nameTouched) setName(COMPANIONS.find((x) => x.id === c)?.name ?? DEFAULT_COMPANION.name);
  };

  async function chooseFolder() {
    const picked = await api.call("workspace:pick-folder", undefined).catch(() => null);
    if (!picked) return;
    setFolder(picked);
    if (!wsName) setWsName(baseName(picked));
  }

  async function finish(withFolder: boolean) {
    setBusy(true);
    try {
      const f = withFolder ? folder : null;
      const label = PACKS.find((p) => p.id === pack)?.label ?? "My files";
      const ws = await api.call("workspace:create", { name: wsName.trim() || (f ? baseName(f) : label), folder: f, pack });
      if (f && mode === "sample") await api.call("workspace:add-samples", { id: ws.id });
      await api.call("settings:update", { onboarded: true, companionName: nonName, character, activeWorkspaceId: ws.id });
      await refreshAppState();
    } catch {
      setBusy(false);
    }
  }

  // The still pose beside the form follows the same state as the animated face.
  const pose = nonState === "success" ? "success" : nonState === "greeting" ? "wave" : "rest";

  return (
    <div className="onboard">
      {isMock() && <span className="chip chip-attn onboard-demo">Demo data</span>}
      <aside className="onboard-side">
        <img className="onboard-logo" src={logo} alt="NONON" />
        <p className="onboard-tag">A little help for your everyday work.</p>
        <div className="onboard-hero">
          <NonArt pose={pose} size={250} />
        </div>
      </aside>
      <div className="onboard-card">
        <div className="onboard-top">
          <Non state={nonState} replayKey={shot?.epoch ?? 0} size={step === 0 ? 88 : 64} />
          <div>
            <p className="eyebrow">
              Step {step + 1} of {STEP_TITLES.length}. {statusFor(nonState, nonName)}
            </p>
            <h1 key={step} className={`step-${dir}`}>{STEP_TITLES[step]}</h1>
          </div>
        </div>
        <div className="steps-dots" aria-hidden="true">
          {STEP_TITLES.map((t, i) => (
            <span key={t} className={i === step ? "on" : i < step ? "past" : ""} />
          ))}
        </div>

        <div className={`onboard-body step-${dir}`} key={step}>
          {step === 0 && (
            <>
              <p className="lead">Non is your helper. It keeps you company while you work, and shows you every change before it happens.</p>
              <div className="char-grid" role="radiogroup" aria-label="Your helper">
                {COMPANIONS.map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={character === c.id} className={`char-card ${character === c.id ? "selected" : ""}`} onClick={() => pickCharacter(c.id)}>
                    <NonArt pose="rest" size={88} variant="avatar" />
                    <strong>{c.name}</strong>
                    <span className="muted small">{c.blurb}</span>
                  </button>
                ))}
                <p className="muted small char-more">Non is the only helper for now. More may come later.</p>
              </div>
              <label className="field">
                <span>What would you like to call your helper?</span>
                <input
                  className="input"
                  value={name}
                  maxLength={24}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameTouched(true);
                  }}
                />
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <p className="lead">This sets which ideas you see first. You can add more projects later.</p>
              <div className="pack-grid" role="radiogroup" aria-label="What do you want help with">
                {PACKS.map((p) => {
                  const PackIcon = PACK_ICONS[p.id];
                  return (
                    <button key={p.id} type="button" role="radio" aria-checked={pack === p.id} className={`pack-card ${pack === p.id ? "selected" : ""}`} onClick={() => setPack(p.id)}>
                      <span className="pack-icon">
                        <PackIcon size={22} />
                      </span>
                      <span className="pack-text">
                        <strong>{p.label}</strong>
                        <span className="muted">{p.blurb}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="lead">NONON comes with its own AI that runs on this computer, so your files stay here.</p>
              <SetupPanel />
            </>
          )}

          {step === 3 && (
            <>
              <p className="lead">NONON only works inside a folder you choose. It never touches anything else on your computer.</p>
              <div className="pack-grid" role="radiogroup" aria-label="How to start">
                <button type="button" role="radio" aria-checked={mode === "folder"} className={`pack-card ${mode === "folder" ? "selected" : ""}`} onClick={() => setMode("folder")}>
                  <span className="pack-icon">
                    <Icon name="folder" size={22} tone="current" />
                  </span>
                  <span className="pack-text">
                    <strong>Use my own folder</strong>
                    <span className="muted">Pick a folder with your files in it.</span>
                  </span>
                </button>
                <button type="button" role="radio" aria-checked={mode === "sample"} className={`pack-card ${mode === "sample" ? "selected" : ""}`} onClick={() => setMode("sample")}>
                  <span className="pack-icon">
                    <FlaskConical size={22} aria-hidden="true" />
                  </span>
                  <span className="pack-text">
                    <strong>Try sample files</strong>
                    <span className="muted">Choose or create an empty folder. We will put sample files in it.</span>
                  </span>
                </button>
              </div>
              <div className="folder-row">
                <button type="button" className="btn" onClick={() => void chooseFolder()}>
                  <Icon name="folder" size={18} />
                  {folder ? "Choose a different folder" : mode === "sample" ? "Choose an empty folder" : "Choose a folder"}
                </button>
                {folder && (
                  <span className="folder-path" title={folder}>
                    {folder}
                  </span>
                )}
              </div>
              {folder && (
                <>
                  <label className="field">
                    <span>Project name</span>
                    <input className="input" value={wsName} maxLength={40} onChange={(e) => setWsName(e.target.value)} />
                  </label>
                  <p className="note">
                    NONON saves everything it makes in a folder called <strong>NONON Output</strong> inside your folder:
                    <br />
                    <span className="mono small" title={outputPath}>
                      {outputPath}
                    </span>
                  </p>
                </>
              )}
            </>
          )}
        </div>

        <div className="onboard-foot">
          {step > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)} disabled={busy}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
          ) : (
            <span />
          )}
          <div className="onboard-foot-right">
            {step === 2 && !ready && (
              <button type="button" className="btn btn-ghost" onClick={() => setStep(3)}>
                Skip for now
              </button>
            )}
            {step === 3 && !folder && (
              <button type="button" className="btn btn-ghost" onClick={() => void finish(false)} disabled={busy}>
                Choose later
              </button>
            )}
            {step < 3 ? (
              <button type="button" className="btn btn-primary" onClick={() => setStep(step + 1)} disabled={(step === 0 && !name.trim()) || (step === 2 && !ready)}>
                Continue
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => void finish(true)} disabled={!folder || busy}>
                {busy ? <Spinner /> : null}
                Start using NONON
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
