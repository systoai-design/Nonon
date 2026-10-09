import { useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "../components/Icon";
import type { RuntimePhase, Workspace } from "../../../shared/contracts";
import { call, useCall, useEvent } from "./lib";
import { useSlidingIndicator } from "../lib/motion";
import { ErrorLine, Loading } from "./ui";
import { AboutSection } from "./settings/AboutSection";
import { AdvancedAiSection } from "./settings/AdvancedAiSection";
import { ApprovalsSection } from "./settings/ApprovalsSection";
import { CompanionSection } from "./settings/CompanionSection";
import type { SettingsCtx } from "./settings/types";
import { WorkspacesSection } from "./settings/WorkspacesSection";

type TabId = "companion" | "workspaces" | "approvals" | "advanced" | "about";

const TABS: { id: TabId; label: string; glyph: IconName }[] = [
  { id: "companion", label: "Your helper", glyph: "person" },
  { id: "workspaces", label: "Projects", glyph: "folder" },
  { id: "approvals", label: "Changes and backups", glyph: "restore" },
  { id: "advanced", label: "Advanced", glyph: "settings" },
  { id: "about", label: "About", glyph: "info" },
];

const HEADLINE: Record<RuntimePhase, { text: string; color: string }> = {
  "not-installed": { text: "The built-in AI is not set up yet", color: "var(--attn)" },
  "downloading-runtime": { text: "Setting up the built-in AI", color: "var(--info)" },
  "downloading-model": { text: "Setting up the built-in AI", color: "var(--info)" },
  verifying: { text: "Setting up the built-in AI", color: "var(--info)" },
  installing: { text: "Setting up the built-in AI", color: "var(--info)" },
  ready: { text: "AI on this computer", color: "var(--ink)" },
  starting: { text: "AI on this computer is starting", color: "var(--info)" },
  running: { text: "AI on this computer", color: "var(--ink)" },
  sleeping: { text: "AI on this computer is resting", color: "var(--ink)" },
  failed: { text: "AI on this computer needs a look", color: "var(--red)" },
};

export function SettingsView() {
  const app = useCall("app:state", undefined);
  const [tab, setTab] = useState<TabId>("companion");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabsRef = useRef<HTMLDivElement>(null);
  useSlidingIndicator(tabsRef, [tab, app.loading]);

  useEvent("settings:updated", (s) => app.setData((prev) => (prev ? { ...prev, settings: s } : prev)));
  useEvent("runtime:status", (r) => app.setData((prev) => (prev ? { ...prev, runtime: r } : prev)));

  const data = app.data;
  const ctx: SettingsCtx | null = data
    ? {
        settings: data.settings,
        workspaces: data.workspaces,
        version: data.version,
        platform: data.platform,
        patchSettings: async (patch) => {
          const s = await call("settings:update", patch);
          app.setData((prev) => (prev ? { ...prev, settings: s } : prev));
        },
        patchWorkspace: async (id, patch) => {
          const w: Workspace = await call("workspace:update", { id, patch });
          app.setData((prev) => (prev ? { ...prev, workspaces: prev.workspaces.map((x) => (x.id === w.id ? w : x)) } : prev));
        },
        removeWorkspace: async (id) => {
          await call("workspace:remove", { id });
          app.setData((prev) => (prev ? { ...prev, workspaces: prev.workspaces.filter((x) => x.id !== id) } : prev));
        },
      }
    : null;

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length];
    if (!t) return;
    setTab(t.id);
    tabRefs.current[t.id]?.focus();
  };

  const headline = data ? HEADLINE[data.runtime.phase] : null;

  return (
    <section className="scroll-y h-full">
      <div className="col pt-4 pb-8">
        <header className="mb-6">
          {headline && (
            <p className="m-0 flex items-center gap-2 muted" role="status">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: headline.color }} aria-hidden />
              {headline.text}
            </p>
          )}
        </header>

        {app.loading && <Loading />}
        {app.error && (
          <ErrorLine>{app.error}</ErrorLine>
        )}

        {ctx && (
          <div className="flex flex-col gap-6 md:flex-row">
            <div ref={tabsRef} role="tablist" aria-label="Settings sections" aria-orientation="vertical" className="slide-wash flex shrink-0 gap-1 overflow-x-auto md:w-60 md:flex-col md:overflow-visible">
              {TABS.map(({ id, label, glyph }, i) => {
                const on = tab === id;
                return (
                  <button
                    key={id}
                    ref={(el) => {
                      tabRefs.current[id] = el;
                    }}
                    type="button"
                    role="tab"
                    id={`tab-${id}`}
                    aria-selected={on}
                    aria-controls={`panel-${id}`}
                    tabIndex={on ? 0 : -1}
                    onClick={() => setTab(id)}
                    onKeyDown={(e) => onTabKey(e, i)}
                    className="flex items-center gap-3 whitespace-nowrap rounded-xl px-4 py-3 text-left text-[15px]"
                    style={on ? { fontWeight: 800 } : { color: "var(--ink)" }}
                  >
                    <Icon name={glyph} size={22} tone="current" /> {label}
                  </button>
                );
              })}
            </div>
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-w-0 flex-1 md:border-l md:pl-8" style={{ borderColor: "var(--line)" }} tabIndex={0}>
              <div className="swap" key={tab}>
              {tab === "companion" && <CompanionSection ctx={ctx} />}
              {tab === "workspaces" && <WorkspacesSection ctx={ctx} />}
              {tab === "approvals" && <ApprovalsSection ctx={ctx} />}
              {tab === "advanced" && <AdvancedAiSection ctx={ctx} />}
              {tab === "about" && <AboutSection ctx={ctx} />}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
