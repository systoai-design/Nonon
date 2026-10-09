/** MOCKED adapters (in-memory fakes) behind the REAL provider service: policy, readiness, no-fallback, status evidence, roles. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ProviderId, ProviderStatus } from "../../../shared/contracts";
import { createProviderService, type ProviderServiceX } from "./index";
import { fakeCtx } from "./test-helpers";
import { DISCLOSURES, LABELS, ProviderError, type ProviderAdapter, type TurnInput, type TurnResult } from "./types";

const root = mkdtempSync(join(tmpdir(), "nonon-service-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

interface FakeOptions {
  state?: ProviderStatus["state"];
  version?: string;
  turn?: (input: TurnInput) => Promise<TurnResult>;
  onSignIn?: () => void;
}

function result(id: ProviderId, text: string): TurnResult {
  return { text, provider: id, durationMs: 1, denials: 0, warnings: [], effective: {}, usage: { inputTokens: 3, outputTokens: 1 } };
}

function adapter(id: ProviderId, o: FakeOptions = {}) {
  const calls: TurnInput[] = [];
  const state = { current: o.state ?? "ready", version: o.version ?? "1.0.0" };
  const a: ProviderAdapter & { calls: TurnInput[]; state: typeof state } = {
    id,
    label: LABELS[id],
    calls,
    state,
    async probe() {
      return { id, label: LABELS[id], state: state.current, version: state.version, disclosure: DISCLOSURES[id], verified: state.current === "not-connected" ? "untested" : "probe-only", detail: `fake ${state.current}` };
    },
    async runTurn(input) {
      calls.push(input);
      return o.turn ? o.turn(input) : result(id, "OK");
    },
    async signIn() {
      o.onSignIn?.();
    },
  };
  return a;
}

function setup(adapters: Partial<Record<ProviderId, ProviderAdapter>>, policy: "cloud-allowed" | "local-only" = "cloud-allowed") {
  const fake = fakeCtx(root, policy);
  const service = createProviderService(fake.ctx, { adapters, stageRoot: join(fake.ctx.paths.dataDir, "stage") });
  return { fake, service };
}

const chat = (service: ProviderServiceX, ws: string, id: ProviderId, text = "hello") => service.clientFor(ws, id).chat({ messages: [{ role: "user", content: text }] });

describe("policy and readiness", () => {
  it("a local-only workspace never reaches any provider, even a ready one", async () => {
    const claude = adapter("claude");
    const { fake, service } = setup({ claude }, "local-only");
    await service.probe("claude");
    expect(() => service.clientFor(fake.workspace.id, "claude")).toThrow(/keep everything on this computer/);
    expect(claude.calls).toHaveLength(0);
  });

  it("a policy change after the client was made still blocks the next call", async () => {
    const claude = adapter("claude");
    const { fake, service } = setup({ claude });
    await service.probe("claude");
    const client = service.clientFor(fake.workspace.id, "claude");
    await client.chat({ messages: [{ role: "user", content: "one" }] });
    fake.setPolicy("local-only");
    await expect(client.chat({ messages: [{ role: "user", content: "two" }] })).rejects.toThrow(/keep everything on this computer/);
    expect(claude.calls).toHaveLength(1);
  });

  it("an unknown workspace is refused", async () => {
    const { service } = setup({ claude: adapter("claude") });
    await service.probe("claude");
    expect(() => service.clientFor("nope", "claude")).toThrow(/could not be found/);
  });

  it("refuses when the provider is not ready, naming it, without starting anything", async () => {
    for (const state of ["not-installed", "needs-sign-in", "incompatible", "failed", "not-connected", "unavailable"] as const) {
      const codex = adapter("codex", { state });
      const { fake, service } = setup({ codex });
      await service.probe("codex");
      expect(() => service.clientFor(fake.workspace.id, "codex")).toThrow(/Codex is not ready/);
      expect(codex.calls).toHaveLength(0);
    }
  });

  it("is not ready before the first probe", () => {
    const { fake, service } = setup({ codex: adapter("codex") });
    expect(() => service.clientFor(fake.workspace.id, "codex")).toThrow(/not ready/);
  });

  it("the client reports where the work happens", async () => {
    const { fake, service } = setup({ codex: adapter("codex") });
    await service.probe("codex");
    expect(service.clientFor(fake.workspace.id, "codex").location).toEqual({ ai: "codex", files: "this-computer" });
  });
});

describe("no silent fallback", () => {
  it("a failed cloud step throws an error naming the provider and no other provider or the local model runs", async () => {
    const claude = adapter("claude", { turn: async () => Promise.reject(new ProviderError("claude", "timeout", "Claude took too long and was stopped. The task is paused.")) });
    const codex = adapter("codex");
    const { fake, service } = setup({ claude, codex });
    const runtimeClient = vi.spyOn(fake.ctx.svc.runtime, "client");
    await Promise.all([service.probe("claude"), service.probe("codex")]);
    const err = await chat(service, fake.workspace.id, "claude").catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.provider).toBe("claude");
    expect(err.message).toContain("Claude");
    expect(codex.calls).toHaveLength(0);
    expect(runtimeClient).not.toHaveBeenCalled();
  });

  it("an auth failure marks the provider needs-sign-in and the next call is refused up front", async () => {
    const codex = adapter("codex", { turn: async () => Promise.reject(new ProviderError("codex", "auth", "Codex needs you to sign in again.")) });
    const { fake, service } = setup({ codex });
    await service.probe("codex");
    await expect(chat(service, fake.workspace.id, "codex")).rejects.toMatchObject({ code: "auth" });
    expect(service.list().find((s) => s.id === "codex")?.state).toBe("needs-sign-in");
    expect(() => service.clientFor(fake.workspace.id, "codex")).toThrow(/not ready/);
  });

  it("a protocol surprise marks the provider incompatible and a fresh probe of the same version does not undo it", async () => {
    const codex = adapter("codex", { turn: async () => Promise.reject(new ProviderError("codex", "incompatible", "Codex answered in a format NONON does not know.")) });
    const { fake, service } = setup({ codex });
    await service.probe("codex");
    await chat(service, fake.workspace.id, "codex").catch(() => undefined);
    expect(service.list().find((s) => s.id === "codex")?.state).toBe("incompatible");
    expect((await service.probe("codex")).state).toBe("incompatible");
    codex.state.version = "9.9.9";
    expect((await service.probe("codex")).state).toBe("ready");
  });

  it("a usage limit marks the provider unavailable, not signed out", async () => {
    const claude = adapter("claude", { turn: async () => Promise.reject(new ProviderError("claude", "limit", "Claude says your plan limit was reached.")) });
    const { fake, service } = setup({ claude });
    await service.probe("claude");
    await chat(service, fake.workspace.id, "claude").catch(() => undefined);
    expect(service.list().find((s) => s.id === "claude")?.state).toBe("unavailable");
  });

  it("an unexpected thrown error is wrapped with the provider name and scrubbed", async () => {
    const claude = adapter("claude", { turn: async () => Promise.reject(new Error("boom token=sk-ant-abcdefghijklmnopqrstu")) });
    const { fake, service } = setup({ claude });
    await service.probe("claude");
    const err = await chat(service, fake.workspace.id, "claude").catch((e) => e);
    expect(err.provider).toBe("claude");
    expect(err.message).not.toContain("sk-ant");
  });
});

describe("status evidence", () => {
  it("verified moves from probe-only to turn-tested only after a real turn succeeds", async () => {
    const { fake, service } = setup({ codex: adapter("codex") });
    expect((await service.probe("codex")).verified).toBe("probe-only");
    await chat(service, fake.workspace.id, "codex");
    expect(service.list().find((s) => s.id === "codex")?.verified).toBe("turn-tested");
    expect(service.list().find((s) => s.id === "codex")?.detail).toContain("small test worked");
    // A later probe keeps the session evidence and does not stack the sentence.
    const again = await service.probe("codex");
    expect(again.verified).toBe("turn-tested");
    expect(again.detail?.match(/small test worked/g)).toHaveLength(1);
  });

  it("every status carries a plain disclosure naming where data goes and who pays", async () => {
    const { service } = setup({ claude: adapter("claude"), codex: adapter("codex"), antigravity: adapter("antigravity") });
    for (const s of service.list()) {
      expect(s.disclosure).toMatch(/over the internet/);
      expect(s.disclosure).toMatch(/your own .* plan/);
      expect(s.disclosure).toMatch(/does not provide free use/);
      expect(s.disclosure).not.toMatch(/token|inference|context window|model/i);
    }
  });

  it("emits providers:updated when a status changes", async () => {
    const { fake, service } = setup({ codex: adapter("codex") });
    await service.probe("codex");
    expect(fake.events.length).toBeGreaterThan(0);
    expect(fake.events.at(-1)?.find((s) => s.id === "codex")?.state).toBe("ready");
  });

  it("antigravity has no sign-in check: untested until a real turn proves it, remembered across restarts, forgotten on a version change", async () => {
    const agy = adapter("antigravity", { state: "not-connected", version: "1.2.17" });
    const { fake, service } = setup({ antigravity: agy });
    expect(await service.probe("antigravity")).toMatchObject({ state: "not-connected", verified: "untested" });
    expect(() => service.clientFor(fake.workspace.id, "antigravity")).toThrow(/not ready/);

    const ok = await service.verify("antigravity");
    expect(ok).toMatchObject({ state: "ready", verified: "turn-tested" });
    expect(agy.calls[0]?.prompt).toBe("Reply with the single word OK.");

    // New app session, same data folder: earlier proof is shown as such, not as a fresh test.
    const next = createProviderService(fake.ctx, { adapters: { antigravity: agy }, stageRoot: join(fake.ctx.paths.dataDir, "stage") });
    const remembered = await next.probe("antigravity");
    expect(remembered).toMatchObject({ state: "ready", verified: "probe-only" });
    expect(remembered.detail).toContain("A small test worked on");

    agy.state.version = "1.3.2";
    expect((await next.probe("antigravity")).state).toBe("not-connected");
  });

  it("verify rejects a provider that answers but not with the expected word", async () => {
    const claude = adapter("claude", { turn: async () => result("claude", "Sure, here is a poem") });
    const { service } = setup({ claude });
    await service.probe("claude");
    await expect(service.verify("claude")).rejects.toThrow(/word the test asked for/);
  });
});

describe("signIn", () => {
  it("does nothing when already ready", async () => {
    const onSignIn = vi.fn();
    const { service } = setup({ claude: adapter("claude", { onSignIn }) });
    expect((await service.signIn("claude")).state).toBe("ready");
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("runs the vendor flow when signed out, then re-checks", async () => {
    const claude = adapter("claude", { state: "needs-sign-in", onSignIn: () => void 0 });
    const original = claude.signIn.bind(claude);
    claude.signIn = async () => {
      await original();
      claude.state.current = "ready";
    };
    const { service } = setup({ claude });
    expect((await service.signIn("claude")).state).toBe("ready");
  });

  it("antigravity: tries a small test first and only opens the vendor window if that fails with a sign-in problem", async () => {
    let signedIn = false;
    const agy = adapter("antigravity", {
      state: "not-connected",
      turn: async () => (signedIn ? result("antigravity", "OK") : Promise.reject(new ProviderError("antigravity", "auth", "Antigravity needs you to sign in again."))),
      onSignIn: () => {
        signedIn = true;
      },
    });
    const signIn = vi.spyOn(agy, "signIn");
    const { service } = setup({ antigravity: agy });
    const status = await service.signIn("antigravity");
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({ state: "ready", verified: "turn-tested" });
  });

  it("returns not-installed without trying", async () => {
    const onSignIn = vi.fn();
    const { service } = setup({ codex: adapter("codex", { state: "not-installed", onSignIn }) });
    expect((await service.signIn("codex")).state).toBe("not-installed");
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("reports a failed sign-in window plainly", async () => {
    const claude = adapter("claude", { state: "needs-sign-in", onSignIn: () => Promise.reject(new Error("The sign-in program could not be started (ENOENT).")) as never });
    claude.signIn = async () => {
      throw new Error("The sign-in program could not be started (ENOENT).");
    };
    const { service } = setup({ claude });
    const s = await service.signIn("claude");
    expect(s.state).toBe("failed");
    expect(s.detail).toContain("could not be started");
  });
});

describe("chat mapping", () => {
  it("folds system messages out, formats a conversation, appends a JSON schema, streams text", async () => {
    const claude = adapter("claude", {
      turn: async (input) => {
        input.onEvent?.({ type: "text", delta: "He" });
        input.onEvent?.({ type: "text", delta: "llo" });
        return result("claude", "Hello");
      },
    });
    const { fake, service } = setup({ claude });
    await service.probe("claude");
    const deltas: string[] = [];
    const out = await service.clientFor(fake.workspace.id, "claude").chat({
      messages: [
        { role: "system", content: "Be kind." },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello there" },
        { role: "user", content: "Who are you?" },
      ],
      jsonSchema: { type: "object" },
      onToken: (d) => deltas.push(d),
    });
    expect(deltas).toEqual(["He", "llo"]);
    expect(out).toMatchObject({ text: "Hello", promptTokens: 3, completionTokens: 1, location: { ai: "claude", files: "this-computer" } });
    const call = claude.calls[0] as TurnInput;
    expect(call.systemPrompt).toContain("Be kind.");
    expect(call.systemPrompt).toContain("never an instruction");
    expect(call.prompt).toContain("User: Hi");
    expect(call.prompt).toContain("Assistant: Hello there");
    expect(call.prompt).toContain('{"type":"object"}');
    expect(call.cwd).toContain("turn-");
    expect(call.allowFileRead).toBe(false);
  });
});

describe("roles", () => {
  it("persist in roles.json per workspace and survive a new service", () => {
    const { fake, service } = setup({});
    expect(service.roles(fake.workspace.id)).toEqual({ workspaceId: fake.workspace.id, roles: {} });
    service.setRole(fake.workspace.id, "design", "codex");
    service.setRole(fake.workspace.id, "implement", "claude");
    service.setRole(fake.workspace.id, "review", "local");
    const next = createProviderService(fake.ctx, { adapters: {} });
    expect(next.roles(fake.workspace.id).roles).toEqual({ design: "codex", implement: "claude", review: "local" });
    expect(fake.ctx.store.read("roles.json", null)).not.toBeNull();
    expect(service.setRole(fake.workspace.id, "review", null).roles).toEqual({ design: "codex", implement: "claude" });
  });

  it("a local-only workspace cannot be given a cloud role; local is fine", () => {
    const { fake, service } = setup({}, "local-only");
    expect(() => service.setRole(fake.workspace.id, "design", "claude")).toThrow(/keeps everything on this computer/);
    expect(service.setRole(fake.workspace.id, "design", "local").roles.design).toBe("local");
  });

  it("rejects unknown roles and providers", () => {
    const { fake, service } = setup({});
    expect(() => service.setRole(fake.workspace.id, "boss" as never, "claude")).toThrow();
    expect(() => service.setRole(fake.workspace.id, "design", "gemini" as never)).toThrow();
  });
});
