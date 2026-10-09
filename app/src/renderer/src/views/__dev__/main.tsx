import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../styles.css";
import { installMock } from "./mock";

installMock();

// Imported after the mock is installed because views read window.nonon when they mount.
const { ReviewPanel } = await import("../ReviewPanel");
const { RoutinesView } = await import("../RoutinesView");
const { ConnectionsView } = await import("../ConnectionsView");
const { SettingsView } = await import("../SettingsView");

type Tab = "review" | "review2" | "review-empty" | "routines" | "connections" | "connections-ws" | "settings";

function DevApp() {
  const initial = (location.hash.replace("#", "") || "review") as Tab;
  const [tab, setTab] = useState<Tab>(initial);
  useEffect(() => {
    const on = () => setTab((location.hash.replace("#", "") || "review") as Tab);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (t: Tab) => {
    location.hash = t;
    setTab(t);
  };
  return (
    <div className="flex h-full flex-col">
      <nav className="flex gap-2 border-b p-2 text-sm" style={{ borderColor: "var(--line)", background: "var(--sidebar)" }}>
        {(["review", "review2", "review-empty", "routines", "connections", "connections-ws", "settings"] as Tab[]).map((t) => (
          <button key={t} className={`btn ${tab === t ? "btn-primary" : ""}`} onClick={() => go(t)}>
            {t}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1">
        {tab === "review" && (
          <div className="mx-auto h-full max-w-[560px]">
            <ReviewPanel workspaceId="w1" taskId="t1" onClose={() => go("review-empty")} />
          </div>
        )}
        {tab === "review2" && (
          <div className="mx-auto h-full max-w-[560px]">
            <ReviewPanel workspaceId="w1" taskId="t2" onClose={() => go("review")} />
          </div>
        )}
        {tab === "review-empty" && (
          <div className="mx-auto h-full max-w-[560px]">
            <ReviewPanel workspaceId="w3" onClose={() => go("review")} />
          </div>
        )}
        {tab === "routines" && <RoutinesView workspaceId="w1" />}
        {tab === "connections" && <ConnectionsView workspaceId={null} />}
        {tab === "connections-ws" && <ConnectionsView workspaceId="w2" />}
        {tab === "settings" && <SettingsView />}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <DevApp />
  </StrictMode>,
);
