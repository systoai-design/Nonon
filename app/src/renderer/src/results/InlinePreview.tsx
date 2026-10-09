import { Maximize2 } from "lucide-react";
import type { OutputRef } from "../../../shared/contracts";
import { baseName } from "../lib/format";
import { Markdown } from "../lib/markdown";
import { FileIcon, Spinner } from "../components/ui";
import { SheetTable, Unavailable } from "./PreviewBody";
import { usePreview } from "./usePreview";

const PREVIEW_ROWS = 12;
const PREVIEW_LINES = 18;

/** Compact look at the main file, shown inside the task card. The fade says "there is more"; Expand opens the full viewer. */
export function InlinePreview({ output, version, onExpand, onOpen }: { output: OutputRef; version: string; onExpand: () => void; onOpen: () => void }) {
  const state = usePreview(output.path, version);
  const name = baseName(output.path);

  let body;
  let more = false;
  let meta = "";
  if (state.status === "loading") {
    body = (
      <div className="inline-loading" role="status">
        <Spinner size={16} /> <span className="muted">Getting a look at it...</span>
      </div>
    );
  } else if (state.status === "error") {
    body = <Unavailable reason={state.message} onOpen={onOpen} />;
  } else {
    const p = state.preview;
    if (p.kind === "unsupported") body = <Unavailable reason={p.reason} onOpen={onOpen} />;
    else if (p.kind === "table") {
      const sheet = p.sheets[0];
      meta = p.sheets.length > 1 ? `${p.sheets.length} sheets` : sheet ? `${sheet.totalRows.toLocaleString("en-US")} rows` : "";
      if (sheet) {
        more = sheet.rows.length > PREVIEW_ROWS + 1 || sheet.totalRows > PREVIEW_ROWS || p.sheets.length > 1;
        body = (
          <div className="inline-table" aria-label={`Preview of ${sheet.name}`}>
            {p.sheets.length > 1 && <div className="inline-sheetname">{sheet.name}</div>}
            <SheetTable sheet={sheet} compact maxBodyRows={PREVIEW_ROWS} />
          </div>
        );
      }
    } else {
      const lines = p.text.split("\n");
      more = lines.length > PREVIEW_LINES || p.truncated;
      body = (
        <div className="inline-doc" aria-label={`Preview of ${name}`}>
          {p.kind === "markdown" ? <Markdown className="doc-md" text={lines.slice(0, 60).join("\n")} /> : <pre className="text-view">{lines.slice(0, PREVIEW_LINES).join("\n")}</pre>}
        </div>
      );
    }
  }

  return (
    <div className="inline-preview">
      <div className="inline-head">
        <FileIcon name={name} size={18} />
        <span className="inline-name" title={output.path}>
          {output.label}
        </span>
        {meta && <span className="muted small">{meta}</span>}
        <button type="button" className="btn-link inline-expand" onClick={onExpand} aria-label={`Expand ${output.label}`}>
          <Maximize2 size={14} aria-hidden="true" /> Expand
        </button>
      </div>
      <div className={`inline-body ${more ? "has-more" : ""}`}>{body}</div>
    </div>
  );
}
