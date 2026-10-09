import type { Check } from "../../../../shared/contracts";
import { formatIso } from "../doc-common/dates";
import { h1, h2, missing, p, type Block, type Run } from "../doc-common/docmodel";
import type { ActionItem, MeetingReport, Sourced } from "./analyze";

function dueRuns(a: ActionItem): Run[] {
  if (!a.dueText) return [missing("date")];
  if (a.dueIso) return [a.dueBasis === "explicit" ? formatIso(a.dueIso) : `${formatIso(a.dueIso)} (from "${a.dueText}")`];
  return [`"${a.dueText}" (as written in the notes)`];
}

function sourceRuns(s: Sourced): Run[] {
  return [{ text: s.cite, bold: true }, " ", { text: `"${s.quote}"`, italic: true }];
}

/** Plain-text line for the reply draft; unknowns are spelled out, never filled in. */
export function replyActionLine(a: ActionItem): Run[] {
  const runs: Run[] = [];
  runs.push(a.owner ? `${a.owner}: ` : { text: "[owner to be confirmed]", highlight: true });
  if (!a.owner) runs.push(" ");
  runs.push(a.text.replace(/\.$/, ""));
  if (a.dueText) runs.push(a.dueIso ? ` (due ${formatIso(a.dueIso)})` : ` (${a.dueText})`);
  else runs.push(" ", { text: "[date to be confirmed]", highlight: true });
  return runs;
}

export function buildBlocks(r: MeetingReport, checks: Check[]): Block[] {
  const b: Block[] = [{ t: "title", text: `Meeting follow-up: ${r.title}` }];
  b.push(p(r.meetingDate ? `Meeting date: ${r.meetingDate.display} (${r.meetingDate.cite})` : { text: "Meeting date: not stated in the notes", italic: true }));
  if (r.attendees) b.push(p(`Attendees: ${r.attendees}`));
  b.push({
    t: "note",
    runs: [
      "Everything below comes from your notes. Each item shows the exact words it came from. Highlighted items are missing details that only you can fill in. This is a draft you can edit.",
    ],
  });

  b.push(h1("Summary"));
  b.push(r.summary ? p(r.summary) : p({ text: "A summary could not be written. The lists below are not affected.", italic: true }));

  b.push(h1("Action items"));
  if (r.actions.length === 0) {
    b.push(p("No action items were found in the notes."));
  } else {
    b.push({
      t: "table",
      header: ["#", "Task", "Owner", "Due", "Source in notes"],
      rows: r.actions.map((a, i) => [[String(i + 1)], [a.text], a.owner ? [a.owner] : [missing("owner")], dueRuns(a), sourceRuns(a)]),
    });
    const notes = r.actions.filter((a) => a.ownerNote || (a.dueText && !a.dueIso && a.dueNote)).map((a) => `${a.cite}: ${[a.ownerNote, a.dueIso ? "" : a.dueNote].filter(Boolean).join(" ")}`);
    if (notes.length > 0) b.push({ t: "bullets", items: notes.map((n) => [n]) });
  }

  b.push(h1("Decisions"));
  b.push(r.decisions.length === 0 ? p("No decisions were found in the notes.") : { t: "bullets", items: r.decisions.map((d) => [d.text, " - ", ...sourceRuns(d)]) });

  b.push(h1("Open questions"));
  b.push(r.openQuestions.length === 0 ? p("No open questions were found in the notes.") : { t: "bullets", items: r.openQuestions.map((q) => [q.text, " - ", ...sourceRuns(q)]) });

  if (r.discussed.length > 0) {
    b.push(h1("Talked about, not agreed"));
    b.push(p({ text: "These came up in the meeting, but nobody agreed to do them, so they are not in the action list.", italic: true }));
    b.push({ t: "bullets", items: r.discussed.map((d) => [d.text, " - ", ...sourceRuns(d)]) });
  }

  if (r.unverified.length > 0) {
    b.push(h1("Could not check against your notes"));
    b.push(p({ text: "The AI suggested these, but the supporting words are not in your notes, so they are not in the lists above. Look at your notes yourself if you think they belong.", italic: true }));
    b.push({ t: "bullets", items: r.unverified.map((u) => [`${u.text} - ${u.reason}`]) });
  }

  b.push(h1("Reply draft"));
  b.push(p({ text: "A message you can send to everyone who was there. Read and edit it first. NONON never sends anything.", italic: true }));
  if (r.reply) {
    b.push(p({ text: "Subject:", bold: true }, " ", r.reply.subject));
    b.push(p(r.reply.opening));
  } else {
    b.push(p({ text: "The AI could not write the opening. The details below are not affected. Add your own greeting.", italic: true }));
  }
  if (r.actions.length > 0) {
    b.push(p({ text: "Action items:", bold: true }));
    b.push({ t: "bullets", items: r.actions.map(replyActionLine) });
  }
  if (r.decisions.length > 0) {
    b.push(p({ text: "Decisions:", bold: true }));
    b.push({ t: "bullets", items: r.decisions.map((d) => [d.text]) });
  }
  if (r.openQuestions.length > 0) {
    b.push(p({ text: "Still open:", bold: true }));
    b.push({ t: "bullets", items: r.openQuestions.map((q) => [q.text]) });
  }
  if (r.reply) b.push(p(r.reply.closing));
  b.push(p({ text: "[Your name]", highlight: true }));

  b.push(h2("Checks"));
  b.push({ t: "bullets", items: checks.map((c) => [`${c.status === "pass" ? "Passed" : c.status === "warn" ? "Needs a look" : "Failed"}: ${c.label}${c.detail ? ` (${c.detail})` : ""}`]) });
  return b;
}
