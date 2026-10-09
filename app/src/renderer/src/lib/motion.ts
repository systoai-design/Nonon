import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

/** True when motion must be skipped: the app setting, the system preference, or a hidden window. */
export function motionOff(): boolean {
  return document.hidden || document.documentElement.classList.contains("reduced-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type WithVT = Document & { startViewTransition?: (update: () => void) => unknown };

/**
 * Runs a state update inside a View Transition when the browser has them, so the named `.view` crossfades and settles.
 * Falls back to a plain update (the keyed `.view-enter` mount animation then does the settle). Never animates when motion is off.
 */
export function viewTransition(update: () => void): void {
  const doc = document as WithVT;
  if (!doc.startViewTransition || motionOff()) {
    update();
    return;
  }
  try {
    doc.startViewTransition(() => flushSync(update));
  } catch {
    update();
  }
}

/** Marks the document once, so CSS knows whether to use the View Transition or the mount-animation fallback. */
export function markViewTransitionSupport(): void {
  if (typeof (document as WithVT).startViewTransition === "function") document.documentElement.dataset.vt = "1";
}

/**
 * Keeps an element mounted while it animates out. `mounted` says whether to render it; `open` drives a data attribute that
 * CSS transitions on (so reversing half way settles back instead of jumping).
 */
export function usePresence(show: boolean, exitMs: number): { mounted: boolean; open: boolean } {
  const [mounted, setMounted] = useState(show);
  const [open, setOpen] = useState(show);
  useEffect(() => {
    if (show) {
      setMounted(true);
      const a = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
      return () => cancelAnimationFrame(a);
    }
    setOpen(false);
    const t = window.setTimeout(() => setMounted(false), motionOff() ? 0 : exitMs);
    return () => window.clearTimeout(t);
  }, [show, exitMs]);
  return { mounted: mounted || show, open: open && show };
}

/**
 * Sliding indicator (FLIP without the flip: the browser animates the CSS variables' consumers). Reads the selected
 * descendant (aria-selected or aria-current), writes its box to --ind-x/y/w/h on the container, and turns transitions on only
 * after the first placement so nothing glides in from the corner on load.
 */
export function useSlidingIndicator(ref: RefObject<HTMLElement | null>, deps: unknown[]): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const a = el.querySelector<HTMLElement>('[aria-selected="true"], [aria-current="page"]');
      if (!a) {
        el.style.setProperty("--ind-o", "0");
        return;
      }
      el.style.setProperty("--ind-x", `${a.offsetLeft}px`);
      el.style.setProperty("--ind-y", `${a.offsetTop}px`);
      el.style.setProperty("--ind-w", `${a.offsetWidth}px`);
      el.style.setProperty("--ind-h", `${a.offsetHeight}px`);
      el.style.setProperty("--ind-o", "1");
      if (!el.dataset.ind) requestAnimationFrame(() => requestAnimationFrame(() => (el.dataset.ind = "1")));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const shown = new Set<string>();
/** True only the first time a list with this key is shown in the session, so stagger-in does not repeat on every visit or render. */
export function useFirstShow(key: string): boolean {
  const first = useRef<boolean | null>(null);
  if (first.current === null) {
    first.current = !shown.has(key);
    shown.add(key);
  }
  return first.current && !motionOffSafe();
}
function motionOffSafe(): boolean {
  return typeof document === "undefined" ? true : motionOff();
}

/** Keeps the previous value around for `ms` so a cross-fade can show both layers. */
export function useLayers<T>(value: T, ms: number, key: unknown = value): { value: T; leaving: boolean; id: number }[] {
  const [layers, setLayers] = useState<{ value: T; leaving: boolean; id: number }[]>([{ value, leaving: false, id: 0 }]);
  const counter = useRef(0);
  const last = useRef(key);
  useEffect(() => {
    if (Object.is(last.current, key)) return;
    last.current = key;
    counter.current += 1;
    const id = counter.current;
    setLayers((cur) => [...cur.filter((l) => !l.leaving).map((l) => ({ ...l, leaving: true })), { value, leaving: false, id }]);
    const t = window.setTimeout(() => setLayers((cur) => cur.filter((l) => !l.leaving)), ms);
    return () => window.clearTimeout(t);
  }, [key, value, ms]);
  return layers;
}
