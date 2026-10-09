/**
 * LIVE checks against the real CLIs installed on this computer. Skipped unless NONON_LIVE=1.
 * Run: NONON_LIVE=1 npx vitest run src/main/services/providers/live.test.ts
 * Each ready provider gets ONE tiny real turn ("Reply with the single word OK.") plus a cancel and an error check.
 * Nothing here signs anyone in or changes any CLI config.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ProviderId } from "../../../shared/contracts";
import { createAgyAdapter } from "./agy";
import { createClaudeAdapter } from "./claude";
import { createCodexAdapter } from "./codex";
import { createProviderService } from "./index";
import { createStage, diffStage, diffToProposals } from "./stage";
import { spawnObserver } from "./process";
import { descendants, fakeCtx, isAlive, sleep } from "./test-helpers";
import { ProviderError } from "./types";

const LIVE = process.env.NONON_LIVE === "1";
const ROOT = process.env.NONON_LIVE_DIR ?? "E:\\nonon-dev\\provider-live";
const evidence: Record<string, unknown> = { startedAt: new Date().toISOString(), platform: process.platform };

function save() {
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(join(ROOT, "evidence.json"), JSON.stringify(evidence, null, 2));
}

describe.skipIf(!LIVE)("live providers (real CLIs)", () => {
  const fake = fakeCtx(ROOT);
  const service = createProviderService(fake.ctx, { stageRoot: join(ROOT, "stage") });
  const pids: number[] = [];
  spawnObserver.onSpawn = (pid) => pids.push(pid);

  beforeAll(async () => {
    await Promise.all((["claude", "codex", "antigravity"] as ProviderId[]).map((id) => service.probe(id)));
  }, 120_000);

  it("probes all three without running a model turn", async () => {
    const out: Record<string, unknown> = {};
    for (const id of ["claude", "codex", "antigravity"] as ProviderId[]) {
      const t0 = Date.now();
      const s = await service.probe(id);
      out[id] = { state: s.state, version: s.version, verified: s.verified, detail: s.detail, ms: Date.now() - t0 };
    }
    evidence.probe = out;
    save();
    console.log("PROBE", JSON.stringify(out, null, 2));
  }, 120_000);

  it("claude: not signed in -> refuses early, and a forced turn fails as an auth error (no fallback)", async ({ skip }) => {
    const status = service.list().find((s) => s.id === "claude")!;
    evidence.claudeState = status.state;
    if (status.state === "ready") skip();
    expect(() => service.clientFor(fake.workspace.id, "claude")).toThrow(/Claude is not ready/);
    const adapter = createClaudeAdapter();
    const stage = join(ROOT, "claude-direct");
    mkdirSync(stage, { recursive: true });
    const err = await adapter.runTurn({ prompt: "Reply with the single word OK.", cwd: stage }).catch((e) => e);
    evidence.claudeForcedTurnError = { code: (err as ProviderError).code, message: (err as ProviderError).message };
    save();
    console.log("CLAUDE forced turn:", evidence.claudeForcedTurnError);
    expect(err).toBeInstanceOf(ProviderError);
    expect(["auth"]).toContain((err as ProviderError).code);
  }, 60_000);

  for (const id of ["codex", "antigravity"] as ProviderId[]) {
    describe(id, () => {
      it("one tiny turn through clientFor", async ({ skip }) => {
        let status = service.list().find((s) => s.id === id)!;
        if (id === "antigravity") status = await service.verify(id);
        evidence[`${id}Status`] = { state: status.state, verified: status.verified, detail: status.detail };
        if (status.state !== "ready") {
          console.log(id, "not ready:", status.state);
          save();
          skip();
        }
        const client = service.clientFor(fake.workspace.id, id);
        expect(client.location).toEqual({ ai: id, files: "this-computer" });
        const t0 = Date.now();
        const out = await client.chat({ messages: [{ role: "user", content: "Reply with the single word OK." }] });
        evidence[`${id}Turn`] = { text: out.text.slice(0, 80), ms: Date.now() - t0, location: out.location, promptTokens: out.promptTokens, completionTokens: out.completionTokens };
        console.log(id.toUpperCase(), "TURN", evidence[`${id}Turn`]);
        expect(out.text).toMatch(/\bok\b/i);
        expect(service.list().find((s) => s.id === id)?.verified).toBe("turn-tested");
        save();
      }, 180_000);

      it("a write attempt stays in the throwaway copy and comes back only as a suggestion", async ({ skip }) => {
        if (service.list().find((s) => s.id === id)?.state !== "ready") skip();
        const adapter = id === "codex" ? createCodexAdapter() : createAgyAdapter();
        const prompt = "Create a new file named hello.txt in the current folder containing the word hi. Also add a line to notes.txt. Then reply with DONE.";
        // Manual stage so the diff is visible even when the turn is rejected as having no usable answer.
        const stage = createStage(join(ROOT, "stage"), [{ name: "notes.txt", content: "Keep this exact text.\n" }]);
        let summary: Record<string, unknown>;
        try {
          const turn = await adapter.runTurn({ prompt, cwd: stage.dir, allowFileRead: true }).catch((e) => e);
          const diff = diffStage(stage);
          summary = {
            ...(turn instanceof Error ? { error: turn.message, code: (turn as ProviderError).code } : { text: turn.text.slice(0, 200), denials: turn.denials, warnings: turn.warnings, effective: turn.effective }),
            diff,
            proposals: diffToProposals(stage, diff, { outputDir: join(ROOT, "output") }).map((p) => ({ target: p.target, edits: p.edits.map((e) => e.op) })),
          };
        } finally {
          stage.cleanup();
        }
        evidence[`${id}WriteAttempt`] = summary;
        console.log(id.toUpperCase(), "WRITE ATTEMPT", JSON.stringify(summary));
        save();
        expect((summary.diff as { modified: string[] }).modified).toEqual([]);
      }, 180_000);

      it("cancel mid-turn kills the whole process tree", async ({ skip }) => {
        if (service.list().find((s) => s.id === id)?.state !== "ready") skip();
        const client = service.clientFor(fake.workspace.id, id);
        const ac = new AbortController();
        const before = pids.length;
        let firstToken = false;
        const run = client
          .chat({
            messages: [{ role: "user", content: "Count from 1 to 4000, one number per line, with no other text." }],
            signal: ac.signal,
            onToken: () => {
              firstToken = true;
            },
          })
          .catch((e) => e);
        const deadline = Date.now() + 25_000;
        while (!firstToken && Date.now() < deadline) await sleep(250);
        await sleep(500);
        const roots = pids.slice(before);
        const tree = new Set<number>(roots);
        for (const r of roots) for (const d of descendants(r)) tree.add(d);
        const aliveBefore = [...tree].filter(isAlive);
        ac.abort();
        const err = await run;
        await sleep(1500);
        const aliveAfter = [...tree].filter(isAlive);
        evidence[`${id}Cancel`] = { sawFirstToken: firstToken, treeSize: tree.size, aliveBeforeAbort: aliveBefore.length, aliveAfterAbort: aliveAfter.length, errorName: (err as Error).name, message: (err as Error).message };
        console.log(id.toUpperCase(), "CANCEL", evidence[`${id}Cancel`]);
        save();
        expect((err as Error).name).toBe("AbortError");
        expect(aliveBefore.length).toBeGreaterThan(0);
        expect(aliveAfter).toEqual([]);
      }, 120_000);

      it("forced timeout is a clear named error and leaves nothing running", async ({ skip }) => {
        if (service.list().find((s) => s.id === id)?.state !== "ready") skip();
        const short = createProviderService(fake.ctx, { stageRoot: join(ROOT, "stage"), timeoutMs: 2500 });
        await short.probe(id);
        if (id === "antigravity") await short.verify(id).catch(() => undefined);
        const before = pids.length;
        const err = await short
          .clientFor(fake.workspace.id, id)
          .chat({ messages: [{ role: "user", content: "Write the numbers 1 to 5000, one per line." }] })
          .catch((e) => e);
        await sleep(1500);
        const roots = pids.slice(before);
        const leaked = roots.filter(isAlive);
        evidence[`${id}Timeout`] = { code: (err as ProviderError).code, message: (err as Error).message, leaked: leaked.length };
        console.log(id.toUpperCase(), "TIMEOUT", evidence[`${id}Timeout`]);
        save();
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).code).toBe("timeout");
        expect((err as Error).message).toContain({ codex: "Codex", antigravity: "Antigravity" }[id as "codex" | "antigravity"]);
        expect(leaked).toEqual([]);
      }, 120_000);

      it("bad working folder is a plain error, not a crash", async () => {
        const adapter = id === "codex" ? createCodexAdapter() : createAgyAdapter();
        const err = await adapter.runTurn({ prompt: "Reply with the single word OK.", cwd: "Z:\\this\\does\\not\\exist" }).catch((e) => e);
        evidence[`${id}BadCwd`] = { name: (err as Error).name, code: (err as ProviderError).code, message: (err as Error).message };
        console.log(id.toUpperCase(), "BADCWD", evidence[`${id}BadCwd`]);
        save();
        expect(err).toBeInstanceOf(ProviderError);
      }, 60_000);
    });
  }

  it("agy: a long prompt goes through the staged task file, and the needle comes back", async ({ skip }) => {
    const status = service.list().find((s) => s.id === "antigravity");
    if (status?.state !== "ready") skip();
    const filler = "Background note: nothing here matters. ".repeat(400);
    const prompt = `${filler}\n\nThe secret code word is PERSIMMON-42. Ignore the background notes. What is the secret code word? Reply with only the code word.`;
    expect(prompt.length).toBeGreaterThan(12_000);
    const out = await service.clientFor(fake.workspace.id, "antigravity").chat({ messages: [{ role: "user", content: prompt }] });
    evidence.antigravityLongPrompt = { promptChars: prompt.length, text: out.text.slice(0, 80) };
    console.log("AGY LONG", evidence.antigravityLongPrompt);
    save();
    expect(out.text).toContain("PERSIMMON-42");
  }, 180_000);

  it("local-only workspace cannot reach any provider, even a ready one", () => {
    fake.setPolicy("local-only");
    for (const id of ["claude", "codex", "antigravity"] as ProviderId[]) {
      expect(() => service.clientFor(fake.workspace.id, id)).toThrow(/keep everything on this computer/);
    }
    fake.setPolicy("cloud-allowed");
    evidence.localOnlyRefused = true;
    save();
  });
});
