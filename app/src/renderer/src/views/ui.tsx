import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Loader2 } from "lucide-react";
import { Icon, type IconName } from "../components/Icon";

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  busy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: checked ? "var(--ink)" : "var(--control-line)", borderColor: "transparent" }}
    >
      <span
        className="inline-block h-[18px] w-[18px] rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(22px)" : "translateX(3px)" }}
      />
    </button>
  );
}

export type Tone = "info" | "good" | "warn" | "bad";

const toneStyle: Record<Tone, { bg: string; fg: string; glyph: IconName }> = {
  info: { bg: "var(--panel)", fg: "var(--muted)", glyph: "info" },
  good: { bg: "var(--panel)", fg: "var(--ink)", glyph: "check" },
  warn: { bg: "var(--attn-soft)", fg: "var(--attn-ink)", glyph: "alert" },
  bad: { bg: "var(--red-soft)", fg: "var(--red-ink)", glyph: "close" },
};

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const { bg, fg, glyph } = toneStyle[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className="flex gap-3 rounded-xl px-4 py-3 text-[14px]" style={{ background: bg }}>
      <span className="mt-0.5 shrink-0" style={{ color: fg }}>
        <Icon name={glyph} size={20} tone="current" />
      </span>
      <div className="min-w-0">
        {title && (
          <div className="font-semibold" style={{ color: tone === "info" ? "var(--ink)" : fg }}>
            {title}
          </div>
        )}
        {children && <div style={{ color: "var(--ink)" }}>{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" aria-hidden />;
}

export function Loading({ children = "Loading..." }: { children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-6 muted" role="status">
      <Spinner /> {children}
    </div>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="m-0 text-[13.5px]" style={{ color: "var(--red)" }}>
      {children}
    </p>
  );
}

export function CopyButton({ text, label = "Copy", className = "btn" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2000);
  };
  return (
    <button type="button" className={className} onClick={copy}>
      {state === "done" ? <Icon name="check" size={16} tone="current" /> : <Copy size={15} aria-hidden />}
      {state === "done" ? "Copied" : state === "failed" ? "Could not copy" : label}
    </button>
  );
}

/** The page title lives in the top bar of the window (one h1 per screen); this holds the line under it and any page action. */
export function PageHeader({ subtitle, right }: { subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">{subtitle && <p className="m-0 muted">{subtitle}</p>}</div>
      {right}
    </header>
  );
}

/** Two-step guard for destructive buttons: first click asks, second confirms. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = "btn btn-danger",
  disabled,
}: {
  label: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2" role="group" aria-label="Confirm">
      <button
        type="button"
        autoFocus
        className="btn"
        style={{ background: "var(--red)", borderColor: "var(--red)", color: "#fff" }}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
