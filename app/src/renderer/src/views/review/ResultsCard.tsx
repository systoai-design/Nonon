import { useState } from "react";
import { Icon } from "../../components/Icon";
import type { OutputRef, Task } from "../../../../shared/contracts";
import { call, errMsg, formatCents, plural } from "../lib";
import { ErrorLine } from "../ui";
import { ChecksList } from "./ChecksList";
import { TASK_STATE_WORDS } from "./describe";
import { readReport, type ReportClassId } from "./report";

const COLORS: Record<ReportClassId, string> = {
  matched: "var(--ink)",
  onlyA: "#f47b32",
  onlyB: "#9a3412",
  duplicates: "#8c8c8c",
  ambiguous: "#d4d4d4",
};

function OutputChip({ out, onError }: { out: OutputRef; onError: (m: string) => void }) {
  const glyph = out.kind === "xlsx" || out.kind === "csv" ? "spreadsheet" : "file";
  return (
    <button
      type="button"
      className="chip max-w-full cursor-pointer hover:bg-[var(--accent-soft)]"
      title={`Open ${out.path}`}
      onClick={() => call("shell:open", { path: out.path }).catch((e) => onError(errMsg(e)))}
    >
      <Icon name={glyph} size={16} />
      <span className="truncate">{out.label}</span>
    </button>
  );
}

export function ResultsCard({ task }: { task: Task }) {
  const [error, setError] = useState<string | null>(null);
  const report = readReport(task.report);
  const total = report ? report.classes.reduce((n, c) => n + c.count, 0) : 0;
  const stateWords = TASK_STATE_WORDS[task.state];

  return (
    <section className="card flex flex-col gap-4 p-5" aria-label="Results">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3>{task.title}</h3>
          <span className="chip shrink-0">{stateWords}</span>
        </div>
        {task.summary && <p className="m-0 mt-2 whitespace-pre-line">{task.summary}</p>}
        {task.error && <p className="m-0 mt-2 text-[14px]" style={{ color: "var(--red)" }}>{errMsg(task.error)}</p>}
      </div>

      {report && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[14px]">What was found</h3>
          <div
            className="flex h-3 w-full overflow-hidden rounded-full"
            style={{ background: "var(--panel)" }}
            role="img"
            aria-label={report.classes.map((c) => `${c.label}: ${c.count}`).join(", ")}
          >
            {total > 0 &&
              report.classes
                .filter((c) => c.count > 0)
                .map((c) => <div key={c.id} style={{ width: `${(c.count / total) * 100}%`, background: COLORS[c.id] }} />)}
          </div>
          <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-2 p-0">
            {report.classes.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-[14px]">
                <span className="mt-[6px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLORS[c.id] }} aria-hidden />
                <div className="min-w-0">
                  <div>
                    <span className="font-semibold tabular-nums">{c.count}</span> <span className="muted">{c.label}</span>
                  </div>
                  {c.cents !== null && <div className="text-[13px] tabular-nums muted">{formatCents(c.cents, report.currency)}</div>}
                </div>
              </li>
            ))}
          </ul>
          {report.totals.length > 0 && (
            <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-3 text-[14px]" style={{ borderColor: "var(--line)" }}>
              {report.totals.map((t) => (
                <div key={t.label} className="contents">
                  <dt className="muted">{t.label}</dt>
                  <dd className="m-0 text-right font-semibold tabular-nums">{formatCents(t.cents, report.currency)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="m-0 text-[12.5px] muted">
            {plural(total, "row")} counted. NONON adds up the amounts itself, so the numbers are exact.
          </p>
        </div>
      )}

      {task.outputs.length > 0 && (
        <div>
          <h3 className="mb-2 text-[14px]">Files NONON made</h3>
          <div className="flex flex-wrap gap-2">
            {task.outputs.map((o) => (
              <OutputChip key={o.path} out={o} onError={setError} />
            ))}
          </div>
        </div>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}

      <ChecksList checks={task.checks} title="What NONON checked" />
    </section>
  );
}
