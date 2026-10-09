import type { Check, ProcedureDef, ProcedureOutcome, ProcedureRunContext, Question, RoleName } from "../../../../shared/contracts";
import type { ArtifactRecord } from "../../providers/stages";
import { runStages } from "../../providers/stages";
import { writeDocPair } from "../doc-common/docmodel";
import { docFromText, extractDocument, type SourceDoc } from "../doc-common/extract";
import { findInjectionLines } from "../doc-common/text";
import { analyzeDraft } from "./analyze";
import { teamDraftHost } from "./host";
import { providerLabel, providerName, STAGE_LABEL, teamStageDeps, type StageTrace } from "./pipeline";
import { stageTasks } from "./prompts";
import { draftBlocks, specAndReviewDoc, type ProvenanceRow } from "./render";
import type { Draft, Review, Spec } from "./schemas";
import { MAX_SOURCE_CHARS, prepareSource } from "./source";
import { parseArtifact } from "./validate";

export { bindTeamDraftHost } from "./host";

const STAGES: RoleName[] = ["design", "implement", "review"];

interface PauseNote {
  id: string;
  stage: RoleName;
  provider: string;
}

async function loadSource(ctx: ProcedureRunContext): Promise<{ doc: SourceDoc } | { outcome: ProcedureOutcome }> {
  const path = ctx.files.source?.[0];
  if (path) {
    ctx.step("Opening the source");
    const r = await extractDocument(path);
    if (!r.ok) {
      return { outcome: { kind: "unsupported", reason: r.reason, suggestion: "Save the source as a .txt, .md or .docx file, or paste the text into the box." } };
    }
    return { doc: r.doc };
  }
  const pasted = (ctx.text.pastedSource ?? "").trim();
  if (pasted) return { doc: docFromText("Pasted source.txt", pasted) };
  return { outcome: { kind: "unsupported", reason: "There is no source to draft from yet.", suggestion: "Choose a .txt, .md or .docx file, or paste the text into the box." } };
}

function pausedOutcome(ctx: ProcedureRunContext, p: { stage: RoleName; provider: string; message: string }): ProcedureOutcome {
  const cloud = p.provider !== "local" && p.provider !== "none";
  const reason = `The ${STAGE_LABEL[p.stage]} step is paused. ${p.message}`;
  if (!cloud) {
    return { kind: "unsupported", reason, suggestion: "Nothing was made up. Choose Continue to try again, or use a shorter source." };
  }
  const id = `switch-${p.stage}-${Date.now().toString(36)}`;
  ctx.saveCheckpoint("pause", { id, stage: p.stage, provider: p.provider } satisfies PauseNote);
  const question: Question = {
    id,
    prompt: `${reason} Nothing was passed to another AI. Do the ${STAGE_LABEL[p.stage]} step on this computer instead?`,
    kind: "choice",
    options: [
      { value: "local", label: `Yes, do the ${STAGE_LABEL[p.stage]} step on this computer` },
      { value: "wait", label: "No, I will try again later" },
    ],
    suggested: "local",
  };
  return { kind: "needs-input", reason, questions: [question] };
}

async function run(ctx: ProcedureRunContext): Promise<ProcedureOutcome> {
  const host = teamDraftHost();
  if (!host) return { kind: "unsupported", reason: "The AI team is not available in this version of NONON." };

  const goal = (ctx.text.goal ?? "").trim();
  if (!goal) {
    return {
      kind: "needs-input",
      reason: "Tell me what the document is for.",
      questions: [{ id: "goal", prompt: "What should the document do? For example: a one page summary for new customers.", kind: "text" }],
    };
  }

  const loaded = await loadSource(ctx);
  if ("outcome" in loaded) return loaded.outcome;
  const src = prepareSource(loaded.doc);
  if (src.chars > MAX_SOURCE_CHARS) {
    return {
      kind: "unsupported",
      reason: `${loaded.doc.name} is longer than the AI team reads in one go (about ${Math.round(MAX_SOURCE_CHARS / 6)} words).`,
      suggestion: "Use a shorter file, or paste only the part you want drafted from.",
    };
  }

  const wsId = ctx.workspace.id;
  const pause = ctx.checkpoint<PauseNote>("pause");
  if (pause) {
    ctx.saveCheckpoint("pause", undefined);
    const answer = ctx.answers[pause.id];
    if (answer === "wait") {
      return { kind: "unsupported", reason: `The ${STAGE_LABEL[pause.stage]} step is still paused. ${providerName(pause.provider as never)} was not used again and nothing was sent anywhere.`, suggestion: "Choose Continue when you want to try again." };
    }
    if (answer === "local") {
      host.setRole(wsId, pause.stage, "local");
      ctx.step(`${STAGE_LABEL[pause.stage]}: now on This computer`, "You chose this after the online AI stopped");
    }
  }

  const trace: StageTrace[] = [];
  const deps = teamStageDeps(host, { workspaceName: ctx.workspace.name, source: src, trace });
  const roles = deps.roles(wsId).roles as Record<RoleName, "claude" | "codex" | "antigravity" | "local">;

  const cloudStages = STAGES.filter((s) => roles[s] !== "local");
  const policy = host.policy(wsId) ?? ctx.workspace.policy;
  if (cloudStages.length > 0 && policy !== "cloud-allowed") {
    const list = cloudStages.map((s) => `${STAGE_LABEL[s]} (${providerLabel(roles[s])})`).join(", ");
    return {
      kind: "unsupported",
      reason: `"${ctx.workspace.name}" keeps everything on this computer, but ${list} is set to use an online AI. Nothing was sent anywhere.`,
      suggestion: "Choose This computer for those steps in the project settings, or allow online AI for this project.",
    };
  }

  ctx.step("Your AI team", STAGES.map((s) => `${STAGE_LABEL[s]}: ${providerLabel(roles[s])}`).join(". "));

  const tasks = stageTasks(goal, src);
  const result = await runStages(deps, wsId, {
    task: tasks.design,
    taskFor: tasks,
    stages: STAGES,
    needs: { design: [], implement: ["design"], review: ["design", "implement"] },
    signal: ctx.signal,
    onStage: ({ stage, provider, state }) => {
      const detail = state === "started" ? "Working on it" : state === "done" ? "Done" : "Reused. Nothing this step reads has changed.";
      ctx.step(`${STAGE_LABEL[stage]}: ${providerLabel(provider)}`, detail);
    },
  });

  if (result.outcome === "paused" && result.paused) return pausedOutcome(ctx, result.paused);

  const rec = (s: RoleName): ArtifactRecord | undefined => result.current[s];
  const specRec = rec("design");
  const draftRec = rec("implement");
  const reviewRec = rec("review");
  const spec = specRec ? parseArtifact<Spec>("design", specRec.text, src) : null;
  const draft = draftRec ? parseArtifact<Draft>("implement", draftRec.text, src) : null;
  const review = reviewRec ? parseArtifact<Review>("review", reviewRec.text, src) : null;
  if (!specRec || !draftRec || !reviewRec || !spec || !draft || !review) {
    return {
      kind: "unsupported",
      reason: "NONON could not read the result of one of the steps, so no document was written.",
      suggestion: "Change the goal a little, or edit the source, and run it again.",
    };
  }

  ctx.step("Writing the document");
  const rows: ProvenanceRow[] = STAGES.map((stage) => ({ stage, record: result.current[stage] as ArtifactRecord, status: result.ran.includes(stage) ? "made now" : "reused" }));
  const flagged = analyzeDraft(draft, review, src, goal);
  const outputs = await writeDocPair(ctx, "Team draft", draftBlocks(draft, flagged, review, rows), "Team draft");
  outputs.push(
    await ctx.writeOutput(
      "Team draft - spec and review.md",
      specAndReviewDoc({ goal, sourceName: src.doc.name, spec, draft, review, flagged, rows }),
      "md",
      "Plan, draft and review with who made each step",
    ),
  );

  const checks = buildChecks({ rows, flagged, trace, src, review });
  const problems = review.findings.length;
  const who = rows.map((r) => `${STAGE_LABEL[r.stage]} on ${providerLabel(r.record.provider)}`).join(", ");
  const marked = flagged.highlighted;
  const summary =
    `Drafted "${draft.title}" with your AI team: ${who}. ` +
    (problems === 0 ? "The reviewer listed no problems. " : `The reviewer listed ${problems} problem${problems === 1 ? "" : "s"}. `) +
    (marked > 0 ? `${marked} sentence${marked === 1 ? " is" : "s are"} highlighted for you to check against the source. ` : "") +
    (result.reused.length > 0 ? `${result.reused.length} step${result.reused.length === 1 ? " was" : "s were"} reused because nothing it reads changed.` : "");

  return {
    kind: "done",
    summary: summary.trim(),
    outputs,
    proposals: [],
    checks,
    report: {
      goal,
      source: { name: src.doc.name, lines: src.lineCount },
      verdict: review.verdict,
      stages: rows.map((r) => {
        const t = trace.find((x) => x.stage === r.stage);
        return {
          stage: r.stage,
          label: STAGE_LABEL[r.stage],
          provider: r.record.provider,
          providerLabel: providerLabel(r.record.provider),
          revision: r.record.revision,
          createdAt: r.record.createdAt,
          inputRevision: r.record.inputRevision,
          status: r.status,
          ...(t ? { attempts: t.attempts, ms: t.ms, dropped: t.dropped, ...(t.model ? { model: t.model } : {}) } : {}),
        };
      }),
      findings: flagged.findings.map((v) => ({ n: v.n, kind: v.finding.kind, issue: v.finding.issue, cited: v.cited, quote: v.quote, marked: v.marked })),
      numbersNotInSource: flagged.numbersNotInSource,
      spec,
      draft,
      review,
    },
  };
}

function buildChecks(o: { rows: ProvenanceRow[]; flagged: ReturnType<typeof analyzeDraft>; trace: StageTrace[]; src: ReturnType<typeof prepareSource>; review: Review }): Check[] {
  const checks: Check[] = [];

  const unrecorded = o.rows.filter((r) => !r.record.provider || !/^[0-9a-f]{64}$/.test(r.record.inputRevision) || Number.isNaN(Date.parse(r.record.createdAt)));
  checks.push(
    unrecorded.length === 0
      ? { id: "stages-recorded", label: "Each step recorded who made it", status: "pass", detail: o.rows.map((r) => `${STAGE_LABEL[r.stage]}: ${providerLabel(r.record.provider)}`).join(". ") }
      : { id: "stages-recorded", label: "Each step recorded who made it", status: "fail", detail: `Missing for: ${unrecorded.map((r) => STAGE_LABEL[r.stage]).join(", ")}.` },
  );

  const cited = o.flagged.findings.flatMap((v) => v.finding.sourceLines);
  const missingLines = cited.filter((n) => !o.src.valid.has(n));
  const dropped = o.trace.flatMap((t) => t.dropped.map((d) => `${STAGE_LABEL[t.stage]}: ${d}`));
  checks.push(
    missingLines.length > 0
      ? { id: "source-lines", label: "Lines the reviewer pointed to exist", status: "fail", detail: `Lines ${missingLines.join(", ")} are not in the source.` }
      : dropped.length > 0
        ? { id: "source-lines", label: "Lines the reviewer pointed to exist", status: "warn", detail: `Every line shown exists. NONON removed references to lines that do not: ${dropped.join("; ")}.` }
        : { id: "source-lines", label: "Lines the reviewer pointed to exist", status: "pass", detail: cited.length === 0 ? "The reviewer cited no lines." : `${cited.length} line reference${cited.length === 1 ? "" : "s"} checked in the source.` },
  );

  const quotes = o.flagged.findings.filter((v) => v.quote !== "none");
  const badQuotes = quotes.filter((v) => v.quote === "not-found");
  if (quotes.length > 0) {
    checks.push({
      id: "quotes-verified",
      label: "Quotes the reviewer gave are really in the source",
      status: badQuotes.length === 0 ? "pass" : "warn",
      detail: badQuotes.length === 0 ? `${quotes.length} quoted passage${quotes.length === 1 ? "" : "s"} found in the source.` : `${badQuotes.length} of ${quotes.length} quotes were not found in the source and are marked as such.`,
    });
  }

  const claims = o.flagged.findings.filter((v) => v.finding.kind === "unsupported-claim");
  const unlocated = claims.filter((v) => v.marked === "not-located");
  const overruled = claims.filter((v) => v.marked === "grounded");
  const shown = claims.length - unlocated.length - overruled.length;
  const claimDetail = [
    claims.length === 0 ? "The reviewer marked no claim as unsupported." : "",
    shown > 0 ? `${shown} doubted claim${shown === 1 ? " is" : "s are"} highlighted in the draft.` : "",
    overruled.length > 0 ? `${overruled.length} doubted claim${overruled.length === 1 ? " was" : "s were"} found word for word in the source, so NONON did not highlight ${overruled.length === 1 ? "it" : "them"}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  checks.push(
    unlocated.length === 0
      ? { id: "unsupported-flagged", label: "Claims the reviewer doubts are highlighted in the draft", status: "pass", detail: claimDetail }
      : { id: "unsupported-flagged", label: "Claims the reviewer doubts are highlighted in the draft", status: "warn", detail: `${unlocated.length} doubted claim${unlocated.length === 1 ? "" : "s"} could not be found in the draft text, so could not be highlighted. They are listed in the review notes. ${claimDetail}`.trim() },
  );

  if (o.flagged.numberSentences.length > 0) {
    checks.push({ id: "numbers", label: "Numbers in the draft come from the source", status: "warn", detail: `Not in the source or goal: ${o.flagged.numbersNotInSource.join(", ")}. Those sentences are highlighted.` });
  } else {
    checks.push({ id: "numbers", label: "Numbers in the draft come from the source", status: "pass", detail: "Every number in the draft appears in the source or your goal." });
  }

  const injected = findInjectionLines(o.src.doc.lines);
  if (injected.length > 0) {
    checks.push({ id: "source-instructions", label: "Orders to an AI inside the source were ignored", status: "warn", detail: `Line${injected.length === 1 ? "" : "s"} ${injected.join(", ")} read like orders to an AI. NONON treated them as plain text and did not follow them.` });
  }
  return checks;
}

export const teamDraft: ProcedureDef = {
  id: "team-draft",
  pack: "general",
  title: "Draft a document with your AI team",
  summary: "Get a plan, a written draft and a review from one source file, with each step done by the AI you choose.",
  supports:
    "Give it a .md, .txt or .docx file (or pasted text) and a short goal. Three steps run in order: Plan, Write and Check. Each step uses the AI you picked for it in the project settings. If you pick none, it uses the AI on this computer, which needs no account and no internet. You get a Word file, a text copy and a file showing who did each step.",
  limits: [
    "Each step sees only what it needs. Nothing else from your files, email or chat is shared.",
    `Your source can be up to about ${Math.round(MAX_SOURCE_CHARS / 6)} words. For more, use a shorter file or paste only the part you need.`,
    "An online AI is used only when you chose it for a step and this project allows it. If it stops, the job pauses and asks you. Nothing goes to another AI on its own.",
    "Sentences the reviewer doubts, or that contain numbers not found in the source, are highlighted. The reviewer is an AI and can miss things, so read the draft before you use it.",
    "If you change the file or the goal and run it again, only the steps that depend on the change run again.",
  ],
  inputs: [
    { key: "source", label: "Source file", kind: "file", accept: [".md", ".txt", ".docx"], optional: true, help: "The notes or brief to write from." },
    { key: "pastedSource", label: "Or paste the source text", kind: "text", optional: true },
    { key: "goal", label: "What should the document do?", kind: "text", help: "One or two sentences, for example: a one page summary for new customers." },
  ],
  revision: "1",
  run,
};

export const procedures: ProcedureDef[] = [teamDraft];
