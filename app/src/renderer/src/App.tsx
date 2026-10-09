import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markViewTransitionSupport, usePresence, viewTransition } from "./lib/motion";
import { api, isMock, onResultsReady, startBridge, updateSettings, useAllTasks, useAppState, useChanges, useTasks } from "./lib/bridge";
import { isActive, isRuntimeBusy, isRuntimeReady, setupPhaseLabel } from "./lib/format";
import { ConversationView, type StarterRequest } from "./chat/ConversationView";
import { Onboarding } from "./onboarding/Onboarding";
import { SetupPanel } from "./onboarding/SetupPanel";
import { AddWorkspaceDialog } from "./components/AddWorkspaceDialog";
import { HomeView } from "./components/HomeView";
import { Icon } from "./components/Icon";
import { SlideTabs } from "./components/SlideTabs";
import { Sidebar, type View } from "./components/Sidebar";
import { TitleStrip } from "./components/TitleStrip";
import { NonMoodContext, useShellMood } from "./lib/companion";
import { LocationIndicator, Modal, Spinner, Toasts } from "./components/ui";
import { ConnectionsView } from "./views/ConnectionsView";
import { ReviewPanel } from "./views/ReviewPanel";
import { ResultsPanel } from "./results/ResultsPanel";
import { primaryOutput } from "./results/usePreview";
import { RoutinesView } from "./views/RoutinesView";
import { SettingsView } from "./views/SettingsView";

type Dock = { mode: "review"; taskId: string | null } | { mode: "results"; taskId: string; path: string | null };

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem("nonon.sidebar.collapsed") === "1";
  } catch {
    return false;
  }
}

export function App() {
  useEffect(() => startBridge(), []);
  useEffect(() => markViewTransitionSupport(), []);
  const app = useAppState();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("reduced-motion", app?.settings.reducedMotion === true);
  }, [app?.settings.reducedMotion]);

  // Mascot animation is CSS only; pausing it while the window is hidden avoids wasted frames.
  useEffect(() => {
    const sync = () => {
      document.documentElement.dataset.hidden = document.hidden ? "true" : "false";
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return (
    <div className="frame">
      <TitleStrip />
      <div className="frame-body">
        {!app ? (
          <div className="splash" role="status">
            <Spinner size={22} />
            <span>Starting NONON...</span>
          </div>
        ) : app.settings.onboarded ? (
          <Shell />
        ) : (
          <Onboarding />
        )}
      </div>
      <Toasts />
    </div>
  );
}

function Shell() {
  const app = useAppState();
  const [view, setView] = useState<View>("home");
  const [pinnedCollapsed, setCollapsed] = useState(readCollapsed);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const collapsed = pinnedCollapsed || narrow;
  const [dock, setDock] = useState<Dock | null>(null);
  const [dockWide, setDockWide] = useState(false);
  const lastResultsTask = useRef<string | null>(null);
  const [starter, setStarter] = useState<StarterRequest | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [adding, setAdding] = useState(false);

  const workspaces = useMemo(() => app?.workspaces ?? [], [app?.workspaces]);
  const settings = app?.settings;
  const runtime = app?.runtime;
  const active = workspaces.find((w) => w.id === settings?.activeWorkspaceId) ?? workspaces[0] ?? null;

  const tasks = useTasks(active?.id ?? null);
  const allTasks = useAllTasks(workspaces.map((w) => w.id));
  const changes = useChanges(active?.id ?? null);
  const staged = changes.filter((c) => c.status === "staged").length;
  const running = tasks.filter((t) => isActive(t.state));
  const workingIds = useMemo(() => new Set(allTasks.filter((t) => isActive(t.state)).map((t) => t.workspaceId)), [allTasks]);

  const latest = tasks[0];
  const mood = useShellMood({ name: settings?.companionName ?? "Non", workspaceId: active?.id ?? null, working: workingIds.size > 0 });

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem("nonon.sidebar.collapsed", c ? "0" : "1");
      } catch {
        /* preference only */
      }
      return !c;
    });
  };

  const go = useCallback((next: View) => viewTransition(() => setView(next)), []);
  const selectWorkspace = useCallback((id: string) => {
    void updateSettings({ activeWorkspaceId: id });
    viewTransition(() => {
      setView("workspace");
      setDock(null);
    });
  }, []);

  const viewResults = useCallback((taskId: string, path?: string) => {
    lastResultsTask.current = taskId;
    setDock({ mode: "results", taskId, path: path ?? null });
  }, []);

  // Open the viewer once for a task the user just started here. It never takes keyboard focus, and it
  // leaves a Review panel that is already open alone.
  const live = useRef({ activeId: active?.id ?? null, view });
  live.current = { activeId: active?.id ?? null, view };
  useEffect(
    () =>
      onResultsReady((t) => {
        if (t.workspaceId !== live.current.activeId || (live.current.view !== "home" && live.current.view !== "workspace")) return;
        lastResultsTask.current = t.id;
        setDock((cur) => (cur?.mode === "review" ? cur : { mode: "results", taskId: t.id, path: primaryOutput(t.outputs)?.path ?? null }));
      }),
    [],
  );

  // The dock stays mounted for its exit animation, so remember what it last showed.
  const wantsDock = dock !== null && active !== null && (view === "home" || view === "workspace");
  const presence = usePresence(wantsDock, 180);
  const lastDock = useRef<Dock | null>(null);
  if (dock) lastDock.current = dock;
  const shown = dock ?? lastDock.current;

  if (!app || !settings || !runtime) return null;

  const aiNotReady = !isRuntimeReady(runtime.phase);
  const runningAi = running[0]?.locations.ai ?? latest?.locations.ai ?? "local";
  const pending = aiNotReady && runningAi === "local" ? "setting up" : undefined;

  const title = view === "home" || view === "workspace" ? (active?.name ?? "NONON") : view === "routines" ? "Routines" : view === "connections" ? "Connections" : "Settings";
  const showWorkspaceActions = view === "home" || view === "workspace";
  const docOpen = dock !== null && active !== null && showWorkspaceActions;
  const reviewing = docOpen && dock?.mode === "review";
  const resultsTaskId = dock?.mode === "results" ? dock.taskId : (lastResultsTask.current ?? tasks.find((t) => t.outputs.length > 0)?.id ?? null);

  return (
    <NonMoodContext.Provider value={mood}>
    <div className="app">
      <Sidebar
        view={view}
        onNav={(v) => {
          viewTransition(() => {
            setView(v);
            setDock(null);
          });
        }}
        workspaces={workspaces}
        activeId={active?.id ?? null}
        onSelectWorkspace={selectWorkspace}
        onAddWorkspace={() => setAdding(true)}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        companionName={settings.companionName}
        workingIds={workingIds}
      />

      <main className="main">
        <div className="main-col">
        <header className="topbar">
          <div className="topbar-inner col-fixed">
          <div className="topbar-title">
            <h1>{title}</h1>
            <LocationIndicator ai={runningAi} pending={pending} />
          </div>
          <div className="topbar-actions">
            {isMock() && (
              <span className="chip chip-attn" title="This is a browser preview with made-up data.">
                Demo data
              </span>
            )}
            {showWorkspaceActions && running.length > 0 && (
              <button
                type="button"
                className="btn btn-stop"
                onClick={() => void Promise.all(running.map((t) => api.call("task:stop", { id: t.id }).catch(() => undefined)))}
              >
                <Icon name="stop" size={18} tone="current" /> Stop
              </button>
            )}
            {showWorkspaceActions && active && (
              <button type="button" className={`btn btn-review ${reviewing ? "on" : ""}`} onClick={() => setDock(reviewing ? null : { mode: "review", taskId: null })} aria-pressed={reviewing}>
                <Icon name="review" size={20} />
                Changes to check
                {staged > 0 && <span className="count">{staged}</span>}
              </button>
            )}
          </div>
          </div>
        </header>

        {aiNotReady && (
          <div className="banner" role="status">
            <Icon name="alert" size={20} tone="current" />
            <span>
              <strong>The built-in AI is not ready yet.</strong>{" "}
              {isRuntimeBusy(runtime.phase) ? `${setupPhaseLabel(runtime.phase)}${runtime.progress != null ? ` ${Math.round(runtime.progress * 100)}%` : ""}. Your tasks will start when it is ready.` : "Your tasks will wait until the built-in AI is set up."}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => setShowSetup(true)}>
              {isRuntimeBusy(runtime.phase) ? "See progress" : "Finish setting up"}
            </button>
          </div>
        )}

        {active && !active.folder && (
          <div className="banner" role="status">
            <Icon name="alert" size={20} tone="current" />
            <span>
              <strong>This project has no folder yet.</strong> Choose the folder NONON may work in, so it knows where to look and where to save.
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                void (async () => {
                  const folder = await api.call("workspace:pick-folder", undefined).catch(() => null);
                  if (folder) await api.call("workspace:update", { id: active.id, patch: { folder } });
                })();
              }}
            >
              Choose a folder
            </button>
          </div>
        )}

        <div className="content">
          <div className="view view-enter" key={view === "workspace" ? `ws-${active?.id}` : view}>
            {view === "home" && (
              <HomeView
                workspace={active}
                onStart={(procedureId, files) => {
                  setStarter({ procedureId, files, nonce: Date.now() });
                  go("workspace");
                }}
                onOpenWorkspace={() => go("workspace")}
                onAddWorkspace={() => setAdding(true)}
                onViewResults={viewResults}
              />
            )}
            {view === "workspace" &&
              (active ? (
                <ConversationView key={active.id} workspace={active} starter={starter} onStarterDone={() => setStarter(null)} onReview={(taskId) => setDock({ mode: "review", taskId })} onViewResults={viewResults} />
              ) : (
                <HomeView workspace={null} onStart={() => undefined} onOpenWorkspace={() => undefined} onAddWorkspace={() => setAdding(true)} />
              ))}
            {view === "routines" && (active ? <RoutinesView workspaceId={active.id} /> : <p className="page muted">Add a project first.</p>)}
            {view === "connections" && <ConnectionsView workspaceId={active?.id ?? null} />}
            {view === "settings" && <SettingsView />}
          </div>

        </div>
        </div>
        {presence.mounted && shown && active && (
          <aside data-presence={presence.open ? "in" : "out"} className={`review-dock results-dock ${shown.mode === "results" && dockWide ? "wide" : ""}`} aria-label={shown.mode === "results" ? "Results" : "Changes to check"}>
            <SlideTabs className="dock-tabs" label="Side panel" deps={[shown.mode, presence.mounted]}>
              <button
                type="button"
                role="tab"
                aria-selected={shown.mode === "results"}
                className={`dock-tab ${shown.mode === "results" ? "on" : ""}`}
                disabled={!resultsTaskId}
                title={resultsTaskId ? undefined : "No results yet"}
                onClick={() => resultsTaskId && viewResults(resultsTaskId, shown.mode === "results" ? (shown.path ?? undefined) : undefined)}
              >
                Results
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={shown.mode === "review"}
                className={`dock-tab ${shown.mode === "review" ? "on" : ""}`}
                onClick={() => setDock({ mode: "review", taskId: shown.taskId })}
              >
                Changes to check{staged > 0 && <span className="count">{staged}</span>}
              </button>
            </SlideTabs>
            <div className="dock-body">
              <div className="swap" key={shown.mode}>
              {shown.mode === "results" ? (
                <ResultsPanel
                  key={shown.taskId}
                  taskId={shown.taskId}
                  path={shown.path}
                  onSelectPath={(path) => setDock({ mode: "results", taskId: shown.taskId, path })}
                  onClose={() => setDock(null)}
                  wide={dockWide}
                  onToggleWide={() => setDockWide((w) => !w)}
                />
              ) : (
                <ReviewPanel workspaceId={active.id} taskId={shown.taskId} onClose={() => setDock(null)} />
              )}
              </div>
            </div>
          </aside>
        )}
      </main>

      {showSetup && (
        <Modal title="Set up the built-in AI" onClose={() => setShowSetup(false)}>
          <SetupPanel />
        </Modal>
      )}
      {adding && (
        <AddWorkspaceDialog
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            setView("workspace");
          }}
        />
      )}
    </div>
    </NonMoodContext.Provider>
  );
}
