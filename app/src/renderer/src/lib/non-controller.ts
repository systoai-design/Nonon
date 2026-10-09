import type { NonState } from "./companion";

/** Port of the brand pack's motion/non-controller.js. The CSS in styles.css reads data-state, data-paused and data-reduced-motion. */
export const NON_STATES: readonly NonState[] = ["idle", "greeting", "listening", "thinking", "talking", "success"];

export interface NonController {
  setState(state: NonState): void;
  setReducedMotion(value: boolean): void;
  stop(): void;
  dispose(): void;
}

export function createNonController(svg: SVGElement, { reducedMotion = false }: { reducedMotion?: boolean } = {}): NonController {
  let disposed = false;
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const update = () => {
    if (disposed) return;
    svg.dataset.paused = String(document.hidden);
    svg.dataset.reducedMotion = String(reducedMotion || media.matches);
  };
  document.addEventListener("visibilitychange", update);
  media.addEventListener("change", update);
  update();
  return {
    setState(state) {
      if (disposed) return;
      if (!NON_STATES.includes(state)) throw new Error(`Unsupported Non state: ${String(state)}`);
      svg.dataset.state = state;
    },
    setReducedMotion(value) {
      reducedMotion = Boolean(value);
      update();
    },
    stop() {
      if (!disposed) svg.dataset.state = "idle";
    },
    dispose() {
      disposed = true;
      svg.dataset.paused = "true";
      document.removeEventListener("visibilitychange", update);
      media.removeEventListener("change", update);
    },
  };
}
