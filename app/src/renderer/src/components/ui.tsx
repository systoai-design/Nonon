import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Briefcase, Calculator, LoaderCircle, Sparkles } from "lucide-react";
import type { AiLocation, Check, OutputRef, PackId } from "../../../shared/contracts";
import { baseName, extOf, aiHint, aiLabel, isCloud } from "../lib/format";
import { dismissToast, useToasts } from "../lib/bridge";
import { motionOff } from "../lib/motion";
import { Icon } from "./Icon";

const SchoolIcon = ({ size }: { size?: number }) => <Icon name="school" size={size} tone="current" />;

/** The brand set has no briefcase, calculator or sparkle, so those three stay lucide; study uses the brand school glyph. */
export const PACK_ICONS: Record<PackId, ComponentType<{ size?: number }>> = {
  general: Sparkles,
  business: Briefcase,
  bookkeeping: Calculator,
  education: SchoolIcon,
};

/** Brand icons have no spinner, so the progress spinner stays lucide. */
export function Spinner({ size = 16 }: { size?: number }) {
  return <LoaderCircle size={size} className="spin" aria-hidden="true" />;
}

/** Spreadsheet glyph for .xlsx, .xls and .csv, the generic file glyph for everything else. */
export function FileIcon({ name, size = 20 }: { name: string; size?: number }) {
  const e = extOf(name);
  return <Icon name={e === ".xlsx" || e === ".xls" || e === ".csv" ? "spreadsheet" : "file"} size={size} />;
}

/** Compact attachment chip. Names truncate; the full path is in the tooltip. */
export function AttachmentChip({ path, name, onRemove }: { path: string; name?: string; onRemove?: () => void }) {
  const n = name ?? baseName(path);
  return (
    <span className="file-chip" title={path}>
      <FileIcon name={n} size={20} />
      <span className="file-chip-name">{n}</span>
      {onRemove && (
        <button type="button" className="icon-btn icon-btn-sm" onClick={onRemove} aria-label={`Remove ${n}`}>
          <Icon name="close" size={14} tone="current" />
        </button>
      )}
    </span>
  );
}

/** Output file chip: click opens the file, the small button shows it in its folder. */
export function OutputChip({ output, onOpen, onReveal }: { output: OutputRef; onOpen: () => void; onReveal: () => void }) {
  const name = baseName(output.path);
  return (
    <span className="file-chip file-chip-output" title={output.path}>
      <button type="button" className="file-chip-main" onClick={onOpen} aria-label={`Open ${name}`}>
        <span className="icon-tile">
          <FileIcon name={name} size={22} />
        </span>
        <span className="file-chip-text">
          <span className="file-chip-label">{output.label}</span>
          <span className="file-chip-name muted">{name}</span>
        </span>
      </button>
      <button type="button" className="btn-link" onClick={onReveal} aria-label={`Show ${name} in its folder`}>
        Show in folder
      </button>
    </span>
  );
}

export function CheckList({ checks }: { checks: Check[] }) {
  if (checks.length === 0) return null;
  return (
    <ul className="checks" aria-label="What was checked">
      {checks.map((c) => (
        <li key={c.id} className={`check check-${c.status}`}>
          {c.status === "pass" ? <Icon name="check" size={16} tone="current" title="Good" /> : c.status === "warn" ? <Icon name="alert" size={16} tone="current" title="Worth a look" /> : <Icon name="close" size={16} tone="current" title="Problem" />}
          <span>
            {c.label}
            {c.detail && <span className="muted"> ({c.detail})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The two separate answers to "where does my work happen": the AI, and the files. */
export function LocationIndicator({ ai, files = "This computer", pending }: { ai: AiLocation; files?: string; pending?: string }) {
  const cloud = isCloud(ai);
  return (
    <div className="where" role="group" aria-label="Where your work happens">
      <span className="where-item" title={pending ? "The built-in AI is still being set up. Your task will start when it is ready." : aiHint(ai)}>
        <Icon name="device" size={22} />
        <span>
          AI: {aiLabel(ai)}
          {pending ? ` (${pending})` : ""}
        </span>
        {(cloud || pending) && <span className={`dot ${cloud ? "dot-attn" : "dot-grey"}`} aria-hidden="true" />}
      </span>
      <span className="where-sep" aria-hidden="true" />
      <span className="where-item" title="Your files stay in the folder you chose.">
        <Icon name="file" size={22} />
        <span>Files: {files}</span>
      </span>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  // Closing from the dialog itself (Escape, the backdrop, the X) plays a short exit; buttons inside call onClose directly.
  const close = useCallback(() => {
    if (motionOff()) return onClose();
    setClosing(true);
    window.setTimeout(onClose, 90);
  }, [onClose]);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, button, select, textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [close]);
  return (
    <div className="modal-back" data-closing={closing || undefined} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={ref} className={`modal card ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="close" size={18} tone="current" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useToasts();
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  const dismiss = (id: number) => {
    if (motionOff()) return dismissToast(id);
    setLeaving((cur) => new Set(cur).add(id));
    window.setTimeout(() => dismissToast(id), 90);
  };
  return (
    <div className="toasts" role="region" aria-label="Messages">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} data-leaving={leaving.has(t.id) || undefined} role={t.kind === "error" ? "alert" : "status"}>
          <span>{t.message}</span>
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <Icon name="close" size={14} tone="current" />
          </button>
        </div>
      ))}
    </div>
  );
}
