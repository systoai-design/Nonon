import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ChangeProposalDraft, ProjectRoles, ProviderId, RoleName } from "../../../shared/contracts";
import { ProviderError } from "./types";
import type { StageInput } from "./stage";

/** One stage output with the facts needed to trust it later. Revisions only grow; old ones stay for the record. */
export interface ArtifactRecord {
  id: string;
  workspaceId: string;
  stage: RoleName;
  revision: number;
  provider: ProviderId | "local";
  /** Hash of everything this stage read: the task, shared files and the upstream artifacts it was given. */
  inputRevision: string;
  contentHash: string;
  text: string;
  proposals: ChangeProposalDraft[];
  createdAt: string;
  /** True once an input changed after this was made. A stale artifact is never handed downstream. */
  stale: boolean;
  staleReason?: string;
}

export interface StageRunRequest {
  workspaceId: string;
  role: RoleName;
  provider: ProviderId | "local";
  prompt: string;
  systemPrompt: string;
  inputs: StageInput[];
  signal?: AbortSignal;
  /** Asks the local AI for output that fits this JSON Schema. Connected AI is told the shape in words instead. */
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}

export interface StageRunResult {
  text: string;
  proposals: ChangeProposalDraft[];
  model?: string;
  warnings: string[];
}

export interface StageDeps {
  roles(workspaceId: string): ProjectRoles;
  /** Runs one stage on its assigned provider. Must throw, never fall back, when that provider is not allowed or fails. */
  run(request: StageRunRequest): Promise<StageRunResult>;
  load(workspaceId: string): ArtifactRecord[];
  save(workspaceId: string, records: ArtifactRecord[]): void;
  now?(): Date;
}

export interface ProjectStageOptions {
  /** The job in plain words. Part of every stage's input revision. */
  task: string;
  /** A different task text for a stage that must not see everything the others see. Replaces `task` for that stage, in its prompt and in its input revision. */
  taskFor?: Partial<Record<RoleName, string>>;
  /** Which stages to run, in order. Default design, implement, review. */
  stages?: RoleName[];
  /** Files copied into the staged folder of every stage that runs. */
  files?: StageInput[];
  /** Which earlier stages each stage is given. Default: implement reads design, review reads implement. */
  needs?: Partial<Record<RoleName, RoleName[]>>;
  signal?: AbortSignal;
  onStage?: (info: { stage: RoleName; provider: ProviderId | "local"; state: "started" | "done" | "reused" | "skipped" }) => void;
}

export interface ProjectStageResult {
  workspaceId: string;
  outcome: "complete" | "paused";
  /** Newest non-stale artifact of each stage that has one. */
  current: Partial<Record<RoleName, ArtifactRecord>>;
  /** Every revision ever made for this workspace, newest last. */
  history: ArtifactRecord[];
  ran: RoleName[];
  reused: RoleName[];
  skipped: RoleName[];
  /** Set when a stage failed. Later stages did not run and nothing was handed to another provider. */
  paused?: { stage: RoleName; provider: ProviderId | "local"; message: string };
  proposals: ChangeProposalDraft[];
  /** Text of the last stage that ran or was reused. */
  text: string;
}

const DEFAULT_STAGES: RoleName[] = ["design", "implement", "review"];
const DEFAULT_NEEDS: Record<RoleName, RoleName[]> = { design: [], implement: ["design"], review: ["implement"] };

const STAGE_BRIEF: Record<RoleName, string> = {
  design: "You are the design step. Write a short, concrete plan for the task: what to produce, the parts, and what to check. Do not do the work itself. Write for a reader who is not an expert: short sentences, everyday words, no jargon.",
  implement: "You are the doing step. Carry out the task. If a plan is given, follow it. Give the finished result as text. Write for a reader who is not an expert: short sentences, everyday words, no jargon.",
  review: "You are the review step. Check the finished result against the task. List problems you can point to, then say whether it is ready. Do not rewrite the work. Write for a reader who is not an expert: short sentences, everyday words, no jargon.",
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Only one run per workspace at a time, so two stages can never write at once. */
const active = new Set<string>();

function inputsFingerprint(files: StageInput[]): string {
  return sha(
    files
      .map((f) => ("content" in f ? `${f.name}:${sha(typeof f.content === "string" ? f.content : Buffer.from(f.content).toString("base64"))}` : `${f.name}:${sha(readFileSync(f.fromPath).toString("base64"))}`))
      .sort()
      .join("\n"),
  );
}

/**
 * Runs the configured roles one after another on a single shared record. Each stage gets only the task, the shared
 * files and the artifacts it needs from earlier stages. If anything a stage read has changed since its last artifact
 * was made, that artifact is marked stale and the stage runs again; downstream stages then see a new input revision
 * and run again too. A failing stage pauses the run: no later stage runs and no other provider takes over.
 */
export async function runStages(deps: StageDeps, workspaceId: string, opts: ProjectStageOptions): Promise<ProjectStageResult> {
  if (active.has(workspaceId)) throw new ProviderError("none", "failed", "A job with several steps is already running in this project. Wait for it to finish.");
  active.add(workspaceId);
  try {
    const stages = opts.stages ?? DEFAULT_STAGES;
    const needs = { ...DEFAULT_NEEDS, ...opts.needs };
    const roles = deps.roles(workspaceId).roles;
    const files = opts.files ?? [];
    const filesPrint = inputsFingerprint(files);
    const history = deps.load(workspaceId);
    const stamp = () => (deps.now?.() ?? new Date()).toISOString();
    const current = (stage: RoleName) => [...history].reverse().find((a) => a.stage === stage && !a.stale);
    const result: ProjectStageResult = { workspaceId, outcome: "complete", current: {}, history, ran: [], reused: [], skipped: [], proposals: [], text: "" };

    for (const stage of stages) {
      const provider = roles[stage];
      if (!provider) {
        result.skipped.push(stage);
        opts.onStage?.({ stage, provider: "local", state: "skipped" });
        continue;
      }
      const upstream = needs[stage]
        .map((s) => current(s))
        .filter((a): a is ArtifactRecord => Boolean(a));
      const stageTask = opts.taskFor?.[stage] ?? opts.task;
      const inputRevision = sha([sha(stageTask), filesPrint, provider, ...upstream.map((a) => `${a.stage}:${a.contentHash}`)].join("|"));

      const existing = current(stage);
      if (existing && existing.inputRevision === inputRevision) {
        result.reused.push(stage);
        result.text = existing.text;
        opts.onStage?.({ stage, provider, state: "reused" });
        continue;
      }
      if (existing) {
        existing.stale = true;
        existing.staleReason = "An input changed after this was made.";
      }

      opts.onStage?.({ stage, provider, state: "started" });
      const context = upstream.map((a) => `--- ${a.stage} step result (revision ${a.revision}) ---\n${a.text}`).join("\n\n");
      const prompt = [`Task:\n${stageTask}`, context && `Earlier steps:\n${context}`].filter(Boolean).join("\n\n");
      let out: StageRunResult;
      try {
        out = await deps.run({ workspaceId, role: stage, provider, prompt, systemPrompt: STAGE_BRIEF[stage], inputs: files, ...(opts.signal ? { signal: opts.signal } : {}) });
      } catch (error) {
        deps.save(workspaceId, history);
        const message = error instanceof Error ? error.message : String(error);
        result.outcome = "paused";
        result.paused = { stage, provider, message };
        break;
      }
      const revision = Math.max(0, ...history.filter((a) => a.stage === stage).map((a) => a.revision)) + 1;
      const record: ArtifactRecord = {
        id: `${workspaceId}:${stage}:${revision}`,
        workspaceId,
        stage,
        revision,
        provider,
        inputRevision,
        contentHash: sha(out.text),
        text: out.text,
        proposals: out.proposals,
        createdAt: stamp(),
        stale: false,
      };
      history.push(record);
      // Anything downstream built on the replaced version no longer matches; mark it so it is never reused.
      // A redo that came out word for word the same changes nothing for the stages after it.
      const changed = new Set<RoleName>(existing && existing.contentHash === record.contentHash ? [] : [stage]);
      for (const later of DEFAULT_STAGES.slice(DEFAULT_STAGES.indexOf(stage) + 1)) {
        const old = current(later);
        if (!needs[later].some((s) => changed.has(s))) continue;
        changed.add(later);
        if (old) {
          old.stale = true;
          old.staleReason = `The ${stage} step was redone after this was made.`;
        }
      }
      result.ran.push(stage);
      result.text = out.text;
      opts.onStage?.({ stage, provider, state: "done" });
    }

    deps.save(workspaceId, history);
    for (const stage of DEFAULT_STAGES) {
      const a = current(stage);
      if (a) {
        result.current[stage] = a;
        result.proposals.push(...a.proposals);
      }
    }
    return result;
  } finally {
    active.delete(workspaceId);
  }
}
