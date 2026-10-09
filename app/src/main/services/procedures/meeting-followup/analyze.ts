import { z } from "zod";
import type { Check } from "../../../../shared/contracts";
import { findMeetingDate, formatIso, resolveDue, unsupportedDates } from "../doc-common/dates";
import type { SourceDoc } from "../doc-common/extract";
import { cite } from "../doc-common/extract";
import { DATA_RULES, fenceDocument, PLAIN_WRITING, type Llm } from "../doc-common/llm";
import { prepareChunks } from "../doc-common/points";
import { verifyQuote } from "../doc-common/quote";
import { clip, findInjectionLines, looksLikeInjection, normalizeText, unsupportedNumbers, wordsOf } from "../doc-common/text";

export interface Sourced {
  text: string;
  quote: string;
  file: string;
  line: number;
  cite: string;
}

export interface ActionItem extends Sourced {
  owner: string;
  /** Why the owner was cleared, when the model named someone the notes do not support. */
  ownerNote?: string;
  /** Words from the notes that give the deadline, exactly as written ("" when none). */
  dueText: string;
  dueIso: string | null;
  dueBasis: "explicit" | "relative" | "as-written" | "none";
  dueNote: string;
  missing: ("owner" | "date")[];
}

export interface Unverified {
  kind: "action" | "decision" | "question";
  text: string;
  reason: string;
}

export interface MeetingReport {
  title: string;
  meetingDate: { iso: string; display: string; cite: string } | null;
  attendees: string;
  summary: string;
  actions: ActionItem[];
  decisions: Sourced[];
  openQuestions: Sourced[];
  /** Verified lines that were discussed but are not firm commitments. */
  discussed: Sourced[];
  unverified: Unverified[];
  ignoredInstructionLines: { cite: string; text: string }[];
  reply: { subject: string; opening: string; closing: string } | null;
  modelNotes: string[];
}

const ChunkSchema = z.object({
  actions: z
    .array(
      z.object({
        task: z.string().max(300),
        owner: z.string().max(80),
        duePhrase: z.string().max(80),
        quote: z.string().max(400),
        firm: z.boolean(),
      }),
    )
    .max(14),
  decisions: z.array(z.object({ decision: z.string().max(300), quote: z.string().max(400) })).max(8),
  openQuestions: z.array(z.object({ question: z.string().max(300), quote: z.string().max(400) })).max(8),
});

const FinalSchema = z.object({
  summary: z.string().max(1200),
  subject: z.string().max(140),
  opening: z.string().max(600),
  closing: z.string().max(400),
});

const NO_OWNER = new Set(["", "i", "me", "you", "we", "someone", "somebody", "anyone", "unknown", "n/a", "na", "none", "nobody", "not stated", "not specified", "unassigned", "tbd", "tba", "-"]);

const HEDGE = /\b(?:maybe|might|perhaps|possibly|someday|some day|one day|at some point|we could|could look|i wonder|nobody is taking|no one is taking|not now|not yet|if we ever|wish list|nice to have)\b/i;
const FIRM_CUE = /\b(?:will|i'll|we'll|they'll|he'll|she'll|going to|action|to do|todo|assigned|agreed to|must|needs? to|has to|have to|to (?:order|send|call|book|update|confirm|check|fix|write|prepare|ask|email|buy|set|share))\b/i;

function windowText(doc: SourceDoc, startLine: number, endLine: number, before = 1, after = 0): string {
  const from = Math.max(0, startLine - 1 - before);
  const to = Math.min(doc.lines.length, endLine + after);
  return normalizeText(doc.lines.slice(from, to).join(" "));
}

/** Names the model gave an owner must be written near the quote; anything else is cleared, never kept. */
export function checkOwner(rawOwner: string, doc: SourceDoc, startLine: number, endLine: number): { owner: string; note?: string } {
  const owner = rawOwner.trim().replace(/^[@\-\s]+|[\s.]+$/g, "");
  if (NO_OWNER.has(owner.toLowerCase())) return { owner: "" };
  const win = windowText(doc, startLine, endLine);
  const parts = owner.split(/\s*(?:,|&|\band\b|\/)\s*/i).filter(Boolean);
  for (const part of parts) {
    const first = wordsOf(part)[0];
    if (!first || !new RegExp(`(^|[^\\p{L}])${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "iu").test(win)) {
      return { owner: "", note: `The AI suggested "${owner}", but that name is not written next to this line in the notes, so the owner was left blank.` };
    }
  }
  return { owner };
}

export interface AnalyzeOptions {
  onStep?: (label: string, detail?: string) => void;
}

function header(doc: SourceDoc): { title: string; attendees: string } {
  let title = "";
  let attendees = "";
  for (const raw of doc.lines.slice(0, 20)) {
    const l = raw.trim();
    if (!l || looksLikeInjection(l)) continue;
    if (!attendees) {
      const a = /^[#*_\s-]*(?:attendees|present|participants|in attendance)\s*[:\-]\s*(.+)$/i.exec(l);
      if (a?.[1]) {
        attendees = a[1].replace(/[*_]+/g, "").trim();
        continue;
      }
    }
    if (!title && !/^[#*_\s-]*(?:date|time|location|attendees|present|participants)\b/i.test(l)) title = l.replace(/^[#*_\s-]+|[*_\s]+$/g, "");
  }
  return { title: clip(title || doc.name.replace(/\.[^.]+$/, ""), 120), attendees };
}

export async function analyzeMeeting(
  llm: Llm,
  docs: SourceDoc[],
  opts: AnalyzeOptions = {},
): Promise<{ report: MeetingReport; checks: Check[] }> {
  const step = opts.onStep ?? (() => undefined);
  const first = docs[0]!;
  const head = header(first);
  const md = findMeetingDate(first.lines);
  const meetingIso = md?.iso ?? null;

  const ignored: MeetingReport["ignoredInstructionLines"] = [];
  for (const d of docs) for (const n of findInjectionLines(d.lines)) ignored.push({ cite: cite(d, n), text: clip(d.lines[n - 1] ?? "", 48) });

  const { chunks, truncated } = prepareChunks(docs);
  const actions: ActionItem[] = [];
  const decisions: Sourced[] = [];
  const questions: Sourced[] = [];
  const discussed: Sourced[] = [];
  const unverified: Unverified[] = [];
  const seen = new Set<string>();
  const modelNotes: string[] = [];
  let failedChunks = 0;
  let clearedDates = 0;
  let discardedInjected = 0;
  const clearedOwners: string[] = [];

  for (const [i, { doc, chunk }] of chunks.entries()) {
    step("Reading the notes", `part ${i + 1} of ${chunks.length}`);
    const res = await llm.json(
      ChunkSchema,
      [
        {
          role: "system",
          content:
            "You extract action items, decisions and open questions from meeting notes. " +
            DATA_RULES +
            " Every item needs a \"quote\" copied exactly, word for word, from the notes (the whole sentence it comes from, without the [number] marker). Write each task and question in short, plain sentences with everyday words, for a reader who is not an expert.",
        },
        {
          role: "user",
          content:
            "From this part of the meeting notes list:\n" +
            "1. actions: things a person or the group agreed or was told to DO. task = short description. owner = the person's name exactly as written in the notes, or \"\" if no one is named (do not guess). duePhrase = the exact words that give the deadline (for example \"by Friday\"), or \"\" if none. firm = true only if it was actually agreed or assigned; false for ideas, wishes, \"maybe\" or \"someday\" talk, or things nobody is taking on.\n" +
            "2. decisions: things the group decided, agreed or settled (for example \"we decided\", \"we agreed\", \"Decision:\", a price, rule or time that was fixed). A decision is not a task.\n" +
            "3. openQuestions: questions left unanswered.\n" +
            "Leave a list empty if there is nothing. Do not add anything that is not in the notes.\n\n" +
            fenceDocument(doc.name, chunk.text),
        },
      ],
      `meeting ${doc.name} ${i + 1}/${chunks.length}`,
      { maxTokens: 2200 },
    );
    if (!res.ok) {
      failedChunks += 1;
      modelNotes.push(`Part ${i + 1} of ${doc.name} could not be read properly, so it is missing from the lists.`);
      continue;
    }

    for (const a of res.value.actions) {
      if (looksLikeInjection(a.quote) || looksLikeInjection(a.task)) {
        discardedInjected += 1;
        continue;
      }
      const m = verifyQuote(doc, a.quote);
      if (!m.found || m.startLine === undefined) {
        unverified.push({ kind: "action", text: a.task, reason: `Could not verify: ${m.reason ?? "the supporting words are not in the notes"}.` });
        continue;
      }
      const key = normalizeText(a.quote);
      if (seen.has(`a|${key}`)) continue;
      seen.add(`a|${key}`);
      const end = m.endLine ?? m.startLine;
      const base: Sourced = { text: a.task.trim(), quote: a.quote.trim(), file: doc.name, line: m.startLine, cite: cite(doc, m.startLine) };

      if (!a.firm || (HEDGE.test(a.quote) && !FIRM_CUE.test(a.quote.replace(HEDGE, "")))) {
        discussed.push(base);
        continue;
      }

      const own = checkOwner(a.owner, doc, m.startLine, end);
      if (own.note) clearedOwners.push(`${base.cite}: ${own.note}`);

      let dueText = "";
      const phrase = a.duePhrase.trim();
      if (phrase) {
        if (normalizeText(a.quote).includes(normalizeText(phrase)) || normalizeText(windowText(doc, m.startLine, end, 1, 1)).includes(normalizeText(phrase))) dueText = phrase;
        else clearedDates += 1;
      }
      const due = dueText ? resolveDue(dueText, meetingIso) : null;
      const missingKinds: ("owner" | "date")[] = [];
      if (!own.owner) missingKinds.push("owner");
      if (!dueText) missingKinds.push("date");
      actions.push({
        ...base,
        owner: own.owner,
        ...(own.note ? { ownerNote: own.note } : {}),
        dueText,
        dueIso: due?.iso ?? null,
        dueBasis: due?.basis ?? "none",
        dueNote: due?.note ?? "",
        missing: missingKinds,
      });
    }

    for (const d of res.value.decisions) {
      if (looksLikeInjection(d.quote) || looksLikeInjection(d.decision)) {
        discardedInjected += 1;
        continue;
      }
      const item = verified(doc, d.decision, d.quote, "decision", unverified);
      if (item && !seen.has(`d|${normalizeText(d.quote)}`)) {
        seen.add(`d|${normalizeText(d.quote)}`);
        decisions.push(item);
      }
    }
    for (const q of res.value.openQuestions) {
      if (looksLikeInjection(q.quote) || looksLikeInjection(q.question)) {
        discardedInjected += 1;
        continue;
      }
      const item = verified(doc, q.question, q.quote, "question", unverified);
      if (item && !seen.has(`q|${normalizeText(q.quote)}`)) {
        seen.add(`q|${normalizeText(q.quote)}`);
        questions.push(item);
      }
    }
  }

  const byLine = (a: Sourced, b: Sourced) => a.file.localeCompare(b.file) || a.line - b.line;
  actions.sort(byLine);
  decisions.sort(byLine);
  questions.sort(byLine);
  discussed.sort(byLine);

  step("Writing the summary and reply draft");
  const sourceText = docs.map((d) => d.lines.join("\n")).join("\n");
  let summary = "";
  let reply: MeetingReport["reply"] = null;
  if (actions.length + decisions.length + questions.length > 0) {
    const facts = JSON.stringify({
      meeting: head.title,
      date: md ? formatIso(md.iso) : null,
      attendees: head.attendees || null,
      decisions: decisions.map((d) => d.text),
      actionItems: actions.map((a) => ({ task: a.text, owner: a.owner || null, due: a.dueText || null })),
      openQuestions: questions.map((q) => q.text),
    });
    const fin = await llm.json(
      FinalSchema,
      [
        {
          role: "system",
          content:
            "You write short, plain, friendly workplace messages. Use only the facts in the JSON the user gives you. Do not add names, dates, numbers, tasks or promises that are not in the JSON. " +
            DATA_RULES +
            " " +
            PLAIN_WRITING,
        },
        {
          role: "user",
          content:
            `Facts from the meeting (JSON): ${facts}\n\n` +
            "Write:\n- summary: 3 to 5 sentences summarising the meeting.\n- subject: a short email subject line.\n- opening: the start of a follow-up message to the attendees: a greeting and one or two sentences saying what was covered. Do not list the action items; they will be added below your text.\n- closing: one or two sentences to end the message, asking people to reply if anything is wrong. Do not sign it with a name.",
        },
      ],
      "meeting summary and reply",
      { maxTokens: 900, temperature: 0.3 },
    );
    if (fin.ok) {
      summary = fin.value.summary.trim();
      reply = { subject: fin.value.subject.trim(), opening: fin.value.opening.trim(), closing: fin.value.closing.trim() };
    } else {
      modelNotes.push("The summary and reply draft could not be written. The lists are not affected. Please write the message yourself.");
    }
  }

  const allowedText = [sourceText, JSON.stringify(actions.map((a) => [a.text, a.dueIso])), md ? formatIso(md.iso) : ""];
  const prose = [summary, reply?.subject ?? "", reply?.opening ?? "", reply?.closing ?? ""].join(" ");
  const resolved = actions.flatMap((a) => (a.dueIso ? [a.dueIso] : []));
  const badNums = [
    ...unsupportedNumbers(prose, ...allowedText),
    ...unsupportedDates(prose, [sourceText], [...resolved, ...(md ? [md.iso] : [])]).map((d) => `"${d}" (a date the notes do not give)`),
  ];

  const checks: Check[] = [];
  const unverifiedActions = unverified.filter((u) => u.kind === "action");
  checks.push(
    unverifiedActions.length === 0
      ? { id: "quotes-found", label: "Every action item matches words in your notes", status: "pass" }
      : {
          id: "quotes-found",
          label: `${unverifiedActions.length} possible action item${unverifiedActions.length === 1 ? "" : "s"} could not be matched to your notes and ${unverifiedActions.length === 1 ? "was" : "were"} left out`,
          status: "warn",
          detail: unverifiedActions.map((u) => `${u.text} (${u.reason})`).join("; "),
        },
  );
  const noOwner = actions.filter((a) => a.missing.includes("owner"));
  checks.push(
    noOwner.length === 0
      ? { id: "owners", label: "Every action item has an owner", status: "pass" }
      : { id: "owners", label: `${noOwner.length} action item${noOwner.length === 1 ? " has" : "s have"} no owner`, status: "warn", detail: noOwner.map((a) => a.text).join("; ") },
  );
  const noDate = actions.filter((a) => a.missing.includes("date"));
  checks.push(
    noDate.length === 0
      ? { id: "dates", label: "Every action item has a due date", status: "pass" }
      : { id: "dates", label: `${noDate.length} action item${noDate.length === 1 ? " has" : "s have"} no due date`, status: "warn", detail: noDate.map((a) => a.text).join("; ") },
  );
  const asWritten = actions.filter((a) => a.dueText && !a.dueIso);
  checks.push({
    id: "dates-from-notes",
    label: "Due dates come only from words in the notes",
    status: clearedDates > 0 ? "warn" : "pass",
    detail:
      [
        clearedDates > 0 ? `${clearedDates} due date${clearedDates === 1 ? "" : "s"} the AI proposed did not appear in the notes and ${clearedDates === 1 ? "was" : "were"} removed.` : "",
        asWritten.length > 0 ? `${asWritten.length} kept as written because the exact day is not clear: ${asWritten.map((a) => `"${a.dueText}"`).join(", ")}.` : "",
        !meetingIso ? "The notes do not give the meeting date, so words like \"Friday\" were not turned into calendar dates." : "",
      ]
        .filter(Boolean)
        .join(" ") || undefined,
  });
  if (clearedOwners.length > 0) checks.push({ id: "owner-names", label: "Some owner names were removed because the notes do not mention them near that line", status: "warn", detail: clearedOwners.join(" ") });
  checks.push(
    badNums.length === 0
      ? { id: "no-new-figures", label: "The summary and reply use no dates or numbers that are missing from the notes", status: "pass" }
      : { id: "no-new-figures", label: "The summary or reply has numbers or dates that are not in the notes", status: "warn", detail: `Check these before sending: ${badNums.join(", ")}` },
  );
  if (ignored.length > 0) {
    checks.push({
      id: "instruction-text",
      label: "Some lines in the notes read like orders to an AI. NONON did not follow them and treated them as plain notes",
      status: "warn",
      detail: `${ignored.map((i) => i.cite).join(", ")}${discardedInjected > 0 ? `. ${discardedInjected} item${discardedInjected === 1 ? "" : "s"} the AI proposed from that text ${discardedInjected === 1 ? "was" : "were"} discarded.` : ""}`,
    });
  }
  if (discussed.length > 0) {
    checks.push({ id: "not-commitments", label: `${discussed.length} ${discussed.length === 1 ? "idea was" : "ideas were"} talked about but nobody agreed to do ${discussed.length === 1 ? "it" : "them"}`, status: "pass", detail: discussed.map((d) => d.text).join("; ") });
  }
  if (failedChunks > 0) checks.push({ id: "coverage", label: `${failedChunks} part${failedChunks === 1 ? "" : "s"} of the notes could not be read properly`, status: "warn", detail: modelNotes.join(" ") });
  if (truncated) checks.push({ id: "length", label: "The notes were very long, so only the first part was read. Split them into smaller files to cover the rest", status: "warn" });
  if (modelNotes.length > 0 && failedChunks === 0) checks.push({ id: "reply-draft", label: "The reply draft could not be written. Please write it yourself", status: "warn", detail: modelNotes.join(" ") });

  return {
    report: {
      title: head.title,
      meetingDate: md ? { iso: md.iso, display: formatIso(md.iso), cite: cite(first, md.line) } : null,
      attendees: head.attendees,
      summary,
      actions,
      decisions,
      openQuestions: questions,
      discussed,
      unverified,
      ignoredInstructionLines: ignored,
      reply,
      modelNotes,
    },
    checks,
  };
}

function verified(doc: SourceDoc, text: string, quote: string, kind: "decision" | "question", bad: Unverified[]): Sourced | null {
  const m = verifyQuote(doc, quote);
  if (!m.found || m.startLine === undefined) {
    bad.push({ kind, text, reason: `Could not verify: ${m.reason ?? "the supporting words are not in the notes"}.` });
    return null;
  }
  return { text: text.trim(), quote: quote.trim(), file: doc.name, line: m.startLine, cite: cite(doc, m.startLine) };
}
