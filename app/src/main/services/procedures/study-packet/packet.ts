import { z } from "zod";
import type { Check } from "../../../../shared/contracts";
import { cite, type SourceDoc } from "../doc-common/extract";
import { DATA_RULES, fenceDocument, PLAIN_WRITING, type Llm } from "../doc-common/llm";
import { prepareChunks, type DocChunk } from "../doc-common/points";
import { verifyQuote } from "../doc-common/quote";
import { clip, findInjectionLines, looksLikeInjection, normalizeText, unsupportedNumbers } from "../doc-common/text";
import { answerSupported, groundedRatio, sourceStemSet, termInSource } from "./support";

export type Level = "Beginner" | "Intermediate";

export interface Cited {
  quote: string;
  file: string;
  line: number;
  cite: string;
}
export interface KeyIdea extends Cited {
  title: string;
  explanation: string;
}
export interface QA extends Cited {
  question: string;
  answer: string;
}
export interface Term extends Cited {
  term: string;
  definition: string;
}

export interface PacketReport {
  title: string;
  level: Level;
  sources: string[];
  keyIdeas: KeyIdea[];
  questions: QA[];
  glossary: Term[];
  requestedQuestions: number;
  dropped: { kind: "idea" | "question" | "term"; text: string; reason: string }[];
  ignoredInstructionLines: { cite: string }[];
  notes: string[];
}

const ChunkSchema = z.object({
  keyIdeas: z.array(z.object({ title: z.string().max(100), explanation: z.string().max(600), quote: z.string().max(500) })).max(4),
  questions: z.array(z.object({ question: z.string().max(300), answer: z.string().max(300), quote: z.string().max(500) })).max(8),
  glossary: z.array(z.object({ term: z.string().max(60), definition: z.string().max(300), quote: z.string().max(500) })).max(4),
});
const MoreSchema = z.object({
  questions: z.array(z.object({ question: z.string().max(300), answer: z.string().max(300), quote: z.string().max(500) })).max(8),
});

const levelHint: Record<Level, string> = {
  Beginner: "Write for someone new to the topic: short plain sentences, define words in everyday language, and ask recall questions (what, which, where, name).",
  Intermediate: "Write for someone who knows the basics: you may use the technical words from the text, and mix recall questions with 'why' and 'how' questions.",
};

export async function buildStudyPacket(
  llm: Llm,
  docs: SourceDoc[],
  opts: { level: Level; questionCount: number; onStep?: (label: string, detail?: string) => void },
): Promise<{ report: PacketReport; checks: Check[] }> {
  const step = opts.onStep ?? (() => undefined);
  // Small excerpts keep the 4B model on one topic at a time and spread questions across the whole reading.
  const { chunks, truncated } = prepareChunks(docs, 2800);
  const fullText = docs.map((d) => d.lines.join("\n")).join("\n");
  const stemsOfSource = sourceStemSet(fullText);
  const normSource = normalizeText(fullText);

  const dropped: PacketReport["dropped"] = [];
  const ideasByChunk: KeyIdea[][] = chunks.map(() => []);
  const qaByChunk: QA[][] = chunks.map(() => []);
  const termsByChunk: Term[][] = chunks.map(() => []);
  const seenQ = new Set<string>();
  const seenIdea = new Set<string>();
  const seenTerm = new Set<string>();
  let failed = 0;
  const notes: string[] = [];

  const perChunkQ = Math.min(8, Math.max(2, Math.ceil((opts.questionCount * 1.6) / Math.max(1, chunks.length))));

  const acceptQA = (i: number, doc: SourceDoc, q: { question: string; answer: string; quote: string }) => {
    if (looksLikeInjection(q.quote) || looksLikeInjection(q.question)) {
      dropped.push({ kind: "question", text: q.question, reason: "this reads like an order to an AI, so it was ignored" });
      return;
    }
    if (q.question.trim().split(/\s+/).length < 4) {
      dropped.push({ kind: "question", text: q.question, reason: "the question is too short to be useful" });
      return;
    }
    const m = verifyQuote(doc, q.quote);
    if (!m.found || m.startLine === undefined) {
      dropped.push({ kind: "question", text: q.question, reason: `the quote does not match the reading (${m.reason ?? "no match"})` });
      return;
    }
    const sup = answerSupported(q.answer, q.quote, q.question);
    if (!sup.ok) {
      dropped.push({ kind: "question", text: q.question, reason: `the answer is not supported by the quote: ${sup.reason}` });
      return;
    }
    const key = normalizeText(q.question);
    if (seenQ.has(key)) return;
    seenQ.add(key);
    qaByChunk[i]!.push({ question: q.question.trim(), answer: q.answer.trim(), quote: q.quote.trim(), file: doc.name, line: m.startLine, cite: cite(doc, m.startLine) });
  };

  for (const [i, { doc, chunk }] of chunks.entries()) {
    step("Reading the source", `part ${i + 1} of ${chunks.length}`);
    const res = await llm.json(
      ChunkSchema,
      [
        {
          role: "system",
          content: `You turn a reading into study material. ${levelHint[opts.level]} ${DATA_RULES} ${PLAIN_WRITING} Every item needs a "quote" copied exactly, word for word, from the text (one or two sentences, without the [number] marker).`,
        },
        {
          role: "user",
          content:
            `From this part of the reading write:\n- keyIdeas: 2 or 3 key ideas, each about a different part of the text. title = a few words. explanation = 1 to 3 sentences using only what the text says.\n` +
            `- questions: exactly ${perChunkQ} practice questions about different parts of the text (not several from one sentence) that the text answers directly. answer = a short answer taken from the text (use the text's own words). quote = the sentence that contains the answer.\n` +
            `- glossary: up to 3 important terms that the text itself explains. term = the word as written in the text. definition = the text's explanation.\n` +
            `Do not use outside knowledge.\n\n` +
            fenceDocument(doc.name, chunk.text),
        },
      ],
      `study ${doc.name} ${i + 1}/${chunks.length}`,
      { maxTokens: 2600 },
    );
    if (!res.ok) {
      failed += 1;
      notes.push(`Part ${i + 1} of ${doc.name} could not be read properly, so it may be missing from the packet.`);
      continue;
    }
    for (const idea of res.value.keyIdeas) {
      if (looksLikeInjection(idea.quote) || looksLikeInjection(idea.explanation)) {
        dropped.push({ kind: "idea", text: idea.title, reason: "this reads like an order to an AI, so it was ignored" });
        continue;
      }
      const m = verifyQuote(doc, idea.quote);
      if (!m.found || m.startLine === undefined) {
        dropped.push({ kind: "idea", text: idea.title, reason: `the quote does not match the reading (${m.reason ?? "no match"})` });
        continue;
      }
      const bad = unsupportedNumbers(idea.explanation, fullText);
      if (bad.length > 0) {
        dropped.push({ kind: "idea", text: idea.title, reason: `the explanation has numbers that are not in the source: ${bad.join(", ")}` });
        continue;
      }
      if (groundedRatio(idea.explanation, stemsOfSource) < 0.6) {
        dropped.push({ kind: "idea", text: idea.title, reason: "the explanation uses too many words that are not in the source" });
        continue;
      }
      const key = normalizeText(idea.quote);
      if (seenIdea.has(key)) continue;
      seenIdea.add(key);
      ideasByChunk[i]!.push({ title: idea.title.trim(), explanation: idea.explanation.trim(), quote: idea.quote.trim(), file: doc.name, line: m.startLine, cite: cite(doc, m.startLine) });
    }
    for (const q of res.value.questions) acceptQA(i, doc, q);
    for (const t of res.value.glossary) {
      const m = verifyQuote(doc, t.quote);
      if (!m.found || m.startLine === undefined) {
        dropped.push({ kind: "term", text: t.term, reason: `the quote does not match the reading (${m.reason ?? "no match"})` });
        continue;
      }
      if (!termInSource(t.term, normSource)) {
        dropped.push({ kind: "term", text: t.term, reason: "the term does not appear in the source" });
        continue;
      }
      if (unsupportedNumbers(t.definition, fullText).length > 0 || groundedRatio(t.definition, stemsOfSource) < 0.6) {
        dropped.push({ kind: "term", text: t.term, reason: "the meaning given is not based on the source" });
        continue;
      }
      const key = normalizeText(t.term);
      if (seenTerm.has(key)) continue;
      seenTerm.add(key);
      termsByChunk[i]!.push({ term: t.term.trim(), definition: t.definition.trim(), quote: t.quote.trim(), file: doc.name, line: m.startLine, cite: cite(doc, m.startLine) });
    }
  }

  const total = () => qaByChunk.reduce((n, a) => n + a.length, 0);
  if (total() < opts.questionCount && chunks.length > 0 && failed < chunks.length) {
    const missingNow = opts.questionCount - total();
    const per = Math.min(8, Math.max(2, Math.ceil((missingNow * 1.6) / chunks.length)));
    for (const [i, { doc, chunk }] of chunks.entries()) {
      if (total() >= opts.questionCount) break;
      step("Writing more questions", `part ${i + 1} of ${chunks.length}`);
      const have = qaByChunk[i]!.map((q) => q.question).slice(0, 12);
      const res = await llm.json(
        MoreSchema,
        [
          { role: "system", content: `You write practice questions from a reading. ${levelHint[opts.level]} ${DATA_RULES} ${PLAIN_WRITING}` },
          {
            role: "user",
            content:
              `Write ${per} more practice questions about DIFFERENT facts in this text. Do not repeat these questions: ${JSON.stringify(have)}.\n` +
              `Each has question, answer (short, in the text's own words) and quote (the exact sentence from the text that contains the answer, without the [number] marker).\n\n` +
              fenceDocument(doc.name, chunk.text),
          },
        ],
        `study more ${doc.name} ${i + 1}/${chunks.length}`,
        { maxTokens: 1600 },
      );
      if (res.ok) for (const q of res.value.questions) acceptQA(i, doc, q);
    }
  }

  const questions = pickSpread(qaByChunk, opts.questionCount);
  const keyIdeas = pickRoundRobin(ideasByChunk, 6);
  const glossary = pickRoundRobin(termsByChunk, 8);
  const byPos = <T extends Cited>(a: T, b: T) => a.file.localeCompare(b.file) || a.line - b.line;
  questions.sort(byPos);
  keyIdeas.sort(byPos);
  glossary.sort(byPos);

  const ignored: PacketReport["ignoredInstructionLines"] = [];
  for (const d of docs) for (const n of findInjectionLines(d.lines)) ignored.push({ cite: cite(d, n) });

  const checks: Check[] = [];
  const droppedQ = dropped.filter((d) => d.kind === "question");
  checks.push({
    id: "quotes-verified",
    label: "Every key idea, question and key word is backed by words from your reading",
    status: "pass",
    detail: dropped.length > 0 ? `${dropped.length} possible item${dropped.length === 1 ? " was" : "s were"} left out because the quote or answer did not match the reading.` : undefined,
  });
  checks.push({
    id: "questions-cited",
    label: "Every question has a quote from your reading and an answer the quote supports",
    status: questions.every((q) => q.quote && q.cite) ? "pass" : "fail",
    detail: droppedQ.length > 0 ? `${droppedQ.length} possible question${droppedQ.length === 1 ? "" : "s"} left out:${droppedQ.slice(0, 4).map((d) => `"${clip(d.text, 50)}" (${d.reason})`).join("; ")}${droppedQ.length > 4 ? "; ..." : ""}` : undefined,
  });
  if (questions.length >= opts.questionCount) {
    checks.push({ id: "question-count", label: `${questions.length} practice questions, as requested`, status: "pass" });
  } else {
    const why =
      failed > 0
        ? `${failed} part${failed === 1 ? "" : "s"} of the reading could not be read properly`
        : droppedQ.length > 0
          ? `${droppedQ.length} possible question${droppedQ.length === 1 ? "" : "s"} did not match the reading`
          : "no more questions could be found whose answers the reading states in its own words";
    checks.push({ id: "question-count", label: `Only ${questions.length} of ${opts.questionCount} requested questions matched your reading`, status: "warn", detail: `You got fewer than you asked for because ${why}. NONON gives you fewer questions rather than ones your reading does not support.` });
  }
  if (keyIdeas.length === 0) checks.push({ id: "key-ideas", label: "No key ideas matched your reading", status: "warn" });
  if (ignored.length > 0) {
    checks.push({ id: "instruction-text", label: "Some lines in the reading read like orders to an AI. NONON did not follow them and treated them as plain reading material", status: "warn", detail: ignored.map((i) => i.cite).join(", ") });
  }
  if (failed > 0) checks.push({ id: "coverage", label: `${failed} part${failed === 1 ? "" : "s"} of the reading could not be read properly`, status: "warn" });
  if (truncated) checks.push({ id: "length", label: "The reading was very long, so only the first part was read. Split it into smaller files to cover the rest", status: "warn" });

  const first = docs[0]!;
  const title = clip((first.lines.find((l) => l.trim() && !looksLikeInjection(l)) ?? first.name).replace(/^[#*_\s-]+|[*_\s]+$/g, ""), 100);
  return {
    report: { title, level: opts.level, sources: docs.map((d) => d.name), keyIdeas, questions, glossary, requestedQuestions: opts.questionCount, dropped, ignoredInstructionLines: ignored, notes },
    checks,
  };
}

/** At most two questions per source line while other lines have material, so the packet is not built from one paragraph. */
function pickSpread(groups: QA[][], max: number): QA[] {
  const perLine = new Map<string, number>();
  const picked = new Set<QA>();
  const out: QA[] = [];
  for (const cap of [2, Number.POSITIVE_INFINITY]) {
    for (let round = 0; out.length < max; round++) {
      let any = false;
      for (const g of groups) {
        const item = g[round];
        if (item === undefined) continue;
        any = true;
        if (picked.has(item) || out.length >= max) continue;
        const key = `${item.file}:${item.line}`;
        if ((perLine.get(key) ?? 0) >= cap) continue;
        perLine.set(key, (perLine.get(key) ?? 0) + 1);
        picked.add(item);
        out.push(item);
      }
      if (!any) break;
    }
  }
  return out;
}

/** Take items from each excerpt in turn so the packet covers the whole source, not just the first page. */
function pickRoundRobin<T>(groups: T[][], max: number): T[] {
  const out: T[] = [];
  for (let round = 0; out.length < max; round++) {
    let any = false;
    for (const g of groups) {
      const item = g[round];
      if (item !== undefined) {
        any = true;
        if (out.length < max) out.push(item);
      }
    }
    if (!any) break;
  }
  return out;
}

export type { DocChunk };
