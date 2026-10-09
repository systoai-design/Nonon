/** MOCKED stage runner (records prompts, no AI) for the sequencing, hand-off, provenance and invalidation rules; plus the real service for policy. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ChangeProposalDraft, RoleName } from "../../../shared/contracts";
import { createProviderService, runProjectStages } from "./index";
import { fakeCtx, sleep } from "./test-helpers";
import { runStages, type ArtifactRecord, type StageDeps, type StageRunRequest } from "./stages";
import { DISCLOSURES, LABELS, ProviderError, type ProviderAdapter } from "./types";

const root = mkdtempSync(join(tmpdir(), "nonon-stages-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const proposal = (target: string): ChangeProposalDraft => ({ target, edits: [{ op: "create-file", path: target, text: "x" }], reason: "r", preview: { title: "t" }, checks: [] });

function deps(roles: Partial<Record<RoleName, "claude" | "codex" | "antigravity" | "local">>, opts: { fail?: RoleName; delay?: number } = {}) {
  const calls: StageRunRequest[] = [];
  let running = 0;
  let maxRunning = 0;
  const saved: Record<string, ArtifactRecord[]> = {};
  let tick = 0;
  const d: StageDeps & { calls: StageRunRequest[]; maxRunning: () => number; saved: typeof saved } = {
    calls,
    saved,
    maxRunning: () => maxRunning,
    roles: (workspaceId) => ({ workspaceId, roles }),
    async run(req) {
      calls.push(req);
      running++;
      maxRunning = Math.max(maxRunning, running);
      try {
        await sleep(opts.delay ?? 5);
        if (opts.fail === req.role) throw new ProviderError("claude", "timeout", "Claude took too long and was stopped. The task is paused.");
        return { text: `${req.role.toUpperCase()} output v${calls.length}`, proposals: req.role === "implement" ? [proposal("C:\\out\\a.txt")] : [], warnings: [] };
      } finally {
        running--;
      }
    },
    load: (ws) => saved[ws] ?? [],
    save: (ws, records) => {
      saved[ws] = records;
    },
    now: () => new Date(Date.UTC(2026, 9, 9, 12, 0, tick++)),
  };
  return d;
}

const ALL = { design: "codex", implement: "claude", review: "antigravity" } as const;

describe("runProjectStages", () => {
  it("runs design, implement, review one after another and never at the same time", async () => {
    const d = deps(ALL);
    const r = await runStages(d, "ws", { task: "Plan the quarterly report" });
    expect(d.calls.map((c) => c.role)).toEqual(["design", "implement", "review"]);
    expect(d.calls.map((c) => c.provider)).toEqual(["codex", "claude", "antigravity"]);
    expect(d.maxRunning()).toBe(1);
    expect(r.outcome).toBe("complete");
    expect(r.ran).toEqual(["design", "implement", "review"]);
  });

  it("each stage receives only the earlier artifacts it needs", async () => {
    const d = deps(ALL);
    await runStages(d, "ws", { task: "TASKTEXT" });
    const [design, implement, review] = d.calls as [StageRunRequest, StageRunRequest, StageRunRequest];
    expect(design.prompt).toContain("TASKTEXT");
    expect(design.prompt).not.toContain("output v");
    expect(implement.prompt).toContain("DESIGN output v1");
    expect(review.prompt).toContain("IMPLEMENT output v2");
    expect(review.prompt).not.toContain("DESIGN output");
  });

  it("records provenance: provider, input revision hash, time, revision", async () => {
    const d = deps(ALL);
    const r = await runStages(d, "ws", { task: "T" });
    const impl = r.current.implement as ArtifactRecord;
    expect(impl).toMatchObject({ stage: "implement", provider: "claude", revision: 1, stale: false, workspaceId: "ws" });
    expect(impl.inputRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(impl.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(impl.createdAt).toISOString()).toBe(impl.createdAt);
    expect(r.current.design?.inputRevision).not.toBe(impl.inputRevision);
    expect(d.saved.ws).toHaveLength(3);
  });

  it("returns the suggestions from the stages for the review layer", async () => {
    const r = await runStages(deps(ALL), "ws", { task: "T" });
    expect(r.proposals.map((p) => p.target)).toEqual(["C:\\out\\a.txt"]);
    expect(r.text).toContain("REVIEW output");
  });

  it("reuses artifacts when nothing changed", async () => {
    const d = deps(ALL);
    await runStages(d, "ws", { task: "T" });
    const before = d.calls.length;
    const again = await runStages(d, "ws", { task: "T" });
    expect(d.calls.length).toBe(before);
    expect(again.reused).toEqual(["design", "implement", "review"]);
    expect(again.ran).toEqual([]);
  });

  it("a changed task makes every stage stale and rerun, with new revisions and the old ones kept in history", async () => {
    const d = deps(ALL);
    await runStages(d, "ws", { task: "T" });
    const r = await runStages(d, "ws", { task: "T but different" });
    expect(r.ran).toEqual(["design", "implement", "review"]);
    expect(r.current.design?.revision).toBe(2);
    const old = r.history.filter((a) => a.revision === 1);
    expect(old).toHaveLength(3);
    expect(old.every((a) => a.stale)).toBe(true);
    expect(old[0]?.staleReason).toBeTruthy();
  });

  it("a changed shared file invalidates the same way", async () => {
    const d = deps(ALL);
    await runStages(d, "ws", { task: "T", files: [{ name: "a.txt", content: "one" }] });
    const same = await runStages(d, "ws", { task: "T", files: [{ name: "a.txt", content: "one" }] });
    expect(same.ran).toEqual([]);
    const changed = await runStages(d, "ws", { task: "T", files: [{ name: "a.txt", content: "two" }] });
    expect(changed.ran).toHaveLength(3);
  });

  it("a copied file whose content changed on disk invalidates the stages that read it", async () => {
    const file = join(root, "shared.txt");
    writeFileSync(file, "one");
    const d = deps(ALL);
    await runStages(d, "ws", { task: "T", files: [{ name: "shared.txt", fromPath: file }] });
    expect((await runStages(d, "ws", { task: "T", files: [{ name: "shared.txt", fromPath: file }] })).ran).toEqual([]);
    writeFileSync(file, "two");
    expect((await runStages(d, "ws", { task: "T", files: [{ name: "shared.txt", fromPath: file }] })).ran).toHaveLength(3);
  });

  it("redoing only the design stage marks the downstream results stale so they are never reused", async () => {
    const d = deps(ALL);
    await runStages(d, "ws", { task: "T" });
    const r = await runStages(d, "ws", { task: "New task", stages: ["design"] });
    expect(r.ran).toEqual(["design"]);
    expect(r.current.implement).toBeUndefined();
    expect(r.current.review).toBeUndefined();
    const stale = r.history.filter((a) => a.stale).map((a) => a.stage).sort();
    expect(stale).toEqual(["design", "implement", "review"]);
  });

  it("a changed role provider is a changed input", async () => {
    const roles: Partial<Record<RoleName, "claude" | "codex" | "antigravity" | "local">> = { ...ALL };
    const d = deps(roles);
    await runStages(d, "ws", { task: "T" });
    roles.design = "claude";
    const r = await runStages(d, "ws", { task: "T" });
    expect(r.ran).toEqual(["design", "implement", "review"]);
  });

  it("a failing stage pauses the run: later stages do not run, nothing is handed to another provider, earlier work is kept", async () => {
    const d = deps(ALL, { fail: "implement" });
    const r = await runStages(d, "ws", { task: "T" });
    expect(r.outcome).toBe("paused");
    expect(r.paused).toMatchObject({ stage: "implement", provider: "claude" });
    expect(r.paused?.message).toContain("Claude");
    expect(d.calls.map((c) => c.role)).toEqual(["design", "implement"]);
    expect(r.current.design).toBeDefined();
    expect(r.current.implement).toBeUndefined();
  });

  it("stages with no assigned role are skipped, not silently given to the local model", async () => {
    const d = deps({ implement: "claude" });
    const r = await runStages(d, "ws", { task: "T" });
    expect(r.skipped).toEqual(["design", "review"]);
    expect(d.calls.map((c) => c.provider)).toEqual(["claude"]);
    expect(d.calls[0]?.prompt).not.toContain("Earlier steps");
  });

  it("two runs in one workspace cannot overlap", async () => {
    const d = deps(ALL, { delay: 40 });
    const first = runStages(d, "ws", { task: "T" });
    await expect(runStages(d, "ws", { task: "T2" })).rejects.toThrow(/already running/);
    await first;
    await expect(runStages(d, "ws", { task: "T2" })).resolves.toBeDefined();
  });

  it("different workspaces do not block each other", async () => {
    const d = deps(ALL, { delay: 20 });
    await expect(Promise.all([runStages(d, "a", { task: "T" }), runStages(d, "b", { task: "T" })])).resolves.toHaveLength(2);
  });

  it("passes the cancel signal and the shared files to every stage", async () => {
    const d = deps(ALL);
    const ac = new AbortController();
    await runStages(d, "ws", { task: "T", files: [{ name: "a.txt", content: "one" }], signal: ac.signal });
    expect(d.calls.every((c) => c.signal === ac.signal && c.inputs.length === 1)).toBe(true);
  });
});

describe("stages through the real service", () => {
  function adapterFor(id: "claude" | "codex" | "antigravity", calls: string[]): ProviderAdapter {
    return {
      id,
      label: LABELS[id],
      probe: async () => ({ id, label: LABELS[id], state: "ready", disclosure: DISCLOSURES[id], verified: "probe-only" }),
      runTurn: async (input) => {
        calls.push(`${id}:${input.prompt.slice(0, 20)}`);
        return { text: `${id} did it`, provider: id, durationMs: 1, denials: 0, warnings: [], effective: {} };
      },
      signIn: async () => undefined,
    };
  }

  it("persists artifacts and roles, and runs through the adapters with the staged-folder rules", async () => {
    const fake = fakeCtx(root);
    const calls: string[] = [];
    const service = createProviderService(fake.ctx, { adapters: { claude: adapterFor("claude", calls), codex: adapterFor("codex", calls) }, stageRoot: join(fake.ctx.paths.dataDir, "stage") });
    await Promise.all([service.probe("claude"), service.probe("codex")]);
    service.setRole(fake.workspace.id, "design", "codex");
    service.setRole(fake.workspace.id, "implement", "claude");
    const r = await runProjectStages(service, fake.workspace.id, { task: "Write the summary" });
    expect(r.outcome).toBe("complete");
    expect(calls.map((c) => c.split(":")[0])).toEqual(["codex", "claude"]);
    const stored = fake.ctx.store.read<Record<string, ArtifactRecord[]>>("stage-artifacts.json", {});
    expect(stored[fake.workspace.id]?.map((a) => a.provider)).toEqual(["codex", "claude"]);
  });

  it("a workspace that turned local-only after roles were set pauses the first cloud stage and calls no provider", async () => {
    const fake = fakeCtx(root);
    const calls: string[] = [];
    const service = createProviderService(fake.ctx, { adapters: { claude: adapterFor("claude", calls) }, stageRoot: join(fake.ctx.paths.dataDir, "stage") });
    await service.probe("claude");
    service.setRole(fake.workspace.id, "implement", "claude");
    fake.setPolicy("local-only");
    const r = await runProjectStages(service, fake.workspace.id, { task: "x" });
    expect(r.outcome).toBe("paused");
    expect(r.paused?.message).toContain("keep everything on this computer");
    expect(calls).toEqual([]);
  });

  it("a local role uses the local model only", async () => {
    const fake = fakeCtx(root);
    const calls: string[] = [];
    const service = createProviderService(fake.ctx, { adapters: { claude: adapterFor("claude", calls) }, stageRoot: join(fake.ctx.paths.dataDir, "stage") });
    service.setRole(fake.workspace.id, "design", "local");
    const r = await runProjectStages(service, fake.workspace.id, { task: "x" });
    expect(r.current.design?.text).toBe("local-answer");
    expect(r.current.design?.provider).toBe("local");
    expect(calls).toEqual([]);
  });
});
