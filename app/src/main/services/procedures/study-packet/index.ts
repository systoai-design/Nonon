import type { ProcedureDef, ProcedureOutcome } from "../../../../shared/contracts";
import { writeDocPair } from "../doc-common/docmodel";
import { extractMany } from "../doc-common/extract";
import { makeLlm } from "../doc-common/llm";
import { GRADE_OPTIONS, runLessonOutline } from "./outline";
import { buildStudyPacket, type Level } from "./packet";
import { packetBlocks } from "./render";

export const studyPacket: ProcedureDef = {
  id: "study-packet",
  pack: "education",
  title: "Study packet",
  summary: "Get key ideas, practice questions with an answer key, and a short list of key words from a reading.",
  supports:
    "Give it one or more .txt, .md, .docx or PDF files. You get key ideas, practice questions, an answer key and key words with their meanings. Each one shows the words and line from your reading that back it up. It is saved as a Word file and a plain text copy.",
  limits: [
    "Scanned or photographed PDFs, pictures and slides are not read. Use a file that has real text.",
    "Questions whose answers do not match your reading are left out. You may get fewer than you asked for, and NONON tells you.",
    "NONON checks that each answer's words are in the quoted sentence. It cannot tell if a question is well written, so read it before you hand it out.",
    "Very long readings are read in parts, up to about 40. If yours is longer, split it into smaller files.",
  ],
  inputs: [
    { key: "source", label: "Reading or notes", kind: "files", accept: [".txt", ".md", ".docx", ".pdf"], help: "One or more files." },
    {
      key: "level",
      label: "Level",
      kind: "choice",
      optional: true,
      options: [
        { value: "Beginner", label: "Beginner" },
        { value: "Intermediate", label: "Intermediate" },
      ],
      help: "Beginner uses simpler words. Default: Beginner.",
    },
    { key: "questionCount", label: "Number of practice questions", kind: "number", optional: true, help: "Default 8, up to 20." },
  ],
  revision: "1",
  async run(ctx): Promise<ProcedureOutcome> {
    const paths = ctx.files.source ?? [];
    if (paths.length === 0) return { kind: "unsupported", reason: "There is no reading to make a study packet from.", suggestion: "Choose one or more .txt, .md, .docx or PDF files." };
    ctx.step("Opening the reading");
    const { docs, failures } = await extractMany(paths);
    if (docs.length === 0) return { kind: "unsupported", reason: failures[0]?.reason ?? "The reading could not be opened.", suggestion: "Save it as a .txt, .docx or PDF that has real text, then try again. Nothing was changed." };

    const levelRaw = (ctx.text.level ?? ctx.answers.level ?? "Beginner").trim();
    const level: Level = /^intermediate$/i.test(levelRaw) ? "Intermediate" : "Beginner";
    const n = Number.parseInt(ctx.text.questionCount ?? ctx.answers.questionCount ?? "", 10);
    const questionCount = Number.isFinite(n) ? Math.min(20, Math.max(1, n)) : 8;

    const llm = makeLlm(ctx.ai, ctx.signal);
    const { report, checks } = await buildStudyPacket(llm, docs, { level, questionCount, onStep: (l, d) => ctx.step(l, d) });
    for (const f of failures) checks.push({ id: `unreadable-${f.path}`, label: `One file was skipped: ${f.reason}`, status: "warn" });

    ctx.step("Writing the study packet");
    const outputs = await writeDocPair(ctx, "Study packet", packetBlocks(report, checks), "Study packet");
    const empty = report.questions.length + report.keyIdeas.length === 0;
    return {
      kind: "done",
      summary: empty
        ? "I read the file but could not match any key ideas or questions to the reading's own words, so I left them out rather than guess."
        : `Study packet with ${report.keyIdeas.length} key idea${report.keyIdeas.length === 1 ? "" : "s"}, ${report.questions.length} practice question${report.questions.length === 1 ? "" : "s"} with an answer key, and ${report.glossary.length} key word${report.glossary.length === 1 ? "" : "s"}.${report.questions.length < questionCount ? ` You asked for ${questionCount}. The rest did not match the reading, so they were left out.` : ""} Each answer shows the line it came from.`,
      outputs,
      proposals: [],
      checks,
      report: { ...report, llm: { calls: llm.stats.calls, retries: llm.stats.retries, failures: llm.stats.failures, ms: llm.stats.ms } },
    };
  },
};

export const lessonOutline: ProcedureDef = {
  id: "lesson-outline",
  pack: "education",
  title: "Lesson outline",
  summary: "Get a timed lesson plan from a reading or a topic, with your choices listed so you can change them.",
  supports:
    "Give it a .txt, .md, .docx or PDF reading, or just type a topic. NONON asks who the lesson is for, how long it is and what students should learn, and suggests answers. You get a timed plan with activities, teacher notes, a quick check for understanding and the source lines. It is saved as a Word file and a plain text copy.",
  limits: [
    "With only a topic and no reading, the plan comes from what the AI already knows. It is marked so you can check the facts.",
    "Scanned or photographed PDFs are not read. Use a file that has real text.",
    "It plans one lesson, not a whole unit. It does not make slides or worksheets.",
    "NONON adjusts the section times so they always add up to your lesson length.",
  ],
  inputs: [
    { key: "source", label: "Reading", kind: "files", accept: [".txt", ".md", ".docx", ".pdf"], optional: true, help: "Optional if you type a topic." },
    { key: "topic", label: "Topic", kind: "text", optional: true },
    { key: "gradeLevel", label: "Audience", kind: "choice", optional: true, options: GRADE_OPTIONS.map((g) => ({ value: g, label: g })) },
    { key: "duration", label: "Lesson length in minutes", kind: "number", optional: true },
    { key: "objectives", label: "What students should learn (separate goals with a semicolon)", kind: "text", optional: true },
  ],
  revision: "1",
  run: (ctx) => runLessonOutline(ctx),
};

export const procedures: ProcedureDef[] = [studyPacket, lessonOutline];
