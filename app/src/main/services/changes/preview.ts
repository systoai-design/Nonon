import { z } from "zod";
import type { ChangePreview } from "../../../shared/contracts";

const table = z.array(z.array(z.string()));

const previewSchema = z.object({
  title: z.string().min(1),
  before: z.union([z.string(), table]).optional(),
  after: z.union([z.string(), table]).optional(),
  highlights: z.array(z.object({ row: z.number().int().min(0), col: z.number().int().min(0) })).optional(),
});

/** Procedures hand over previews as untyped JSON-ish data; the review panel must never receive a malformed one. */
export function checkPreview(value: unknown): { ok: true; preview: ChangePreview } | { ok: false; error: string } {
  const parsed = previewSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: "The preview that came with this change could not be shown." };
  }
  const p = parsed.data;
  const grid = Array.isArray(p.after) ? p.after : undefined;
  if (grid && p.highlights) {
    for (const h of p.highlights) {
      const row = grid[h.row];
      if (!row || h.col >= Math.max(row.length, ...grid.map((r) => r.length))) {
        return { ok: false, error: "Some highlighted cells in the preview are outside its table." };
      }
    }
  }
  const preview: ChangePreview = { title: p.title };
  if (p.before !== undefined) preview.before = p.before;
  if (p.after !== undefined) preview.after = p.after;
  if (p.highlights !== undefined) preview.highlights = p.highlights;
  return { ok: true, preview };
}

const MAX_ROWS = 8;
const MAX_COLS = 6;
const MAX_TEXT = 40;

const clip = (s: string): string => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}...` : s);

export interface GridPreviewInput {
  title: string;
  /** 0-based accessors; return "" for empty cells. */
  getBefore(row: number, col: number): string;
  getAfter(row: number, col: number): string;
  edited: { row: number; col: number }[];
  /** Row count after the edit, used for the context row. */
  rowCount: number;
}

/** Small before/after tables: the header row plus the edited rows, and the key column plus the edited columns. */
export function gridPreview(input: GridPreviewInput): ChangePreview {
  const rowSet = [...new Set(input.edited.map((e) => e.row))].sort((a, b) => a - b);
  const dataRows = rowSet.filter((r) => r !== 0);
  const shownData = dataRows.slice(0, MAX_ROWS - 1);
  const last = shownData[shownData.length - 1];
  if (shownData.length < 3 && last !== undefined && last + 1 < input.rowCount) shownData.push(last + 1);
  if (shownData.length === 0 && input.rowCount > 1) shownData.push(1);
  const rows = [0, ...shownData];

  const colSet = [...new Set(input.edited.map((e) => e.col))].sort((a, b) => a - b);
  const cols = colSet.slice(0, MAX_COLS);
  if (!cols.includes(0)) {
    if (cols.length >= MAX_COLS) cols.pop();
    cols.unshift(0);
  }

  const build = (get: (r: number, c: number) => string): string[][] => rows.map((r) => cols.map((c) => clip(get(r, c))));
  const highlights: { row: number; col: number }[] = [];
  for (const e of input.edited) {
    const ri = rows.indexOf(e.row);
    const ci = cols.indexOf(e.col);
    if (ri >= 0 && ci >= 0) highlights.push({ row: ri, col: ci });
  }
  const hidden = input.edited.length - highlights.length;
  return {
    title: hidden > 0 ? `${input.title} (showing ${highlights.length} of ${input.edited.length} changed cells)` : input.title,
    before: build(input.getBefore),
    after: build(input.getAfter),
    highlights,
  };
}
