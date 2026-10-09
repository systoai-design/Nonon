import { useRef, type ReactNode } from "react";
import { useSlidingIndicator } from "../lib/motion";

/** A tab strip whose underline slides to the selected tab (the CSS for `.dock-tabs` and `.sheet-tabs` draws it). */
export function SlideTabs({ className, label, deps, children }: { className: string; label: string; deps: unknown[]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useSlidingIndicator(ref, deps);
  return (
    <div ref={ref} className={className} role="tablist" aria-label={label}>
      {children}
    </div>
  );
}
