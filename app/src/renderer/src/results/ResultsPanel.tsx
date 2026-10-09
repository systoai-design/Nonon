import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import type { OutputRef } from "../../../shared/contracts";
import { api, useTask } from "../lib/bridge";
import { baseName, stateLabel } from "../lib/format";
import { Markdown } from "../lib/markdown";
import { Icon } from "../components/Icon";
import { SlideTabs } from "../components/SlideTabs";
import { FileIcon, Spinner } from "../components/ui";
import { PreviewBody, Unavailable, sheetToTsv } from "./PreviewBody";
import { copyText, primaryOutput, usePreview } from "./usePreview";

export interface ResultsPanelProps {
  taskId: string;
  /** Which output tab to show; defaults to the main file. */
  path: string | null;
  onSelectPath: (path: string) => void;
  onClose: () => void;
  wide: boolean;
  onToggleWide: () => void;
}

/** The plain-language summary comes first. A long one folds to a few lines so the file below stays big enough to read. */
function Summary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = body.current;
    if (el && !open) setClipped(el.scrollHeight > el.clientHeight + 2);
  }, [text, open]);
  return (
    <div className={`results-summary ${open ? "open" : ""}`}>
      <div ref={body} className={`results-summary-body ${clipped && !open ? "clipped" : ""}`}>
        <Markdown text={text} />
      </div>
      {(clipped || open) && (
        <button type="button" className="btn-link results-summary-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function ResultsPanel({ taskId, path, onSelectPath, onClose, wide, onToggleWide }: ResultsPanelProps) {
  const task = useTask(taskId);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const outputs = task?.outputs ?? [];
  const active: OutputRef | undefined = outputs.find((o) => o.path === path) ?? primaryOutput(outputs);
  const preview = usePreview(active?.path ?? null, task?.updatedAt ?? "");
  const copyTimer = useRef<number>(0);

  useEffect(() => {
    setSheetIndex(0);
    setCopied(false);
  }, [active?.path]);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  if (!task) {
    return (
      <div className="results results-empty" role="status">
        <Spinner size={18} /> <span className="muted">Loading...</span>
      </div>
    );
  }

  const open = () => active && void api.call("shell:open", { path: active.path }).catch(() => undefined);
  const reveal = () => active && void api.call("shell:reveal", { path: active.path }).catch(() => undefined);

  const readyPreview = preview.status === "ready" ? preview.preview : null;
  const copyable = readyPreview && readyPreview.kind !== "unsupported";
  async function copy() {
    if (!readyPreview || readyPreview.kind === "unsupported") return;
    const text = readyPreview.kind === "table" ? sheetToTsv((readyPreview.sheets[sheetIndex] ?? readyPreview.sheets[0])!) : readyPreview.text;
    if (await copyText(text)) {
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1800);
    }
  }

  const tableSheets = readyPreview?.kind === "table" ? readyPreview.sheets : [];

  return (
    <section
      className="results"
      aria-label="Results"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement)) onClose();
      }}
    >
      <header className="results-head">
        <div className="results-title">
          <h2 title={task.title}>{task.title}</h2>
          <span className={`chip ${task.state === "complete" || task.state === "review" ? "chip-ok" : ""}`}>{stateLabel(task.state)}</span>
        </div>
        <button
          type="button"
          className="icon-btn icon-btn-sm results-wide"
          onClick={onToggleWide}
          aria-label={wide ? "Make this panel narrower" : "Make this panel wider"}
          title={wide ? "Narrower" : "Wider"}
        >
          {wide ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
        </button>
        <button type="button" className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Close">
          <Icon name="close" size={18} tone="current" />
        </button>
      </header>

      {task.summary && <Summary text={task.summary} />}

      {outputs.length === 0 ? (
        <div className="results-body">
          <Unavailable reason={task.state === "failed" || task.state === "needs-attention" ? "This task did not make any files." : "No files yet. They appear here as soon as the task finishes."} />
        </div>
      ) : (
        <>
          {outputs.length > 1 && (
            <div className="results-tabs" role="tablist" aria-label="Files NONON made">
              {outputs.map((o) => {
               const on = o.path === active?.path;
                return (
                  <button key={o.path} type="button" role="tab" aria-selected={on} className={`results-tab ${on ? "on" : ""}`} onClick={() => onSelectPath(o.path)} title={baseName(o.path)}>
                    <FileIcon name={baseName(o.path)} size={18} />
                    <span>{o.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {active && (
            <div className="results-file">
              <span className="results-filename" title={active.path}>
                {baseName(active.path)}
              </span>
              <div className="results-actions">
                {copyable && (
                  <button type="button" className="btn btn-sm" onClick={() => void copy()}>
                    {copied ? <Icon name="check" size={16} tone="current" /> : <Copy size={15} aria-hidden="true" />}
                    {copied ? "Copied" : readyPreview?.kind === "table" ? "Copy sheet" : "Copy text"}
                  </button>
                )}
                <button type="button" className="btn btn-sm" onClick={reveal}>
                  <Icon name="folder" size={16} /> Show in folder
                </button>
                <button type="button" className="btn btn-sm btn-primary" onClick={open}>
                  <ExternalLink size={15} aria-hidden="true" /> Open the file
                </button>
              </div>
            </div>
          )}

          {tableSheets.length > 1 && (
            <SlideTabs className="sheet-tabs" label="Sheets" deps={[sheetIndex, tableSheets.length, active?.path]}>
              {tableSheets.map((s, i) => (
                <button key={s.name} type="button" role="tab" aria-selected={i === sheetIndex} className={`sheet-tab ${i === sheetIndex ? "on" : ""}`} onClick={() => setSheetIndex(i)}>
                  {s.name}
                  <span className="sheet-count">{s.totalRows.toLocaleString("en-US")}</span>
                </button>
              ))}
            </SlideTabs>
          )}

          <div className="results-body" role="tabpanel" key={`${active?.path}|${sheetIndex}`}>
            {preview.status === "loading" && (
              <div className="preview-empty" role="status">
                <Spinner size={20} />
                <p className="muted">Opening it here...</p>
              </div>
            )}
            {preview.status === "error" && (
              <div className="preview-empty" role="alert">
                <p>{preview.message}</p>
                <div className="results-actions">
                  <button type="button" className="btn btn-sm" onClick={preview.reload}>
                    Try again
                  </button>
                  <button type="button" className="btn btn-sm btn-primary" onClick={open}>
                    Open the file
                  </button>
                </div>
              </div>
            )}
            {readyPreview && <PreviewBody preview={readyPreview} sheetIndex={sheetIndex} onOpen={open} />}
          </div>
        </>
      )}
    </section>
  );
}
