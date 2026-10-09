import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useRef } from "react";
import type { Workspace } from "../../../shared/contracts";
import { useNonMood } from "../lib/companion";
import { useSlidingIndicator } from "../lib/motion";
import { Icon, type IconName } from "./Icon";
import { Non } from "./Non";
import { PACK_ICONS } from "./ui";

export type View = "home" | "workspace" | "routines" | "connections" | "settings";

function NavButton({ icon, label, active, onClick, badge }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; badge?: React.ReactNode }) {
  return (
    <button type="button" className={`nav-item ${active ? "active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined} title={label}>
      <span className="nav-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="nav-label">{label}</span>
      {badge}
    </button>
  );
}

const navIcon = (name: IconName) => <Icon name={name} size={22} tone="current" />;

export function Sidebar({
  view,
  onNav,
  workspaces,
  activeId,
  onSelectWorkspace,
  onAddWorkspace,
  collapsed,
  onToggle,
  companionName,
  workingIds,
}: {
  view: View;
  onNav: (v: View) => void;
  workspaces: Workspace[];
  activeId: string | null;
  onSelectWorkspace: (id: string) => void;
  onAddWorkspace: () => void;
  collapsed: boolean;
  onToggle: () => void;
  companionName: string;
  workingIds: Set<string>;
}) {
  const mood = useNonMood();
  const navRef = useRef<HTMLElement>(null);
  useSlidingIndicator(navRef, [view, activeId, workspaces.length]);
  return (
    <nav ref={navRef} className={`sidebar ${collapsed ? "collapsed" : ""}`} aria-label="Main menu">
      <div className="side-companion">
        <Non state={mood.state} replayKey={mood.epoch} size={44} label={`${companionName}, your helper`} />
        <div className="side-id">
          <span className="side-name">{companionName}</span>
          <span className="side-status" role="status" title={mood.status}>
            {mood.status}
          </span>
        </div>
      </div>

      <div className="side-group">
        <NavButton icon={navIcon("home")} label="Home" active={view === "home"} onClick={() => onNav("home")} />
      </div>

      <p className="side-heading">Projects</p>
      <div className="side-group side-workspaces">
        {workspaces.map((w) => {
          const PackIcon = PACK_ICONS[w.pack];
          const active = view === "workspace" && w.id === activeId;
          return (
            <NavButton
              key={w.id}
              icon={<PackIcon size={22} />}
              label={w.name}
              active={active}
              onClick={() => onSelectWorkspace(w.id)}
              badge={workingIds.has(w.id) ? <span className="working-dot" title="Working on it" aria-label="Working on it" /> : undefined}
            />
          );
        })}
        <NavButton icon={navIcon("plus")} label="Add a project" onClick={onAddWorkspace} />
      </div>

      <div className="side-spacer" />
      <div className="side-group side-bottom">
        <NavButton icon={navIcon("routines")} label="Routines" active={view === "routines"} onClick={() => onNav("routines")} />
        <NavButton icon={navIcon("link")} label="Connections" active={view === "connections"} onClick={() => onNav("connections")} />
        <NavButton icon={navIcon("settings")} label="Settings" active={view === "settings"} onClick={() => onNav("settings")} />
        <NavButton icon={collapsed ? <PanelLeftOpen size={22} /> : <PanelLeftClose size={22} />} label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={onToggle} />
      </div>
    </nav>
  );
}
