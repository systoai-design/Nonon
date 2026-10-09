import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { ChangePreview } from "../../../../shared/contracts";
import { isNumeric } from "./describe";

const MAX_ROWS = 14;
const MAX_COLS = 12;

function Grid({
  rows,
  highlightRows,
  highlightCells,
  caption,
}: {
  rows: string[][];
  highlightRows: Set<number>;
  highlightCells: Set<string>;
  caption: string;
}) {
  const shown = rows.slice(0, MAX_ROWS);
  const cols = Math.min(MAX_COLS, Math.max(0, ...shown.map((r) => r.length)));
  return (
    <div>
      <div className="overflow-auto rounded-lg border" style={{ borderColor: "var(--line)", maxHeight: 280 }} tabIndex={0} role="region" aria-label={caption}>
        <table className="grid dense" style={{ display: "table" }}>
          <caption className="sr-only">{caption}</caption>
          <tbody>
            {shown.map((row, r) => (
              <tr key={r} className={highlightRows.has(r) ? "hl" : undefined}>
                {Array.from({ length: cols }, (_, c) => {
                  const v = row[c] ?? "";
                  const cell = highlightCells.has(`${r}:${c}`);
                  return (
                    <td
                      key={c}
                      className={isNumeric(v) ? "num" : undefined}
                      style={cell ? { background: "var(--accent-soft)", fontWeight: 700, boxShadow: "inset 0 0 0 1.5px var(--accent)" } : undefined}
                    >
                      {v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(rows.length > shown.length || rows.some((r) => r.length > cols)) && (
        <p className="m-0 mt-1 text-[12.5px] muted">
          Showing the first {shown.length} rows{rows.some((r) => r.length > cols) ? ` and ${cols} columns` : ""} of the preview.
        </p>
      )}
    </div>
  );
}

function CellCompare({ before, after }: { before: string; after: string }) {
  return (
    <div className="flex items-stretch gap-2" role="group" aria-label={`Before: ${before || "empty"}. After: ${after || "empty"}.`}>
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border" style={{ borderColor: "var(--line)" }}>
        <div className="px-3 py-1.5 text-[13px] font-semibold" style={{ background: "var(--panel)" }}>
          Before
        </div>
        <div className="mono truncate px-3 py-2 text-[13.5px]">{before || <span className="muted">(empty)</span>}</div>
      </div>
      <ArrowRight size={18} className="mt-5 shrink-0 muted" aria-hidden />
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border" style={{ borderColor: "var(--accent)" }}>
        <div className="px-3 py-1.5 text-[13px] font-semibold" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
          After
        </div>
        <div className="mono truncate px-3 py-2 text-[13.5px] font-semibold">{after || <span className="muted">(empty)</span>}</div>
      </div>
    </div>
  );
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-[13px] font-semibold muted">{label}</div>
      <pre
        className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-xl border px-3 py-2 text-[13.5px]"
        style={{ borderColor: "var(--line)", background: "var(--card)", fontFamily: "var(--font)" }}
        tabIndex={0}
      >
        {text}
      </pre>
    </div>
  );
}

export function PreviewView({ preview }: { preview: ChangePreview }) {
  const { before, after, highlights } = preview;
  const tableAfter = Array.isArray(after) ? after : null;
  const tableBefore = Array.isArray(before) ? before : null;
  const [side, setSide] = useState<"after" | "before">("after");

  const rowSet = useMemo(() => new Set((highlights ?? []).map((h) => h.row)), [highlights]);
  const cellSet = useMemo(() => new Set((highlights ?? []).map((h) => `${h.row}:${h.col}`)), [highlights]);

  const compares = useMemo(() => {
    if (!tableAfter || !tableBefore) return [];
    const out: { key: string; before: string; after: string }[] = [];
    for (const h of highlights ?? []) {
      const b = tableBefore[h.row]?.[h.col] ?? "";
      const a = tableAfter[h.row]?.[h.col] ?? "";
      if (a !== b) out.push({ key: `${h.row}:${h.col}`, before: b, after: a });
      if (out.length >= 4) break;
    }
    return out;
  }, [tableAfter, tableBefore, highlights]);

  if (tableAfter || tableBefore) {
    const showing = side === "after" && tableAfter ? tableAfter : (tableBefore ?? tableAfter ?? []);
    const label = side === "after" && tableAfter ? "How it will look" : "How it looks now";
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13.5px] muted">{label}</div>
          {tableAfter && tableBefore && (
            <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--line)" }} role="group" aria-label="Which version to look at">
              {(["after", "before"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={side === s}
                  onClick={() => setSide(s)}
                  className="rounded-md px-3 py-1 text-[13px]"
                  style={side === s ? { background: "var(--accent-soft)", color: "var(--accent-ink)", fontWeight: 600 } : { color: "var(--muted)" }}
                >
                  {s === "after" ? "After" : "Before"}
                </button>
              ))}
            </div>
          )}
        </div>
        <Grid rows={showing} highlightRows={rowSet} highlightCells={cellSet} caption={label} />
        {compares.map((c) => (
          <CellCompare key={c.key} before={c.before} after={c.after} />
        ))}
      </div>
    );
  }

  if (typeof after === "string" || typeof before === "string") {
    return (
      <div className="flex flex-col gap-3">
        {typeof before === "string" && typeof after === "string" && <TextBlock label="Before" text={before} />}
        {typeof after === "string" && <TextBlock label={typeof before === "string" ? "After" : "New text"} text={after} />}
        {typeof after !== "string" && typeof before === "string" && <TextBlock label="Before" text={before} />}
      </div>
    );
  }

  return <p className="m-0 text-[13.5px] muted">There is no preview for this change.</p>;
}
