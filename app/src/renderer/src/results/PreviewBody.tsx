import { useMemo } from "react";

import type { OutputPreview, PreviewSheet } from "../../../shared/contracts";
import { Markdown } from "../lib/markdown";
import { Icon } from "../components/Icon";

const NUMERIC = /^[-+(]?\s*[$€£]?\s*\d[\d,]*(\.\d+)?\s*%?\)?$/;
const isNumeric = (s: string) => NUMERIC.test(s.trim());
const filled = (r: string[]) => r.filter((c) => c.trim() !== "").length;

export interface SheetView {
  header: string[] | null;
  body: string[][];
  numericCols: boolean[];
}

/**
 * Sheets that are really a page of notes (a title, then label and value pairs) have no header row.
 * In `focus` mode such a sheet jumps to its first real table, which is what a short preview should show.
 */
export function sheetView(sheet: PreviewSheet, focus: boolean): SheetView {
  const rows = sheet.rows;
  const width = rows.reduce((n, r) => Math.max(n, filled(r)), 0);
  const first = rows[0] ?? [];
  const headerLike = rows.length > 0 && filled(first) >= Math.min(2, width) && filled(first) >= width * 0.6;
  let start = 0;
  let header: string[] | null = headerLike ? first : null;
  if (headerLike) start = 1;
  else if (focus && width >= 3) {
    const at = rows.findIndex((r, i) => filled(r) >= 3 && filled(rows[i + 1] ?? []) >= 3);
    if (at >= 0) {
      header = rows[at] ?? null;
      start = at + 1;
    }
  }
  const body = rows.slice(start);
  const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const numericCols = Array.from({ length: cols }, (_, c) => {
    const cells = body.map((r) => (r[c] ?? "").trim()).filter(Boolean);
    return cells.length > 0 && cells.filter(isNumeric).length >= cells.length * 0.6;
  });
  return { header, body, numericCols };
}

/** Text longer than this wraps inside its cell instead of being cut with an ellipsis. */
const WRAP_AT = 36;

/** The comparison workbook's two pages of notes. Their rows are sentences, headings and label and value pairs, not a data table. */
const NOTES_SHEETS = new Set(["Summary", "About this comparison"]);
export const isNotesSheet = (name: string) => NOTES_SHEETS.has(name);

type NoteKind = "blank" | "title" | "heading" | "item" | "prose" | "head" | "pair";

/** A row with a single short cell, no full stop and a blank row above it is a heading (the writer always leaves one); a numbered line is a list item; any other single cell is a sentence. */
export function noteKind(rows: string[][], i: number): NoteKind {
  const r = rows[i] ?? [];
  const n = filled(r);
  if (n === 0) return "blank";
  if (n === 1) {
    const text = (r.find((c) => c.trim() !== "") ?? "").trim();
    if (i === 0) return "title";
    if (/^\d+\.\s/.test(text)) return "item";
    if (text.length <= 40 && !/[.!?]$/.test(text) && !r[0]?.startsWith(" ") && filled(rows[i - 1] ?? []) === 0) return "heading";
    return "prose";
  }
  const prev = i > 0 ? noteKind(rows, i - 1) : "blank";
  if (prev === "heading" && n >= 3 && r.every((c) => c.trim() === "" || !isNumeric(c))) return "head";
  return "pair";
}

/** Notes pages: sentences span the width and wrap, headings get a gap above, label and value pairs sit in two columns. */
export function NotesTable({ sheet, maxBodyRows }: { sheet: PreviewSheet; maxBodyRows?: number }) {
  const rows = maxBodyRows ? sheet.rows.slice(0, maxBodyRows) : sheet.rows;
  const cols = sheet.rows.reduce((n, r) => Math.max(n, r.length), 1);
  return (
    <table className="notes">
      <tbody>
        {rows.map((r, ri) => {
          const kind = noteKind(sheet.rows, ri);
          if (kind === "blank") return <tr key={ri} className="n-blank" aria-hidden="true"><td colSpan={cols} /></tr>;
          if (kind === "pair" || kind === "head") {
            return (
              <tr key={ri} className={`n-${kind}`}>
                {Array.from({ length: cols }, (_, c) => {
                  const v = r[c] ?? "";
                  return (
                    <td key={c} className={c === 0 ? "label" : isNumeric(v) ? "num" : "value"}>
                      {v}
                    </td>
                  );
                })}
              </tr>
            );
          }
          const text = (r.find((c) => c.trim() !== "") ?? "").trim();
          const indented = (r[0] ?? "").startsWith(" ");
          return (
            <tr key={ri} className={`n-${kind}${indented ? " n-indent" : ""}`}>
              <td colSpan={cols}>{kind === "heading" || kind === "title" ? <span>{text}</span> : <div className="prose">{text}</div>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function SheetTable({ sheet, compact = false, maxBodyRows }: { sheet: PreviewSheet; compact?: boolean; maxBodyRows?: number }) {
  const view = useMemo(() => sheetView(sheet, compact), [sheet, compact]);
  const body = maxBodyRows ? view.body.slice(0, maxBodyRows) : view.body;
  if (sheet.rows.length === 0) return <p className="preview-note">This sheet is empty.</p>;
  if (isNotesSheet(sheet.name)) return <NotesTable sheet={sheet} maxBodyRows={maxBodyRows} />;
  return (
    <table className={`sheet ${compact ? "sheet-compact" : ""}`}>
      {view.header && (
        <thead>
          <tr>
            {view.header.map((h, c) => (
              <th key={c} className={view.numericCols[c] ? "num" : ""} title={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {body.map((r, ri) => (
          <tr key={ri} className={filled(r) === 0 ? "blank" : ""}>
            {(view.header ?? sheet.rows[0] ?? []).map((_, c) => {
              const v = r[c] ?? "";
              return (
                <td key={c} className={view.numericCols[c] && isNumeric(v) ? "num" : v.length > WRAP_AT && !isNumeric(v) ? "wrap" : ""} title={v.length > 24 && v.length <= WRAP_AT ? v : undefined}>
                  {v}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function sheetNote(sheet: PreviewSheet): string | null {
  if (sheet.rows.length > 0 && sheet.totalRows === 0 && sheet.rows.length === 1) return "No rows in this sheet.";
  const bits: string[] = [];
  const shown = Math.max(0, sheet.rows.length - 1);
  if (sheet.totalRows > shown) bits.push(`Showing the first ${shown.toLocaleString("en-US")} of ${sheet.totalRows.toLocaleString("en-US")} rows`);
  if (sheet.totalCols > (sheet.rows[0]?.length ?? 0)) bits.push(`the first ${sheet.rows[0]?.length ?? 0} of ${sheet.totalCols} columns`);
  return bits.length ? `${bits.join(" and ")}. Open the file to see everything.` : null;
}

export function sheetToTsv(sheet: PreviewSheet): string {
  return sheet.rows.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}

export function Unavailable({ reason, onOpen }: { reason: string; onOpen?: () => void }) {
  return (
    <div className="preview-empty" role="status">
      <Icon name="alert" size={26} tone="accent" />
      <p>{reason}</p>
      {onOpen && (
        <button type="button" className="btn btn-primary" onClick={onOpen}>
          Open the file
        </button>
      )}
    </div>
  );
}

/** Full-size body for the Results viewer. */
export function PreviewBody({ preview, sheetIndex, onOpen }: { preview: OutputPreview; sheetIndex: number; onOpen: () => void }) {
  if (preview.kind === "unsupported") return <Unavailable reason={preview.reason} onOpen={onOpen} />;
  if (preview.kind === "table") {
    const sheet = preview.sheets[sheetIndex] ?? preview.sheets[0];
    if (!sheet) return <Unavailable reason="There is nothing to show in this file." onOpen={onOpen} />;
    const note = sheetNote(sheet);
    return (
      <>
        <div className="sheet-scroll" tabIndex={0} aria-label={`Sheet ${sheet.name}`}>
          <SheetTable sheet={sheet} />
        </div>
        {note && <p className="preview-note">{note}</p>}
      </>
    );
  }
  return (
    <div className="doc-scroll" tabIndex={0}>
      {preview.kind === "markdown" ? <Markdown className="doc-md" text={preview.text} /> : <pre className="text-view">{preview.text}</pre>}
      {preview.truncated && <p className="preview-note">This file is large, so only the first part is shown here. Open the file to see all of it.</p>}
    </div>
  );
}
