/**
 * REAL runs. (a) needs the shared dev llama-server (URL in E:\nonon-dev\llm-url.txt) and sends nothing off this computer.
 * (b) sends the sample brief to the owner's own Codex sign-in and only runs with NONON_TEAM_LIVE=1.
 * Both write their evidence under fixtures/team-draft/real-runs/.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import mammoth from "mammoth";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { InferenceClient, ProcedureOutcome } from "../../../../shared/contracts";
import { createProviderService } from "../../providers";
import { fakeCtx } from "../../providers/test-helpers";
import { createOpenAiCompatClient } from "../../runtime/llama-client";
import { fakeAi, makeTestCtx, realBaseUrl, type TestCtx } from "../doc-common/test-util";
import { bindTeamDraftHost } from "./host";
import { teamDraft } from "./index";
import { SAMPLE_BRIEF } from "./testkit";

const FIX = resolve(__dirname, "../../../../../../fixtures/team-draft");
const RUNS = join(FIX, "real-runs");
const expected = JSON.parse(readFileSync(join(FIX, "expected.json"), "utf8")) as { facts: { label: string; anyOf: string[] }[]; goal: string; editedGoal: string };
const root = mkdtempSync(join(tmpdir(), "nonon-team-real-"));
const made: TestCtx[] = [];
afterEach(async () => {
  bindTeamDraftHost(null);
  while (made.length) await made.pop()!.cleanup();
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

interface ReportShape {
  stages: { stage: string; providerLabel: string; status: string; revision: number; ms?: number; attempts?: number; dropped?: string[]; model?: string }[];
  findings: unknown[];
  verdict: string;
}

function countingClient(inner: InferenceClient): InferenceClient & { calls: { ms: number; promptTokens?: number; completionTokens?: number; tokensPerSecond?: number }[] } {
  const calls: { ms: number; promptTokens?: number; completionTokens?: number; tokensPerSecond?: number }[] = [];
  return {
    location: inner.location,
    calls,
    async chat(req) {
      const started = Date.now();
      const res = await inner.chat(req);
      calls.push({
        ms: Date.now() - started,
        ...(res.promptTokens !== undefined ? { promptTokens: res.promptTokens } : {}),
        ...(res.completionTokens !== undefined ? { completionTokens: res.completionTokens } : {}),
        ...(res.tokensPerSecond !== undefined ? { tokensPerSecond: res.tokensPerSecond } : {}),
      });
      return res;
    },
  };
}

async function alive(url: string | null): Promise<boolean> {
  if (!url) return false;
  try {
    return (await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

function factsIn(text: string): Record<string, boolean> {
  const flat = text.toLowerCase().replace(/\s+/g, " ");
  return Object.fromEntries(expected.facts.map((f) => [f.label, f.anyOf.some((a) => flat.includes(a.toLowerCase()))]));
}

const serverUp = await alive(realBaseUrl());

async function runProcedure(t: TestCtx, label: string): Promise<{ out: ProcedureOutcome; ms: number }> {
  const started = Date.now();
  const out = await teamDraft.run(t.ctx);
  const ms = Date.now() - started;
  void label;
  return { out, ms };
}

describe.skipIf(!serverUp)("team-draft REAL local model, all three steps on this computer, local-only workspace", () => {
  it(
    "drafts the sample brief, reuses on a second run, and reruns the right steps when the goal or the file changes",
    async () => {
      mkdirSync(RUNS, { recursive: true });
      const local = countingClient(createOpenAiCompatClient(realBaseUrl()!));
      const fake = fakeCtx(root, "local-only");
      (fake.ctx.svc.runtime as { client: () => unknown }).client = () => local;
      const service = createProviderService(fake.ctx, { stageRoot: join(fake.ctx.paths.dataDir, "stage") });
      for (const role of ["design", "implement", "review"] as const) service.setRole(fake.workspace.id, role, "local");

      const work = join(root, "work");
      mkdirSync(work, { recursive: true });
      const source = join(work, "product-brief.md");
      copyFileSync(SAMPLE_BRIEF, source);

      const t = await makeTestCtx({ ai: fakeAi(() => "unused"), text: { goal: expected.goal }, files: { source: [source] } });
      made.push(t);
      t.ctx.workspace = fake.workspace;

      // Run 1: everything fresh.
      const first = await runProcedure(t, "first");
      if (first.out.kind !== "done") throw new Error(JSON.stringify(first.out));
      const report1 = first.out.report as ReportShape;
      const callsAfterFirst = local.calls.length;
      const md = await readFile(first.out.outputs[1]!.path, "utf8");
      const specAndReview = await readFile(first.out.outputs[2]!.path, "utf8");
      const word = (await mammoth.extractRawText({ path: first.out.outputs[0]!.path })).value;
      writeFileSync(join(RUNS, "local-run-Team draft.md"), md);
      writeFileSync(join(RUNS, "local-run-Team draft - spec and review.md"), specAndReview);

      // Run 2: nothing changed.
      const second = await runProcedure(t, "second");
      if (second.out.kind !== "done") throw new Error(JSON.stringify(second.out));
      const callsAfterSecond = local.calls.length;

      // Run 3: only the goal changed.
      t.ctx.text.goal = expected.editedGoal;
      const third = await runProcedure(t, "goal");
      if (third.out.kind !== "done") throw new Error(JSON.stringify(third.out));
      const report3 = third.out.report as ReportShape;
      const callsAfterThird = local.calls.length;

      // Run 4: the file was edited (budget changed).
      writeFileSync(source, readFileSync(SAMPLE_BRIEF, "utf8").replace("1,500 USD", "1,800 USD"), "utf8");
      const fourth = await runProcedure(t, "file");
      if (fourth.out.kind !== "done") throw new Error(JSON.stringify(fourth.out));
      const report4 = fourth.out.report as ReportShape;
      const md4 = await readFile(fourth.out.outputs[1]!.path, "utf8");

      const evidence = {
        ranAt: new Date().toISOString(),
        model: "Qwen3.5 4B Q4_K_M via llama-server on this PC (127.0.0.1)",
        workspacePolicy: "local-only",
        roles: { design: "local", implement: "local", review: "local" },
        input: "app/resources/samples/general/product-brief.md",
        run1: {
          ms: first.ms,
          modelCalls: callsAfterFirst,
          calls: local.calls.slice(0, callsAfterFirst),
          stages: report1.stages,
          verdict: report1.verdict,
          findings: report1.findings.length,
          summary: first.out.summary,
          checks: first.out.checks,
          factsInDraft: factsIn(md.split("## Review notes")[0] ?? md),
        },
        run2UnchangedInputs: { ms: second.ms, newModelCalls: callsAfterSecond - callsAfterFirst, stages: (second.out.report as ReportShape).stages.map((s) => `${s.stage}:${s.status}`) },
        run3GoalChanged: { ms: third.ms, newModelCalls: callsAfterThird - callsAfterSecond, stages: report3.stages.map((s) => `${s.stage}:${s.status}:r${s.revision}`) },
        run4FileEdited: { ms: fourth.ms, newModelCalls: local.calls.length - callsAfterThird, stages: report4.stages.map((s) => `${s.stage}:${s.status}:r${s.revision}`), draftMentions1800: md4.includes("1,800") || md4.includes("1800"), draftStillSays1500: md4.includes("1,500") },
      };
      writeFileSync(join(RUNS, "local-run.json"), JSON.stringify(evidence, null, 2));

      // Invariants that must hold whatever the model does.
      expect(first.out.proposals).toEqual([]);
      expect(report1.stages.map((s) => s.providerLabel)).toEqual(["This computer", "This computer", "This computer"]);
      expect(report1.stages.every((s) => s.status === "made now")).toBe(true);
      expect(first.out.checks.find((c) => c.id === "stages-recorded")?.status).toBe("pass");
      expect(first.out.checks.find((c) => c.id === "source-lines")?.status).not.toBe("fail");
      expect(word).toContain("Review notes");
      expect(md).toContain("Review notes");
      expect(callsAfterSecond).toBe(callsAfterFirst);
      expect(report3.stages.find((s) => s.stage === "design")?.status).toBe("made now");
      expect(report4.stages.every((s) => s.status === "made now")).toBe(true);
      expect(local.calls.length - callsAfterThird).toBeGreaterThanOrEqual(3);
    },
    25 * 60_000,
  );
});

describe.skipIf(process.env.NONON_TEAM_LIVE !== "1")("team-draft REAL Codex on the implement step (needs NONON_TEAM_LIVE=1)", () => {
  it(
    "design and review on this computer, implement on the owner's own Codex sign-in, sample brief only",
    async () => {
      mkdirSync(RUNS, { recursive: true });
      const fake = fakeCtx(root, "cloud-allowed");
      const local = countingClient(createOpenAiCompatClient(realBaseUrl()!));
      (fake.ctx.svc.runtime as { client: () => unknown }).client = () => local;
      const service = createProviderService(fake.ctx, { stageRoot: join(fake.ctx.paths.dataDir, "stage") });
      const status = await service.probe("codex");
      if (status.state !== "ready") {
        writeFileSync(join(RUNS, "codex-run.json"), JSON.stringify({ ranAt: new Date().toISOString(), skipped: true, codexState: status.state, detail: status.detail }, null, 2));
        return;
      }
      service.setRole(fake.workspace.id, "design", "local");
      service.setRole(fake.workspace.id, "implement", "codex");
      service.setRole(fake.workspace.id, "review", "local");

      const t = await makeTestCtx({ ai: fakeAi(() => "unused"), text: { goal: expected.goal }, files: { source: [SAMPLE_BRIEF] } });
      made.push(t);
      t.ctx.workspace = fake.workspace;

      const { out, ms } = await runProcedure(t, "codex");
      writeFileSync(join(RUNS, "codex-run.out.json"), JSON.stringify(out, null, 2));
      if (out.kind !== "done") throw new Error(JSON.stringify(out));
      const report = out.report as ReportShape;
      const md = await readFile(out.outputs[1]!.path, "utf8");
      const specAndReview = await readFile(out.outputs[2]!.path, "utf8");
      writeFileSync(join(RUNS, "codex-run-Team draft.md"), md);
      writeFileSync(join(RUNS, "codex-run-Team draft - spec and review.md"), specAndReview);
      writeFileSync(
        join(RUNS, "codex-run.json"),
        JSON.stringify(
          {
            ranAt: new Date().toISOString(),
            codex: { version: status.version, verified: status.verified },
            roles: { design: "local", implement: "codex", review: "local" },
            input: "app/resources/samples/general/product-brief.md (the only data sent)",
            ms,
            stages: report.stages,
            summary: out.summary,
            checks: out.checks,
            factsInDraft: factsIn(md.split("## Review notes")[0] ?? md),
            localModelCalls: local.calls.length,
          },
          null,
          2,
        ),
      );
      expect(report.stages.map((s) => s.providerLabel)).toEqual(["This computer", "Codex (online)", "This computer"]);
      expect(out.proposals).toEqual([]);
      expect(out.checks.find((c) => c.id === "stages-recorded")?.status).toBe("pass");
    },
    25 * 60_000,
  );
});
