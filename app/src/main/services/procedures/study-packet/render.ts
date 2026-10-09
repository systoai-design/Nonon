import type { Check } from "../../../../shared/contracts";
import { h1, type Block, type Run } from "../doc-common/docmodel";
import type { PacketReport } from "./packet";

const src = (c: { cite: string; quote: string }): Run[] => [{ text: c.cite, bold: true }, " ", { text: `"${c.quote}"`, italic: true }];

export function packetBlocks(r: PacketReport, checks: Check[]): Block[] {
  const b: Block[] = [{ t: "title", text: `Study packet: ${r.title}` }];
  b.push({ t: "p", runs: [`Level: ${r.level}. Source: ${r.sources.join(", ")}.`] });
  b.push({ t: "note", runs: ["Every key idea, question and answer below is backed by words from your reading. Those words are shown beside it with the file and line. Anything your reading did not support was left out. This is a draft you can edit."] });

  b.push(h1("Key ideas"));
  if (r.keyIdeas.length === 0) b.push({ t: "p", runs: ["No key ideas matched your reading."] });
  for (const k of r.keyIdeas) {
    b.push({ t: "p", runs: [{ text: k.title, bold: true }, ": ", k.explanation] });
    b.push({ t: "quote", runs: src(k) });
  }

  b.push(h1("Practice questions"));
  if (r.questions.length === 0) b.push({ t: "p", runs: ["No questions matched your reading."] });
  else b.push({ t: "numbered", items: r.questions.map((q) => [q.question]) });
  if (r.questions.length < r.requestedQuestions) {
    b.push({ t: "note", runs: [`Only ${r.questions.length} of ${r.requestedQuestions} requested questions matched your reading.`] });
  }

  b.push(h1("Answer key"));
  b.push({
    t: "numbered",
    items: r.questions.map((q) => [{ text: q.answer, bold: true }, " - ", ...src(q)]),
  });

  b.push(h1("Key words"));
  if (r.glossary.length === 0) b.push({ t: "p", runs: ["No key words matched your reading."] });
  else b.push({ t: "table", header: ["Word", "Meaning", "Source"], rows: r.glossary.map((t) => [[{ text: t.term, bold: true }], [t.definition], src(t)]) });

  b.push({ t: "h2", text: "Checks" });
  b.push({ t: "bullets", items: checks.map((c) => [`${c.status === "pass" ? "Passed" : c.status === "warn" ? "Needs a look" : "Failed"}: ${c.label}${c.detail ? ` (${c.detail})` : ""}`]) });
  return b;
}
