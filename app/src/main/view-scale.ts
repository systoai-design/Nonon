import type { BrowserWindow } from "electron";

/**
 * How big NONON draws everything. Chromium remembers zoom between runs and the default View menu let anyone zoom by accident,
 * which is why the app could open "zoomed". NONON now owns this: a fixed set of sizes, set on every load, changed only by
 * the Screen size setting or Ctrl and + / - / 0. The default is a little under 1 because the interface font (Nunito) reads larger
 * than Pragma's 13px text at the same pixel size.
 */
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25] as const;
export const DEFAULT_UI_SCALE = 0.9;

export function nearestScale(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_UI_SCALE;
  return UI_SCALES.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), UI_SCALES[0] as number);
}

export function applyUiScale(win: BrowserWindow | null, value: unknown): void {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.setZoomFactor(nearestScale(value));
  } catch {
    /* the window can close between the check and the call */
  }
}

/** Keeps the scale fixed for the life of a window and routes the zoom keys through the same fixed steps. */
export function attachViewScale(win: BrowserWindow, get: () => unknown, set: (scale: number) => void): void {
  const wc = win.webContents;
  const reapply = (): void => applyUiScale(win, get());
  wc.on("dom-ready", reapply);
  wc.on("did-finish-load", reapply);
  void wc.setVisualZoomLevelLimits(1, 1).catch(() => undefined);

  const step = (direction: -1 | 0 | 1): void => {
    const current = nearestScale(get());
    const i = UI_SCALES.indexOf(current as (typeof UI_SCALES)[number]);
    const next = direction === 0 ? DEFAULT_UI_SCALE : (UI_SCALES[Math.min(UI_SCALES.length - 1, Math.max(0, i + direction))] as number);
    set(next);
    applyUiScale(win, next);
  };

  // Ctrl + wheel and pinch would otherwise change Chromium's own zoom behind our back.
  wc.on("zoom-changed", (_event, direction) => step(direction === "in" ? 1 : -1));
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return;
    if (input.key === "=" || input.key === "+") {
      event.preventDefault();
      step(1);
    } else if (input.key === "-" || input.key === "_") {
      event.preventDefault();
      step(-1);
    } else if (input.key === "0") {
      event.preventDefault();
      step(0);
    }
  });
}
