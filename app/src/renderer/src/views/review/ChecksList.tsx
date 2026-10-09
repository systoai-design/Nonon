import { Icon } from "../../components/Icon";
import type { Check } from "../../../../shared/contracts";

const WORDS = { pass: "Good", warn: "Worth a look", fail: "Problem" } as const;

export function ChecksList({ checks, title = "What was checked" }: { checks: Check[]; title?: string }) {
  if (checks.length === 0) return null;
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-[14px]">{title}</h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {checks.map((c) => {
          const glyph = c.status === "pass" ? "check" : c.status === "warn" ? "alert" : "close";
          const color = c.status === "pass" ? "var(--ink)" : c.status === "warn" ? "var(--attn-ink)" : "var(--red-ink)";
          return (
            <li key={c.id} className="flex gap-2.5 text-[14px]">
              <span className="mt-[3px] shrink-0" style={{ color }}>
                <Icon name={glyph} size={18} tone="current" />
              </span>
              <div className="min-w-0">
                <span>{c.label}</span> <span className="sr-only">: {WORDS[c.status]}.</span>
                {c.detail && <div className="text-[13.5px] muted">{c.detail}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
