import type { ProcedureDef, ProcedureOutcome } from "../../../../shared/contracts";
import { writeDocPair } from "../doc-common/docmodel";
import { docFromText, extractMany, type SourceDoc } from "../doc-common/extract";
import { makeLlm } from "../doc-common/llm";
import { analyzeMeeting } from "./analyze";
import { buildBlocks } from "./render";

export const meetingFollowup: ProcedureDef = {
  id: "meeting-followup",
  pack: "business",
  title: "Meeting follow-up",
  summary: "Get a list of action items, decisions and open questions from your meeting notes, plus a reply you can edit.",
  supports:
    "Give it your meeting notes as a .txt, .md, .docx or PDF file, or paste them in. You get action items (who, what and when), decisions and open questions, each with the words and line it came from. You also get a reply draft, saved as a Word file and a plain text copy.",
  limits: [
    "Scanned or photographed PDFs and audio recordings are not read. Use a typed copy of the notes instead.",
    "Owners and due dates are filled in only when the notes say them. Missing ones are highlighted so you can add them.",
    "A day like 'by Friday' becomes a calendar date only when the notes give the meeting date. Phrases like 'next week' stay as written.",
    "Very long notes are read in parts, up to about 40. If yours are longer, split them into smaller files.",
    "The reply is only a draft. NONON never sends it.",
  ],
  inputs: [
    { key: "notes", label: "Meeting notes", kind: "file", accept: [".txt", ".md", ".docx", ".pdf"], optional: true, help: "A file with your meeting notes, or a typed copy of what was said." },
    { key: "pastedNotes", label: "Or paste the notes", kind: "text", optional: true },
  ],
  revision: "1",
  async run(ctx): Promise<ProcedureOutcome> {
    const docs: SourceDoc[] = [];
    const paths = ctx.files.notes ?? [];
    if (paths.length > 0) {
      ctx.step("Opening the notes");
      const { docs: ok, failures } = await extractMany(paths.slice(0, 1));
      docs.push(...ok);
      if (ok.length === 0 && failures[0]) return { kind: "unsupported", reason: failures[0].reason, suggestion: "Save the notes as a .txt, .docx or PDF file that has real text in it, or paste them into the box. Nothing was changed." };
    }
    const pasted = (ctx.text.pastedNotes ?? "").trim();
    if (pasted) docs.push(docFromText("Pasted notes.txt", pasted));
    if (docs.length === 0) return { kind: "unsupported", reason: "There are no notes to read yet.", suggestion: "Choose a notes file or paste your notes into the box." };

    const llm = makeLlm(ctx.ai, ctx.signal);
    const { report, checks } = await analyzeMeeting(llm, docs, { onStep: (l, d) => ctx.step(l, d) });

    ctx.step("Writing the follow-up document");
    const blocks = buildBlocks(report, checks);
    const outputs = await writeDocPair(ctx, "Meeting follow-up", blocks, "Meeting follow-up");

    const miss = report.actions.filter((a) => a.missing.length > 0).length;
    const summary =
      report.actions.length + report.decisions.length + report.openQuestions.length === 0
        ? "I read the notes but did not find any action items, decisions or open questions that I could match to the notes' own words."
        : `Found ${report.actions.length} action item${report.actions.length === 1 ? "" : "s"}${miss ? ` (${miss} missing an owner or a date, highlighted)` : ""}, ${report.decisions.length} decision${report.decisions.length === 1 ? "" : "s"} and ${report.openQuestions.length} open question${report.openQuestions.length === 1 ? "" : "s"}. Every item shows the words it came from. The reply draft is ready to edit.`;

    return { kind: "done", summary, outputs, proposals: [], checks, report: { ...report, llm: { calls: llm.stats.calls, retries: llm.stats.retries, failures: llm.stats.failures, ms: llm.stats.ms } } };
  },
};

export const procedures: ProcedureDef[] = [meetingFollowup];
