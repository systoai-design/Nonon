import { z } from "zod";
import type { Check, ProcedureDef, ProcedureOutcome } from "../../../../shared/contracts";
import { h1, writeDocPair, type Block, type Run } from "../doc-common/docmodel";
import { cite, extractMany } from "../doc-common/extract";
import { DATA_RULES, makeLlm, PLAIN_WRITING } from "../doc-common/llm";
import { extractKeyPoints } from "../doc-common/points";
import { unsupportedDates } from "../doc-common/dates";
import { clip, collapseRepeats, findInjectionLines, unsupportedCurrency, unsupportedNumbers } from "../doc-common/text";

type DraftType = "reply" | "report" | "summary";

const DraftSchema = z.object({
  title: z.string().max(120),
  summary: z.string().max(900),
  sections: z
    .array(z.object({ heading: z.string().max(80), body: z.string().max(1400), pointIds: z.array(z.number().int()).max(6) }))
    .min(1)
    .max(6),
  missingInformation: z.array(z.string().max(160)).max(8),
});

const TASKS: Record<DraftType, string> = {
  reply:
    "Draft a reply the user can send to this document. Sections are the parts of the reply (for example the greeting and opening, the answer to each thing the document asks, and the closing). Put a [placeholder] such as [your decision], [your name] or [date] wherever the user must decide or supply something. Do not agree to, accept, promise or decline anything on the user's behalf unless the user's instructions say to.",
  report: "Draft a short report about this document for someone who has not read it. Sections might be Background, Key points and Open questions. Only include next steps if the document itself states them.",
  summary: "Write a plain summary of this document: what it is, who it is from, what it asks or says, and any dates or amounts it states.",
};

const PROMISE = /\b(?:I(?:'ll| will| agree| accept| confirm| promise| can)|we(?:'ll| will| agree| accept| confirm| promise)|please consider (?:this|it) (?:accepted|confirmed))\b/i;

export const documentDraft: ProcedureDef = {
  id: "document-draft",
  pack: "general",
  title: "Summarize a document and write a draft",
  summary: "Get a short summary of a document, plus a draft reply or report, with the lines each part came from.",
  supports:
    "Give it one .txt, .md, .docx or PDF file. You get a short summary of it, plus a draft reply, a short report or a longer summary. Each part shows the lines of the document it is based on, and anything you still need to fill in is highlighted. It is saved as a Word file and a plain text copy.",
  limits: [
    "Scanned or photographed PDFs and pictures are not read. Use a file that has real text.",
    "The draft is a starting point. It never sends anything and never makes promises for you. Those parts are left as [placeholders] for you to fill in.",
    "Dates, amounts and names come only from the document or from your instructions.",
    "Very long documents are read in parts, up to about 40. If yours is longer, split it into smaller files.",
  ],
  inputs: [
    { key: "source", label: "Document", kind: "file", accept: [".txt", ".md", ".docx", ".pdf"] },
    {
      key: "draftType",
      label: "What to write",
      kind: "choice",
      optional: true,
      options: [
        { value: "reply", label: "A reply" },
        { value: "report", label: "A short report" },
        { value: "summary", label: "A summary" },
      ],
      help: "Default: a reply.",
    },
    { key: "instructions", label: "Anything the draft should say (optional)", kind: "text", optional: true },
  ],
  revision: "1",
  async run(ctx): Promise<ProcedureOutcome> {
    const paths = ctx.files.source ?? [];
    if (paths.length === 0) return { kind: "unsupported", reason: "There is no document to read yet.", suggestion: "Choose a .txt, .md, .docx or PDF file." };
    ctx.step("Opening the document");
    const { docs, failures } = await extractMany(paths.slice(0, 1));
    if (docs.length === 0) return { kind: "unsupported", reason: failures[0]?.reason ?? "The document could not be opened.", suggestion: "Save it as a .txt, .docx or PDF that has real text, then try again. Nothing was changed." };

    const type: DraftType = ((): DraftType => {
      const v = (ctx.text.draftType ?? ctx.answers.draftType ?? "reply").trim().toLowerCase();
      return v === "report" || v === "summary" ? v : "reply";
    })();
    const instructions = (ctx.text.instructions ?? "").trim();
    const llm = makeLlm(ctx.ai, ctx.signal);

    const pts = await extractKeyPoints(llm, docs, {
      purpose: type === "reply" ? "What the document asks, offers or states, including every deadline, amount and request, so a reply can be written." : "The main facts, requests, dates and amounts in the document.",
      onExcerpt: (i, n) => ctx.step("Reading the document", `part ${i} of ${n}`),
    });
    if (pts.points.length === 0) {
      return { kind: "unsupported", reason: "I could not find enough in that document to work from. It may be too short, or it may have no text I can read.", suggestion: "Try a file that has real text, or paste the text into a .txt file." };
    }

    ctx.step("Drafting");
    const points = pts.points.slice(0, 40);
    const res = await llm.json(
      DraftSchema,
      [
        { role: "system", content: `You help ordinary people understand letters and documents and draft clear, polite, plain writing. ${DATA_RULES} ${PLAIN_WRITING}` },
        {
          role: "user",
          content:
            `${TASKS[type]}\n\n` +
            (instructions ? `The user's instructions (these are from the user, not from the document): ${instructions}\n\n` : "") +
            `Points from the document (use ONLY these facts; cite them by id in pointIds):\n${points.map((p) => `[${p.id}] ${p.point}`).join("\n")}\n\n` +
            `Return: title; summary (3 to 5 sentences describing the ORIGINAL document: who it is from, what it says and asks; not the reply); sections (heading, body, pointIds); missingInformation (things the user must still supply or decide, one per item).`,
        },
      ],
      "document draft",
      { maxTokens: 2400, temperature: 0.3 },
    );
    if (!res.ok) return { kind: "unsupported", reason: "I could not put together a good draft this time.", suggestion: "Try again, or use a shorter document." };

    const d = res.value;
    const ids = new Set(points.map((p) => p.id));
    const byId = new Map(points.map((p) => [p.id, p] as const));
    let repeatsRemoved = 0;
    const sections = d.sections.map((s) => {
      const body = collapseRepeats(s.body);
      repeatsRemoved += body.removed;
      return { ...s, body: body.text, pointIds: [...new Set(s.pointIds.filter((i) => ids.has(i)))] };
    });

    const sourceText = docs.map((x) => x.lines.join("\n")).join("\n");
    const prose = [d.title, d.summary, ...sections.flatMap((s) => [s.heading, s.body])].join(" ");
    const badNums = [
      ...unsupportedNumbers(prose, sourceText, instructions),
      ...unsupportedDates(prose, [sourceText, instructions]).map((d) => `"${d}" (a date the document does not give)`),
      ...unsupportedCurrency(prose, sourceText, instructions).map((c) => `${c} (the document does not use this money sign)`),
    ];
    const placeholders = [...new Set([...prose.matchAll(/\[[^\]\n]{2,60}\]/g)].map((m) => m[0]))];
    const promises = type === "reply" && !instructions ? sections.filter((s) => PROMISE.test(s.body)) : [];
    const unlinked = type === "reply" ? [] : sections.filter((s) => s.pointIds.length === 0);
    const injected = findInjectionLines(docs[0]!.lines).map((n) => cite(docs[0]!, n));

    const checks: Check[] = [
      { id: "source-lines", label: "Each fact comes from a quote and line in your document", status: "pass", detail: `${points.length} point${points.length === 1 ? "" : "s"} from your document matched word for word.` },
      badNums.length === 0
        ? { id: "no-new-figures", label: "No dates, amounts or numbers that are missing from your document or instructions", status: "pass" }
        : { id: "no-new-figures", label: "The draft has numbers or amounts that are not in your document", status: "warn", detail: `Check: ${badNums.join(", ")}` },
      promises.length === 0
        ? { id: "no-promises", label: "The draft makes no promises for you that you did not ask for", status: "pass" }
        : { id: "no-promises", label: "The draft may agree to something on your behalf. Read it before sending", status: "warn", detail: promises.map((s) => s.heading).join("; ") },
    ];
    if (repeatsRemoved > 0) checks.push({ id: "repetition", label: `The AI repeated itself ${repeatsRemoved} time${repeatsRemoved === 1 ? "" : "s"}; the repeats were removed`, status: "warn", detail: "Read the draft once to make sure it still flows." });
    if (unlinked.length > 0) checks.push({ id: "source-links", label: `${unlinked.length} section${unlinked.length === 1 ? " has" : "s have"} no link to a line in the document`, status: "warn", detail: unlinked.map((s) => s.heading).join("; ") });
    if (placeholders.length > 0) checks.push({ id: "placeholders", label: `${placeholders.length} thing${placeholders.length === 1 ? "" : "s"} for you to fill in`, status: "warn", detail: placeholders.join(", ") });
    if (injected.length > 0) checks.push({ id: "instruction-text", label: "Some lines in the document read like orders to an AI. NONON did not follow them", status: "warn", detail: injected.join(", ") });
    if (pts.failedExcerpts > 0) checks.push({ id: "coverage", label: `${pts.failedExcerpts} part${pts.failedExcerpts === 1 ? "" : "s"} of the document could not be read properly`, status: "warn" });
    if (pts.truncated) checks.push({ id: "length", label: "The document was very long, so only the first part was read. Split it into smaller files to cover the rest", status: "warn" });

    const marks = (text: string): Run[] => text.split(/(\[[^\]\n]{2,60}\])/).filter(Boolean).map((t) => (/^\[[^\]\n]{2,60}\]$/.test(t) ? { text: t, highlight: true } : t));
    const label = { reply: "Reply draft", report: "Short report", summary: "Summary" }[type];
    const blocks: Block[] = [{ t: "title", text: `${label}: ${d.title}` }];
    blocks.push({ t: "note", runs: [`Written from ${docs[0]!.name}. Under each part you can see the lines it is based on. Highlighted [brackets] need your input. This is a draft you can edit. NONON never sends anything.`] });
    blocks.push(h1("About the document"));
    blocks.push({ t: "p", runs: marks(d.summary) });
    blocks.push(h1(label));
    for (const s of sections) {
      blocks.push({ t: "h2", text: s.heading });
      for (const para of s.body.split(/\n+/).filter(Boolean)) blocks.push({ t: "p", runs: marks(para) });
      if (s.pointIds.length > 0) blocks.push({ t: "p", runs: [{ text: `Based on: ${[...new Set(s.pointIds.map((i) => cite(byId.get(i)!.doc, byId.get(i)!.line)))].join("; ")}`, italic: true }] });
    }
    if (d.missingInformation.length > 0 || placeholders.length > 0) {
      blocks.push(h1("Still needed from you"));
      const items: Run[][] = d.missingInformation.map((m) => [{ text: m, highlight: true }]);
      if (placeholders.length > 0) items.push(["Placeholders in the draft: ", ...placeholders.flatMap((p, i) => (i ? [", ", { text: p, highlight: true }] : [{ text: p, highlight: true }])) as Run[]]);
      blocks.push({ t: "bullets", items });
    }
    blocks.push(h1("Source lines"));
    const used = [...new Set(sections.flatMap((s) => s.pointIds))].sort((a, b) => a - b);
    blocks.push({ t: "bullets", items: (used.length ? used : points.slice(0, 8).map((p) => p.id)).map((i) => [{ text: cite(byId.get(i)!.doc, byId.get(i)!.line), bold: true }, " ", { text: `"${clip(byId.get(i)!.quote, 240)}"`, italic: true }] as Run[]) });
    blocks.push({ t: "h2", text: "Checks" });
    blocks.push({ t: "bullets", items: checks.map((c) => [`${c.status === "pass" ? "Passed" : c.status === "warn" ? "Needs a look" : "Failed"}: ${c.label}${c.detail ? ` (${c.detail})` : ""}`]) });

    const outputs = await writeDocPair(ctx, "Document draft", blocks, label);
    return {
      kind: "done",
      summary: `${label} ready to edit${placeholders.length ? `, with ${placeholders.length} thing${placeholders.length === 1 ? "" : "s"} for you to fill in` : ""}. Each part shows the lines of ${docs[0]!.name} it comes from.`,
      outputs,
      proposals: [],
      checks,
      report: {
        title: d.title,
        type,
        summary: d.summary,
        sections: sections.map((s) => ({ heading: s.heading, body: s.body, refs: [...new Set(s.pointIds.map((i) => cite(byId.get(i)!.doc, byId.get(i)!.line)))] })),
        missingInformation: d.missingInformation,
        placeholders,
        repeatsRemoved,
        droppedPoints: pts.dropped.length,
        llm: { calls: llm.stats.calls, retries: llm.stats.retries, failures: llm.stats.failures, ms: llm.stats.ms },
      },
    };
  },
};
