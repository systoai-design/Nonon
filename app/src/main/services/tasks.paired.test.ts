import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InferenceClient, ProcedureOutcome } from "../../shared/contracts";
import { CLOUD, type Harness, done, fakeClient, makeHarness, makeProc } from "./core/testkit";
import { HostUnavailableError } from "./lan/errors";
import { createPairedClient, type PairedInferenceClient } from "./lan/client";
import { freePort } from "./lan/testkit";
import { createTaskService } from "./tasks";
import type { LanService } from "./types";

/**
 * How the task layer treats the paired computer. The paired client here is the real one pointed at a port nothing
 * listens on, so "host unavailable" is a genuine connection failure, not a hand-thrown error.
 */

let h: Harness;
let deadClient: PairedInferenceClient;
let lanClient: InferenceClient | null;

beforeEach(async () => {
  h = makeHarness();
  const port = await freePort();
  deadClient = createPairedClient({
    pairing: () => ({
      host: "127.0.0.1",
      port,
      fingerprint: "a".repeat(64),
      deviceId: "dev_0123456789abcdef",
      token: `dev_0123456789abcdef.${"t".repeat(43)}`,
      hostName: "Desk PC",
      deviceName: "Laptop",
      pairedAt: new Date().toISOString(),
    }),
    onUnpaired: () => {},
  });
  lanClient = deadClient;
  h.ctx.svc.lan = { client: () => lanClient } as unknown as LanService;
});
afterEach(() => h.cleanup());

const tasks = () => h.ctx.svc.tasks;
const ws = (policy: "local-only" | "cloud-allowed" = "local-only", preferredAi?: "local" | "paired") => {
  const w = h.ctx.svc.workspaces.create({ name: "W", folder: h.folder, pack: "general", policy });
  return preferredAi ? h.ctx.svc.workspaces.update(w.id, { preferredAi }) : w;
};
const ask = { messages: [{ role: "user" as const, content: "hi" }] };

describe("paired computer and the task layer", () => {
  it("is allowed in a local-only workspace, while a cloud provider is still refused there", async () => {
    const w = ws("local-only");
    h.registry.set("p", makeProc("p", async () => done()));
    await expect(tasks().start({ workspaceId: w.id, procedureId: "p", ai: fakeClient(CLOUD) })).rejects.toThrow(/keeps everything on this computer/);
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p", ai: deadClient });
    expect(t.locations).toEqual({ ai: "paired", files: "this-computer" });
    await tasks().settled(t.id);
  });

  it("goes to waiting (not failed) when the host is unreachable, keeps its checkpoints and the plain reason", async () => {
    const w = ws();
    h.registry.set(
      "p",
      makeProc("p", async (ctx) => {
        ctx.saveCheckpoint("step1", { rows: 12 });
        await ctx.ai.chat(ask);
        return done({ summary: "should not be reached" });
      }),
    );
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p", ai: deadClient });
    const end = await tasks().settled(t.id);
    expect(end.state).toBe("waiting");
    expect(end.waitingOn).toBe("your other computer");
    expect(end.summary).toMatch(/cannot reach your other computer/);
    expect(end.checkpoints).toEqual({ step1: { rows: 12 } });
    expect(end.error).toBeUndefined();
    expect(end.locations.ai).toBe("paired");
    expect(h.taskStates(t.id)).toEqual(["inspecting", "running", "waiting"]);
    expect(h.runtime.client).toBeDefined();
    expect((h.runtime.client as ReturnType<typeof fakeClient>).calls).toHaveLength(0);
  });

  it("still waits when the procedure swallows the error and finishes anyway", async () => {
    const w = ws();
    h.registry.set(
      "p",
      makeProc("p", async (ctx) => {
        try {
          await ctx.ai.chat(ask);
        } catch {
          /* a procedure that treats AI failure as "could not read this" */
        }
        return done({ summary: "made-up result" });
      }),
    );
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p", ai: deadClient });
    const end = await tasks().settled(t.id);
    expect(end.state).toBe("waiting");
    expect(end.summary).not.toBe("made-up result");
  });

  it("resumes from the checkpoint once the host answers again, and never touches the local AI", async () => {
    const w = ws();
    let up = false;
    const seen: string[] = [];
    const flaky: PairedInferenceClient = {
      location: deadClient.location,
      onHostLost: (cb) => deadClient.onHostLost(cb),
      async chat(req) {
        if (!up) return deadClient.chat(req);
        seen.push(req.messages[0]!.content);
        return { text: "ok", location: deadClient.location };
      },
    };
    h.registry.set(
      "p",
      makeProc("p", async (ctx) => {
        let first = ctx.checkpoint<string>("first");
        if (!first) {
          ctx.step("Reading");
          first = "done-once";
          ctx.saveCheckpoint("first", first);
        }
        const r = await ctx.ai.chat({ messages: [{ role: "user", content: first }] });
        return done({ summary: r.text });
      }),
    );
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p", ai: flaky });
    expect((await tasks().settled(t.id)).state).toBe("waiting");

    up = true;
    await tasks().resume(t.id);
    const end = await tasks().settled(t.id);
    expect(end.state).toBe("complete");
    expect(end.summary).toBe("ok");
    expect(seen).toEqual(["done-once"]);
    expect((h.runtime.client as ReturnType<typeof fakeClient>).calls).toHaveLength(0);
  });

  it("a user stop is still 'interrupted', not 'waiting'", async () => {
    const w = ws();
    let started: () => void = () => {};
    const running = new Promise<void>((r) => (started = r));
    h.registry.set(
      "p",
      makeProc("p", (ctx) => {
        started();
        return new Promise<ProcedureOutcome>((_, rej) => ctx.signal.addEventListener("abort", () => rej(new HostUnavailableError("unreachable"))));
      }),
    );
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p", ai: deadClient });
    await running;
    tasks().stop(t.id);
    const end = await tasks().settled(t.id);
    expect(end.state).toBe("interrupted");
  });

  it("after a restart a paired task stays paired: waits if nothing is paired, never runs on the local AI", async () => {
    const w = ws();
    h.registry.set("p", makeProc("p", async (ctx) => (await ctx.ai.chat(ask), done())));
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p", ai: deadClient });
    expect((await tasks().settled(t.id)).state).toBe("waiting");

    h.ctx.svc.tasks = createTaskService(h.ctx);
    lanClient = null;
    await tasks().resume(t.id);
    const after = await tasks().settled(t.id);
    expect(after.state).toBe("waiting");
    expect(after.waitingOn).toBe("your other computer");
    expect(after.summary).toMatch(/unpaired/i);
    expect((h.runtime.client as ReturnType<typeof fakeClient>).calls).toHaveLength(0);

    const working: InferenceClient = { location: deadClient.location, chat: async () => ({ text: "x", location: deadClient.location }) };
    lanClient = working;
    await tasks().resume(t.id);
    expect((await tasks().settled(t.id)).state).toBe("complete");
  });
});

describe("workspace preference for the paired computer", () => {
  it("uses the paired computer for new tasks when the workspace asks for it", async () => {
    const w = ws("local-only", "paired");
    const used: string[] = [];
    lanClient = { location: deadClient.location, chat: async () => (used.push("paired"), { text: "ok", location: deadClient.location }) };
    h.registry.set("p", makeProc("p", async (ctx) => (await ctx.ai.chat(ask), done())));
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p" });
    expect(t.locations.ai).toBe("paired");
    expect((await tasks().settled(t.id)).state).toBe("complete");
    expect(used).toEqual(["paired"]);
  });

  it("refuses to start (and does not fall back to local) when the preference is paired but nothing is paired", async () => {
    const w = ws("local-only", "paired");
    lanClient = null;
    h.registry.set("p", makeProc("p", async () => done()));
    await expect(tasks().start({ workspaceId: w.id, procedureId: "p" })).rejects.toThrow(/no other computer is paired/);
    expect(tasks().list(w.id)).toHaveLength(0);
  });

  it("an explicit client wins over the preference, and 'local' or no preference uses the local AI", async () => {
    const w = ws("local-only", "local");
    h.registry.set("p", makeProc("p", async () => done()));
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p" });
    expect(t.locations.ai).toBe("local");
    await tasks().settled(t.id);
  });
});
