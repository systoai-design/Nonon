import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { Question } from "../../../shared/contracts";
import { Spinner } from "../components/ui";

function optionsFor(q: Question): { value: string; label: string }[] {
  if (q.kind === "confirm") return [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
  return q.options ?? [];
}

/** One-click suggested answers: the suggestion is preselected, so "Continue" is a single click. */
export function QuestionForm({ questions, onSubmit }: { questions: Question[]; onSubmit: (answers: Record<string, string>, remember: boolean) => Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(questions.filter((q) => q.suggested).map((q) => [q.id, q.suggested as string])));
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);

  const complete = questions.every((q) => (answers[q.id] ?? "").trim() !== "");

  async function submit() {
    setBusy(true);
    try {
      await onSubmit(answers, remember);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="questions"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete && !busy) void submit();
      }}
    >
      {questions.map((q) => {
        const opts = optionsFor(q);
        const hasOptions = opts.length > 0;
        return (
          <fieldset key={q.id} className="question">
            <legend>{q.prompt}</legend>
            {hasOptions ? (
              <div className="choice-row" role="radiogroup" aria-label={q.prompt}>
                {opts.map((o) => {
                  const selected = answers[q.id] === o.value;
                  return (
                    <button key={o.value} type="button" role="radio" aria-checked={selected} className={`choice ${selected ? "selected" : ""}`} onClick={() => setAnswers({ ...answers, [q.id]: o.value })}>
                      {o.label}
                      {q.suggested === o.value && (
                        <span className="choice-tag">
                          <Sparkles size={12} aria-hidden="true" /> Suggested
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-answer">
                <input className="input" aria-label={q.prompt} value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                {q.suggested && answers[q.id] !== q.suggested && (
                  <button type="button" className="choice" onClick={() => setAnswers({ ...answers, [q.id]: q.suggested as string })}>
                    Use this: {q.suggested}
                  </button>
                )}
              </div>
            )}
          </fieldset>
        );
      })}
      <div className="questions-foot">
        <label className="check-row">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Use this answer next time</span>
        </label>
        <button type="submit" className="btn btn-primary" disabled={!complete || busy}>
          {busy && <Spinner />}
          Continue
        </button>
      </div>
    </form>
  );
}
