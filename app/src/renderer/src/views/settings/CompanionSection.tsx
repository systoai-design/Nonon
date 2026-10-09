import { useEffect, useState } from "react";
import { COMPANIONS } from "../../components/companions";
import { NonArt } from "../../components/Non";
import { useAttempt } from "../lib";
import { ErrorLine, Switch } from "../ui";
import type { SettingsCtx } from "./types";

const SCREEN_SIZES = [
  { value: 0.8, label: "Smaller" },
  { value: 0.9, label: "Comfortable (default)" },
  { value: 1, label: "Large" },
  { value: 1.1, label: "Bigger" },
  { value: 1.25, label: "Much bigger" },
];

export function CompanionSection({ ctx }: { ctx: SettingsCtx }) {
  const { settings, patchSettings } = ctx;
  const scale = settings.uiScale ?? 0.9;
  const [name, setName] = useState(settings.companionName);
  const { error, attempt } = useAttempt();
  useEffect(() => setName(settings.companionName), [settings.companionName]);

  const commitName = () => {
    const next = name.trim();
    if (!next) {
      setName(settings.companionName);
      return;
    }
    if (next !== settings.companionName) void attempt(() => patchSettings({ companionName: next }));
  };

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h2>Your helper</h2>
        <p className="m-0 mt-1 muted">Choose a name for your helper. This does not change what NONON can do.</p>
      </div>

      <div className="flex max-w-sm flex-col gap-1.5">
        <label htmlFor="comp-name" className="font-medium">
          Name
        </label>
        <input
          id="comp-name"
          className="input"
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </div>

      <div role="radiogroup" aria-label="Your helper" className="flex flex-col gap-2">
        <span className="font-medium">Your helper</span>
        <div className="flex flex-wrap gap-3">
          {COMPANIONS.map((c) => {
            const on = settings.character === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => void attempt(() => patchSettings({ character: c.id }))}
                className="flex w-28 flex-col items-center gap-1 rounded-2xl border-2 px-3 py-3 text-[14px]"
                style={on ? { borderColor: "var(--accent)", background: "var(--accent-soft)", fontWeight: 750 } : { borderColor: "var(--line-strong)", background: "var(--card)" }}
              >
                <NonArt pose="rest" size={72} variant="avatar" />
                {c.name}
              </button>
            );
          })}
        </div>
        <p className="m-0 text-[14px] muted">Non is the only helper for now. More may come later.</p>
      </div>

      <div className="flex max-w-xl items-start justify-between gap-6">
        <div>
          <div className="font-medium" id="rm-label">
            Reduce motion
          </div>
          <p className="m-0 mt-0.5 text-[14px] muted">Keeps your helper still and turns off animations.</p>
        </div>
        <Switch checked={settings.reducedMotion} label="Reduce motion" onChange={(v) => void attempt(() => patchSettings({ reducedMotion: v }))} />
      </div>

      <div role="radiogroup" aria-labelledby="scale-label" className="flex max-w-xl flex-col gap-2">
        <div>
          <div className="font-medium" id="scale-label">
            Screen size
          </div>
          <p className="m-0 mt-0.5 text-[14px] muted">Makes everything in NONON smaller or bigger. Ctrl + and Ctrl - also work.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {SCREEN_SIZES.map((o) => {
            const on = Math.abs(scale - o.value) < 0.005;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                className={`choice ${on ? "selected" : ""}`}
                onClick={() => void attempt(() => patchSettings({ uiScale: o.value }))}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}
