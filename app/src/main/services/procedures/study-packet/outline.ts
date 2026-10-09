import { z } from "zod";
import type { Check, ProcedureOutcome, ProcedureRunContext, Question } from "../../../../shared/contracts";
import { h1, writeDocPair, type Block, type Run } from "../doc-common/docmodel";
import { extractMany, type SourceDoc } from "../doc-common/extract";
import { DATA_RULES, makeLlm, PLAIN_WRITING, type Llm } from "../doc-common/llm";
import { extractKeyPoints, type PointsResult, type VerifiedPoint } from "../doc-common/points";
import { clip, findInjectionLines, looksLikeInjection, unsupportedNumbers } from "../doc-common/text";
import { cite } from "../doc-common/extract";
import { groundedRatio, sourceStemSet } from "./support";

export const GRADE_OPTIONS = ["Grades 1-3", "Grades 4-6", "Grades 7-9", "Grades 10-12", "Adult learners"] as const;
const DEFAULT_GRADE = "Grades 7-9";
const DEFAULT_MINUTES = 45;

const SuggestSchema = z.object({
  gradeLevel: z.enum(GRADE_OPTIONS),
  objectives: z.array(z.string().max(160)).min(2).max(4),
});

const OutlineSchema = z.object({
  title: z.string().max(120),
  overview: z.string().max(500),
  sections: z
    .array(
      z.object({
        title: z.string().max(100),
        minutes: z.number().int().min(1).max(120),
        activity: z.string().max(500),
        teacherNotes: z.string().max(400),
        pointIds: z.array(z.number().int()).max(6),
      }),
    )
    .min(3)
    .max(7),
  assessment: z.string().max(400),
  materials: z.array(z.string().max(80)).max(8),
});

interface Provenance {
  value: string;
  how: "Your input" | "Your answer" | "Assumed";
}

function read(ctx: ProcedureRunContext, key: string): Provenance | undefined {
  const fromInput = ctx.text[key];
  if (fromInput !== undefined && fromInput.trim()) return { value: fromInput.trim(), how: "Your input" };
  const fromAnswer = ctx.answers[key];
  if (fromAnswer !== undefined) return fromAnswer.trim() ? { value: fromAnswer.trim(), how: "Your answer" } : { value: "", how: "Assumed" };
  return undefined;
}

type StoredPoint = { file: string; line: number; endLine: number; point: string; quote: string };

async function loadPoints(ctx: ProcedureRunContext, llm: Llm, docs: SourceDoc[]): Promise<PointsResult | null> {
  if (docs.length === 0) return null;
  const saved = ctx.checkpoint<{ points: StoredPoint[]; excerpts: number; failedExcerpts: number; truncated: boolean }>("points");
  if (saved) {
    const byName = new Map(docs.map((d) => [d.name, d]));
    const points: VerifiedPoint[] = [];
    for (const s of saved.points) {
      const doc = byName.get(s.file);
      if (doc) points.push({ id: points.length + 1, point: s.point, quote: s.quote, doc, line: s.line, endLine: s.endLine });
    }
    return { points, dropped: [], excerpts: saved.excerpts, failedExcerpts: saved.failedExcerpts, truncated: saved.truncated };
  }
  const res = await extractKeyPoints(llm, docs, {
    purpose: "Plan a lesson from this reading: the main ideas, facts and vocabulary a teacher would teach.",
    perExcerpt: 5,
    onExcerpt: (i, n) => ctx.step("Reading the source", `part ${i} of ${n}`),
  });
  ctx.saveCheckpoint("points", {
    points: res.points.map((p) => ({ file: p.doc.name, line: p.line, endLine: p.endLine, point: p.point, quote: p.quote })),
    excerpts: res.excerpts,
    failedExcerpts: res.failedExcerpts,
    truncated: res.truncated,
  });
  return res;
}

export async function runLessonOutline(ctx: ProcedureRunContext): Promise<ProcedureOutcome> {
  const paths = ctx.files.source ?? [];
  const { docs, failures } = await extractMany(paths);
  const topicP = read(ctx, "topic");
  const topic = topicP?.value ?? "";

  if (docs.length === 0 && !topic) {
    if (failures[0] && paths.length > 0) return { kind: "unsupported", reason: failures[0].reason, suggestion: "Use a .txt, .md, .docx or PDF file that has real text, or type the topic instead." };
    if (ctx.answers.topic === undefined) {
      return {
        kind: "needs-input",
        reason: "I need something to plan the lesson around: a reading, or a topic.",
        questions: [{ id: "topic", prompt: "What is the lesson about? (Or choose a reading file and start again.)", kind: "text" }],
      };
    }
    return { kind: "unsupported", reason: "There is no reading and no topic to plan a lesson around.", suggestion: "Choose a reading file or type a topic." };
  }

  const grade = read(ctx, "gradeLevel");
  const duration = read(ctx, "duration");
  const objectives = read(ctx, "objectives");
  const llm = makeLlm(ctx.ai, ctx.signal);
  const pointsRes = await loadPoints(ctx, llm, docs);

  if (!grade || !duration || !objectives) {
    let suggestedGrade: string = DEFAULT_GRADE;
    let suggestedObjectives = "";
    if (pointsRes && pointsRes.points.length > 0) {
      ctx.step("Suggesting answers", "who the lesson is for and what students should learn");
      const stems = sourceStemSet(docs.map((d) => d.lines.join(" ")).join(" "));
      const res = await llm.json(
        SuggestSchema,
        [
          { role: "system", content: `You help a teacher plan a lesson. ${DATA_RULES} ${PLAIN_WRITING}` },
          {
            role: "user",
            content: `These are the main points of a reading:\n${pointsRes.points.slice(0, 20).map((p) => `- ${p.point}`).join("\n")}\n\nSuggest the most suitable gradeLevel, and 3 short learning objectives that start with a verb such as "Explain", "Name" or "Describe" and use only ideas from these points.`,
          },
        ],
        "suggest grade and objectives",
        { maxTokens: 500 },
      );
      if (res.ok) {
        suggestedGrade = res.value.gradeLevel;
        const ok = res.value.objectives.filter((o) => !looksLikeInjection(o) && groundedRatio(o, stems) >= 0.6);
        suggestedObjectives = ok.join("; ");
      }
    }
    const questions: Question[] = [];
    if (!grade) {
      questions.push({
        id: "gradeLevel",
        prompt: "Who is the lesson for?",
        kind: "choice",
        options: GRADE_OPTIONS.map((g) => ({ value: g, label: g })),
        suggested: suggestedGrade,
      });
    }
    if (!duration) questions.push({ id: "duration", prompt: "How many minutes is the lesson?", kind: "text", suggested: String(DEFAULT_MINUTES) });
    if (!objectives) {
      questions.push({
        id: "objectives",
        prompt: "What should students be able to do at the end? (Separate goals with a semicolon.)",
        kind: "text",
        ...(suggestedObjectives ? { suggested: suggestedObjectives } : {}),
      });
    }
    return { kind: "needs-input", questions, reason: "To fit the lesson to your class I need a few details. I have filled in suggestions you can accept with one click." };
  }

  return buildOutline(ctx, llm, docs, pointsRes, { topic, grade, duration, objectives });
}

async function buildOutline(
  ctx: ProcedureRunContext,
  llm: Llm,
  docs: SourceDoc[],
  pointsRes: PointsResult | null,
  a: { topic: string; grade: Provenance; duration: Provenance; objectives: Provenance },
): Promise<ProcedureOutcome> {
  const gradeValue = a.grade.value || DEFAULT_GRADE;
  const parsedMinutes = Number.parseInt(a.duration.value, 10);
  const minutes = Number.isFinite(parsedMinutes) ? Math.min(240, Math.max(10, parsedMinutes)) : DEFAULT_MINUTES;
  const durationAssumed = !(Number.isFinite(parsedMinutes) && a.duration.value);
  const objectiveList = a.objectives.value
    .split(/\s*[;\n]\s*/)
    .map((s) => s.trim())
    .filter((s) => s && !looksLikeInjection(s))
    .slice(0, 6);

  const points = (pointsRes?.points ?? []).slice(0, 40);
  const hasSource = docs.length > 0;
  if (hasSource && points.length === 0) {
    return { kind: "unsupported", reason: "I could not find enough in that reading to plan a lesson. It may be too short, or it may have no real text.", suggestion: "Try a longer file that has real text, or type a topic instead." };
  }

  ctx.step("Planning the lesson");
  const prompt =
    `Plan a lesson.\n- Audience: ${gradeValue}\n- Length: ${minutes} minutes\n` +
    `- Objectives: ${objectiveList.length ? objectiveList.join("; ") : "(none given; write 2 or 3 from the points)"}\n` +
    (a.topic ? `- Topic: ${a.topic}\n` : "") +
    (hasSource
      ? `\nUse ONLY these points from the teacher's reading. Refer to them by id in pointIds.\n${points.map((p) => `[${p.id}] ${p.point}`).join("\n")}\n`
      : "\nThere is no reading. Use only well-known basic facts about the topic and keep the plan general.\n") +
    `\nGive: title, a one or two sentence overview, 4 to 6 sections each with a title, minutes (whole numbers adding up to ${minutes}), an activity students do, short teacherNotes, and pointIds; then an assessment idea and a short list of materials. Do not invent statistics, dates or quotations.`;
  const res = await llm.json(
    OutlineSchema,
    [
      { role: "system", content: `You are an experienced teacher who writes clear, practical lesson outlines. ${DATA_RULES} ${PLAIN_WRITING}` },
      { role: "user", content: prompt },
    ],
    "lesson outline",
    { maxTokens: 2400, temperature: 0.3 },
  );
  if (!res.ok) {
    return { kind: "unsupported", reason: "I could not put together a good lesson outline this time.", suggestion: "Try again, or choose a shorter reading." };
  }

  const o = res.value;
  const validIds = new Set(points.map((p) => p.id));
  const byId = new Map(points.map((p) => [p.id, p] as const));
  const sections = o.sections.map((s) => ({ ...s, pointIds: [...new Set(s.pointIds.filter((id) => validIds.has(id)))] }));

  const raw = sections.reduce((n, s) => n + s.minutes, 0);
  const minutesFixed = balanceMinutes(sections.map((s) => s.minutes), minutes);
  sections.forEach((s, i) => (s.minutes = minutesFixed[i]!));

  const allowedText = [docs.map((d) => d.lines.join("\n")).join("\n"), a.topic, a.objectives.value, String(minutes), gradeValue];
  const proseOut = [o.title, o.overview, o.assessment, ...o.materials, ...sections.flatMap((s) => [s.title, s.activity, s.teacherNotes])].join(" ");
  const badNums = unsupportedNumbers(proseOut, ...allowedText);
  const unlinked = hasSource ? sections.filter((s) => s.pointIds.length === 0) : [];

  const checks: Check[] = [];
  checks.push({
    id: "assumptions",
    label: "Who the lesson is for, its length and its goals are listed so you can change them",
    status: "pass",
    detail: [a.grade.how === "Assumed" ? `Audience assumed: ${gradeValue}.` : "", durationAssumed ? `Length assumed: ${minutes} minutes.` : "", !objectiveList.length ? "No goals were given, so the plan suggests its own." : ""].filter(Boolean).join(" ") || undefined,
  });
  const drift = Math.abs(raw - minutes);
  checks.push({
    id: "time-total",
    label: `Section times add up to ${minutes} minutes`,
    status: drift / minutes > 0.15 ? "warn" : "pass",
    detail: drift === 0 ? undefined : `The AI's section times added up to ${raw}. NONON adjusted them to ${minutes}.`,
  });
  if (hasSource) {
    checks.push(
      unlinked.length === 0
        ? { id: "source-links", label: "Every section points to lines in your reading", status: "pass" }
        : { id: "source-links", label: `${unlinked.length} section${unlinked.length === 1 ? " has" : "s have"} no link to your reading`, status: "warn", detail: unlinked.map((s) => s.title).join("; ") },
    );
  } else {
    checks.push({ id: "no-source", label: "No reading was given, so the content comes from general knowledge. Check the facts before teaching", status: "warn" });
  }
  checks.push(
    badNums.length === 0
      ? { id: "no-new-figures", label: "No dates or numbers that are missing from your material", status: "pass" }
      : { id: "no-new-figures", label: "The outline has numbers or dates that are not in your material", status: "warn", detail: `Check: ${badNums.join(", ")}` },
  );
  const injected = docs.flatMap((d) => findInjectionLines(d.lines).map((n) => cite(d, n)));
  if (injected.length > 0) checks.push({ id: "instruction-text", label: "Some lines in the reading read like orders to an AI. NONON did not follow them", status: "warn", detail: injected.join(", ") });
  if (pointsRes && pointsRes.failedExcerpts > 0) checks.push({ id: "coverage", label: `${pointsRes.failedExcerpts} part${pointsRes.failedExcerpts === 1 ? "" : "s"} of the reading could not be read properly`, status: "warn" });
  if (pointsRes?.truncated) checks.push({ id: "length", label: "The reading was very long, so only the first part was used. Split it into smaller files to cover the rest", status: "warn" });

  const blocks = outlineBlocks({ o, sections, byId, gradeValue, minutes, a, objectiveList, durationAssumed, docs, checks });
  const outputs = await writeDocPair(ctx, "Lesson outline", blocks, "Lesson outline");
  return {
    kind: "done",
    summary: `Lesson outline for ${gradeValue}, ${minutes} minutes, ${sections.length} sections. Your choices and assumptions are listed at the top so you can change them.`,
    outputs,
    proposals: [],
    checks,
    report: {
      title: o.title,
      gradeLevel: gradeValue,
      minutes,
      objectives: objectiveList,
      sections: sections.map((s) => ({ title: s.title, minutes: s.minutes, refs: s.pointIds.map((id) => ({ cite: cite(byId.get(id)!.doc, byId.get(id)!.line) })) })),
      llm: { calls: llm.stats.calls, retries: llm.stats.retries, failures: llm.stats.failures, ms: llm.stats.ms },
    },
  };
}

/** Rescale to the lesson length with whole minutes; the largest section absorbs rounding. */
export function balanceMinutes(values: number[], target: number): number[] {
  const sum = values.reduce((n, v) => n + v, 0);
  if (sum === target || values.length === 0) return [...values];
  const scaled = values.map((v) => Math.max(1, Math.round((v / sum) * target)));
  const diff = target - scaled.reduce((n, v) => n + v, 0);
  let big = 0;
  scaled.forEach((v, i) => {
    if (v > (scaled[big] ?? 0)) big = i;
  });
  scaled[big] = Math.max(1, (scaled[big] ?? 1) + diff);
  return scaled;
}

function outlineBlocks(x: {
  o: z.infer<typeof OutlineSchema>;
  sections: (z.infer<typeof OutlineSchema>["sections"][number])[];
  byId: Map<number, VerifiedPoint>;
  gradeValue: string;
  minutes: number;
  a: { topic: string; grade: Provenance; duration: Provenance; objectives: Provenance };
  objectiveList: string[];
  durationAssumed: boolean;
  docs: SourceDoc[];
  checks: Check[];
}): Block[] {
  const b: Block[] = [{ t: "title", text: `Lesson outline: ${x.o.title}` }];
  b.push(h1("Assumptions"));
  b.push({ t: "p", runs: [{ text: "Change anything here that is not right and ask for the outline again.", italic: true }] });
  b.push({
    t: "table",
    header: ["Detail", "Value", "Where it came from"],
    rows: [
      [["Audience"], [x.gradeValue], [x.a.grade.how === "Assumed" ? "Assumed (no answer given)" : x.a.grade.how]],
      [["Length"], [`${x.minutes} minutes`], [x.durationAssumed ? "Assumed (no answer given)" : x.a.duration.how]],
      [["Objectives"], [x.objectiveList.length ? x.objectiveList.join("; ") : "None given, so the plan suggests some"], [x.objectiveList.length ? x.a.objectives.how : "Assumed (no answer given)"]],
      [["Source"], [x.docs.length ? x.docs.map((d) => d.name).join(", ") : "None"], [x.docs.length ? "Your files" : x.a.topic ? `Topic: ${x.a.topic}` : "-"]],
    ],
  });
  b.push(h1("Overview"));
  b.push({ t: "p", runs: [x.o.overview] });
  b.push(h1("Plan"));
  let start = 0;
  const rows: Run[][][] = x.sections.map((s) => {
    const row: Run[][] = [
      [`${start}-${start + s.minutes} min`],
      [{ text: s.title, bold: true }],
      [s.activity],
      [s.teacherNotes],
      s.pointIds.length
        ? s.pointIds.map((id, i) => `${i ? "; " : ""}${cite(x.byId.get(id)!.doc, x.byId.get(id)!.line)}`)
        : [x.docs.length ? { text: "No source line", italic: true } : "-"],
    ];
    start += s.minutes;
    return row;
  });
  b.push({ t: "table", header: ["Time", "Section", "What happens", "Teacher notes", "Source"], rows });
  b.push(h1("Check for understanding"));
  b.push({ t: "p", runs: [x.o.assessment] });
  if (x.o.materials.length > 0) {
    b.push(h1("Materials"));
    b.push({ t: "bullets", items: x.o.materials.map((m) => [m]) });
  }
  const used = [...new Set(x.sections.flatMap((s) => s.pointIds))].sort((p, q) => p - q);
  if (used.length > 0) {
    b.push(h1("Source lines used"));
    b.push({ t: "bullets", items: used.map((id) => [{ text: cite(x.byId.get(id)!.doc, x.byId.get(id)!.line), bold: true }, " ", { text: `"${clip(x.byId.get(id)!.quote, 220)}"`, italic: true }]) });
  }
  b.push({ t: "h2", text: "Checks" });
  b.push({ t: "bullets", items: x.checks.map((c) => [`${c.status === "pass" ? "Passed" : c.status === "warn" ? "Needs a look" : "Failed"}: ${c.label}${c.detail ? ` (${c.detail})` : ""}`]) });
  return b;
}
