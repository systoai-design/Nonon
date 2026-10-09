import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProcedureInput, ProcedureOutcome, ProcedureRunContext, Task } from "../../shared/contracts";
import { CLOUD, type Harness, LOCAL, done, fakeClient, makeHarness, makeProc, writeFile } from "./core/testkit";

let h: Harness;
beforeEach(() => {
  h = makeHarness();
});
afterEach(() => h.cleanup());

const FILE_INPUT: ProcedureInput = { key: "src", label: "Source file", kind: "file", accept: [".csv"] };
const tasks = () => h.ctx.svc.tasks;
const ws = (policy: "local-only" | "cloud-allowed" = "local-only") =>
  h.ctx.svc.workspaces.create({ name: "W", folder: h.folder, pack: "general", policy });
const csv = (name = "in.csv", text = "a,b\n1,2\n") => writeFile(join(h.folder, name), text);

/** Procedure that parks until the task is aborted, so tests can observe and stop a running task. */
function blocking(onStart?: (ctx: ProcedureRunContext) => void) {
  let release: (o: ProcedureOutcome) => void = () => {};
  const started = new Promise<ProcedureRunContext>((ok) => {
    const def = makeProc(
      "block",
      (ctx) => {
        onStart?.(ctx);
        ok(ctx);
        return new Promise<ProcedureOutcome>((res, rej) => {
          release = res;
          ctx.signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true });
        });
      },
      [FILE_INPUT],
    );
    h.registry.set(def.id, def);
  });
  return { started, release: (o: ProcedureOutcome) => release(o) };
}

describe("state machine", () => {
  it("runs inspecting -> running -> validating -> review when changes are staged", async () => {
    const w = ws();
    h.registry.set(
      "p",
      makeProc(
        "p",
        async (ctx) => {
          ctx.step("Reading");
          return done({
            summary: "Found 1 difference",
            proposals: [{ target: ctx.files.src![0]!, edits: [], reason: "r", preview: { title: "t" }, checks: [] }],
            checks: [{ id: "c", label: "ok", status: "pass" }],
          });
        },
        [FILE_INPUT],
      ),
    );
    const first = await tasks().start({ workspaceId: w.id, procedureId: "p", files: { src: [csv()] } });
    expect(first.state).toBe("inspecting");
    expect(first.locations).toEqual(LOCAL);
    expect(first.inputs.src?.[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);

    const end = await tasks().settled(first.id);
    expect(end.state).toBe("review");
    expect(end.proposalIds).toHaveLength(1);
    expect(end.summary).toBe("Found 1 difference");
    expect(end.steps.map((s) => s.label)).toContain("Reading");
    expect(h.taskStates(first.id)).toEqual(["inspecting", "running", "validating", "review"]);
    expect(tasks().list(w.id).map((t) => t.id)).toEqual([first.id]);
  });

  it("completes when nothing is staged", async () => {
    const w = ws();
    h.registry.set("p", makeProc("p", async () => done()));
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p" });
    expect((await tasks().settled(t.id)).state).toBe("complete");
  });

  it("any failing check means needs-attention, even with staged changes", async () => {
    const w = ws();
    h.registry.set(
      "p",
      makeProc("p", async () =>
        done({
          proposals: [{ target: "x", edits: [], reason: "r", preview: { title: "t" }, checks: [] }],
          checks: [{ id: "c", label: "Totals agree", status: "fail", detail: "Off by 3" }],
        }),
      ),
    );
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p" });
    const end = await tasks().settled(t.id);
    expect(end.state).toBe("needs-attention");
    expect(end.checks[0]?.status).toBe("fail");
  });

  it("maps unsupported to needs-attention with the reason as the summary", async () => {
    const w = ws();
    h.registry.set("p", makeProc("p", async () => ({ kind: "unsupported", reason: "Scanned PDFs are not supported.", suggestion: "Export as text." })));
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p" });
    const end = await tasks().settled(t.id);
    expect(end.state).toBe("needs-attention");
    expect(end.summary).toBe("Scanned PDFs are not supported.");
  });

  it("maps a thrown error to failed with a plain message and logs the stack", async () => {
    const w = ws();
    h.registry.set(
      "p",
      makeProc("p", async () => {
        throw new Error("Could not read the sheet\n    at parse (file.ts:1:1)");
      }),
    );
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p" });
    const end = await tasks().settled(t.id);
    expect(end.state).toBe("failed");
    expect(end.error).toBe("Could not read the sheet");
    expect(end.error).not.toMatch(/\bat\b.*file\.ts/);
    expect(h.logs.some((l) => l.includes("file.ts:1:1"))).toBe(true);
  });

  it("flags a result file that is missing instead of reporting success", async () => {
    const w = ws();
    h.registry.set(
      "p",
      makeProc("p", async (ctx) =>
        done({ outputs: [{ path: join(ctx.outputDir, "ghost.csv"), label: "Ghost", kind: "csv" }] }),
      ),
    );
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p" });
    const end = await tasks().settled(t.id);
    expect(end.state).toBe("needs-attention");
    expect(end.outputs).toEqual([]);
    expect(end.checks.some((c) => c.status === "fail" && /ghost\.csv/.test(c.detail ?? ""))).toBe(true);
  });

  it("rejects unknown procedures and missing required inputs in plain words", async () => {
    const w = ws();
    h.registry.set("p", makeProc("p", async () => done(), [FILE_INPUT], { title: "Compare" }));
    await expect(tasks().start({ workspaceId: w.id, procedureId: "nope" })).rejects.toThrow(/does not know/);
    await expect(tasks().start({ workspaceId: w.id, procedureId: "p" })).rejects.toThrow("Compare still needs: Source file.");
    await expect(tasks().start({ workspaceId: w.id, procedureId: "p", files: { src: [writeFile(join(h.folder, "x.txt"))] } })).rejects.toThrow(/needs \.csv/);
  });
});

describe("outputs", () => {
  it("never overwrites: the second write of a name gets a (2) suffix", async () => {
    const w = ws();
    h.registry.set(
      "p",
      makeProc("p", async (ctx) => {
        const a = await ctx.writeOutput("report.csv", "one", "csv");
        const b = await ctx.writeOutput("report.csv", "two", "csv", "Second");
        const c = await ctx.writeOutput("report", "three", "md");
        return done({ outputs: [a, b, c] });
      }),
    );
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p" });
    const end = await tasks().settled(t.id);
    const out = join(h.folder, "NONON Output");
    expect(end.state).toBe("complete");
    expect(end.outputs.map((o) => basename(o.path))).toEqual(["report.csv", "report (2).csv", "report.md"]);
    expect(readFileSync(join(out, "report.csv"), "utf8")).toBe("one");
    expect(readFileSync(join(out, "report (2).csv"), "utf8")).toBe("two");

    const t2 = await tasks().start({ workspaceId: w.id, procedureId: "p" });
    const end2 = await tasks().settled(t2.id);
    expect(end2.outputs.map((o) => basename(o.path))).toEqual(["report (3).csv", "report (4).csv", "report (2).md"]);
    expect(readFileSync(join(out, "report.csv"), "utf8")).toBe("one");
  });

  it("copies a file picked from outside into NONON Output/inputs and hands the procedure the copy", async () => {
    const w = ws();
    const outside = writeFile(join(h.root, "elsewhere", "picked.csv"), "x,y\n9,9\n");
    let seen = "";
    h.registry.set(
      "p",
      makeProc(
        "p",
        async (ctx) => {
          seen = ctx.files.src![0]!;
          return done();
        },
        [FILE_INPUT],
      ),
    );
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p", files: { src: [outside] } });
    await tasks().settled(t.id);
    expect(seen).toBe(join(h.folder, "NONON Output", "inputs", "picked.csv"));
    expect(readFileSync(seen, "utf8")).toBe("x,y\n9,9\n");
    expect(t.inputs.src?.[0]?.path).toBe(seen);
    expect(readFileSync(outside, "utf8")).toBe("x,y\n9,9\n");
  });

  it("refuses to import files from the app's own data folder", async () => {
    const w = ws();
    h.registry.set("p", makeProc("p", async () => done(), [FILE_INPUT]));
    const secret = writeFile(join(h.ctx.paths.dataDir, "secrets.csv"));
    await expect(tasks().start({ workspaceId: w.id, procedureId: "p", files: { src: [secret] } })).rejects.toThrow(/cannot use/);
  });
});

describe("clarification, remember vs one-run", () => {
  function askingProc() {
    const seenAnswers: Record<string, string>[] = [];
    h.registry.set(
      "ask",
      makeProc("ask", async (ctx) => {
        seenAnswers.push({ ...ctx.answers });
        if (!ctx.answers.currency) {
          return { kind: "needs-input", reason: "Which currency?", questions: [{ id: "currency", prompt: "Currency?", kind: "text" }] };
        }
        return done({ summary: `Using ${ctx.answers.currency}` });
      }),
    );
    return seenAnswers;
  }

  it("asks, then re-runs with the answer; a one-run answer is not remembered", async () => {
    const w = ws();
    const seen = askingProc();
    const t = await tasks().start({ workspaceId: w.id, procedureId: "ask" });
    const asked = await tasks().settled(t.id);
    expect(asked.state).toBe("clarifying");
    expect(asked.questions.map((q) => q.id)).toEqual(["currency"]);
    expect(asked.summary).toBe("Which currency?");

    const after = await tasks().answer(t.id, { currency: "PHP" }, false);
    expect(after.state).not.toBe("clarifying");
    const end = await tasks().settled(t.id);
    expect(end.state).toBe("complete");
    expect(end.summary).toBe("Using PHP");
    expect(end.answers).toEqual({ currency: "PHP" });
    expect(seen[1]).toEqual({ currency: "PHP" });
    expect(h.ctx.store.read("prefs.json", {})).toEqual({});

    const t2 = await tasks().start({ workspaceId: w.id, procedureId: "ask" });
    expect((await tasks().settled(t2.id)).state).toBe("clarifying");
    expect(seen[2]).toEqual({});
  });

  it("remember:true persists the answer and pre-merges it into later runs of the same workspace and procedure", async () => {
    const w = ws();
    const other = h.ctx.svc.workspaces.create({ name: "Other", folder: h.folder, pack: "general" });
    const seen = askingProc();
    const t = await tasks().start({ workspaceId: w.id, procedureId: "ask" });
    await tasks().settled(t.id);
    await tasks().answer(t.id, { currency: "EUR" }, true);
    await tasks().settled(t.id);
    expect(h.ctx.store.read("prefs.json", {})).toEqual({ [`${w.id}:ask`]: { currency: "EUR" } });

    const t2 = await tasks().start({ workspaceId: w.id, procedureId: "ask" });
    const end2 = await tasks().settled(t2.id);
    expect(end2.state).toBe("complete");
    expect(end2.summary).toBe("Using EUR");
    expect(end2.answers).toEqual({});
    expect(seen.at(-1)).toEqual({ currency: "EUR" });

    const t3 = await tasks().start({ workspaceId: other.id, procedureId: "ask" });
    expect((await tasks().settled(t3.id)).state).toBe("clarifying");
  });

  it("refuses to answer a task that is not asking", async () => {
    const w = ws();
    h.registry.set("p", makeProc("p", async () => done()));
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p" });
    await tasks().settled(t.id);
    await expect(tasks().answer(t.id, { a: "b" })).rejects.toThrow(/not waiting for an answer/);
  });
});

describe("stop, resume, checkpoints", () => {
  it("stop aborts and marks the task interrupted; the late result is discarded", async () => {
    const w = ws();
    const b = blocking();
    const t = await tasks().start({ workspaceId: w.id, procedureId: "block", files: { src: [csv()] } });
    await b.started;
    const stopped = tasks().stop(t.id);
    expect(stopped.state).toBe("interrupted");
    b.release(done({ summary: "too late" }));
    await new Promise((r) => setTimeout(r, 20));
    const now = tasks().get(t.id)!;
    expect(now.state).toBe("interrupted");
    expect(now.summary).toBeUndefined();
    expect((await tasks().settled(t.id)).state).toBe("interrupted");
  });

  it("resume skips work that a checkpoint already covers", async () => {
    const w = ws();
    const runs: (string | undefined)[] = [];
    let attempt = 0;
    h.registry.set(
      "cp",
      makeProc(
        "cp",
        async (ctx) => {
          attempt += 1;
          runs.push(ctx.checkpoint<string>("parsed"));
          if (attempt === 1) {
            ctx.saveCheckpoint("parsed", "rows:2");
            return new Promise<ProcedureOutcome>((_res, rej) => ctx.signal.addEventListener("abort", () => rej(new Error("aborted"))));
          }
          return done({ summary: `reused ${ctx.checkpoint<string>("parsed")}` });
        },
        [FILE_INPUT],
      ),
    );
    const t = await tasks().start({ workspaceId: w.id, procedureId: "cp", files: { src: [csv()] } });
    await new Promise((r) => setTimeout(r, 20));
    tasks().stop(t.id);
    const resumed = await tasks().resume(t.id);
    expect(resumed.state).toBe("running");
    const end = await tasks().settled(t.id);
    expect(end.state).toBe("complete");
    expect(end.summary).toBe("reused rows:2");
    expect(runs).toEqual([undefined, "rows:2"]);
    expect(JSON.parse(readFileSync(h.ctx.store.path(`tasks/${t.id}.json`), "utf8")).checkpoints.parsed).toBe("rows:2");
  });

  it("resume refuses to continue silently when an input changed, naming the file", async () => {
    const w = ws();
    const b = blocking();
    const file = csv("ledger.csv");
    const t = await tasks().start({ workspaceId: w.id, procedureId: "block", files: { src: [file] } });
    await b.started;
    tasks().stop(t.id);
    writeFileSync(file, "a,b\n1,999\n");

    const flagged = await tasks().resume(t.id);
    expect(flagged.state).toBe("needs-attention");
    expect(flagged.summary).toContain('"ledger.csv" changed');
    expect(flagged.questions[0]?.id).toBe("restartOnChange");
    expect(tasks().get(t.id)?.state).toBe("needs-attention");
  });

  it("a restartOnChange answer re-fingerprints, clears checkpoints and runs again", async () => {
    const w = ws();
    const file = csv("ledger.csv");
    let runs = 0;
    const seen: unknown[] = [];
    h.registry.set(
      "p",
      makeProc(
        "p",
        async (ctx) => {
          runs += 1;
          seen.push(ctx.checkpoint("old"));
          if (runs === 1) {
            ctx.saveCheckpoint("old", "stale");
            return { kind: "needs-input", reason: "Which?", questions: [{ id: "q", prompt: "?", kind: "text" }] };
          }
          return done({ summary: "fresh" });
        },
        [FILE_INPUT],
      ),
    );
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p", files: { src: [file] } });
    expect((await tasks().settled(t.id)).state).toBe("clarifying");
    writeFileSync(file, "a,b\n5,5\n");

    const flagged = await tasks().answer(t.id, { q: "x" });
    expect(flagged.state).toBe("needs-attention");
    expect(runs).toBe(1);

    const declined = await tasks().answer(t.id, { restartOnChange: "no" });
    expect(declined.state).toBe("interrupted");
    expect((await tasks().resume(t.id)).state).toBe("needs-attention");

    await tasks().answer(t.id, { restartOnChange: "yes" });
    const end = await tasks().settled(t.id);
    expect(end.state).toBe("complete");
    expect(end.summary).toBe("fresh");
    expect(seen.at(-1)).toBeUndefined();
    expect(end.answers).toEqual({ q: "x" });
    const stored = JSON.parse(readFileSync(h.ctx.store.path(`tasks/${t.id}.json`), "utf8")) as Task;
    expect(stored.inputs.src?.[0]?.sha256).not.toBe(t.inputs.src?.[0]?.sha256);
  });

  it("treats a deleted input as a change", async () => {
    const w = ws();
    const b = blocking();
    const file = csv("gone.csv");
    const t = await tasks().start({ workspaceId: w.id, procedureId: "block", files: { src: [file] } });
    await b.started;
    tasks().stop(t.id);
    const { rmSync } = await import("node:fs");
    rmSync(file);
    expect((await tasks().resume(t.id)).summary).toContain('"gone.csv"');
  });

  it("will not start a second run of a task that is already running", async () => {
    const w = ws();
    const b = blocking();
    const t = await tasks().start({ workspaceId: w.id, procedureId: "block", files: { src: [csv()] } });
    await b.started;
    await expect(tasks().resume(t.id)).rejects.toThrow(/already running/);
    tasks().stop(t.id);
  });
});

describe("recoverInterrupted", () => {
  it("turns tasks left in running states into interrupted with a step, and leaves finished ones alone", () => {
    const w = ws();
    const base = (id: string, state: Task["state"]): Task => ({
      id,
      workspaceId: w.id,
      procedureId: "p",
      procedureRevision: "1",
      title: id,
      state,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      inputs: {},
      text: {},
      answers: {},
      questions: [],
      steps: [],
      checkpoints: { keep: 1 },
      outputs: [],
      proposalIds: [],
      checks: [],
      locations: LOCAL,
    });
    for (const [id, state] of [
      ["t_inspecting", "inspecting"],
      ["t_running", "running"],
      ["t_validating", "validating"],
      ["t_applying", "applying"],
      ["t_complete", "complete"],
      ["t_review", "review"],
    ] as const) {
      h.ctx.store.write(`tasks/${id}.json`, base(id, state));
    }
    tasks().recoverInterrupted();
    const states = Object.fromEntries(tasks().list(w.id).map((t) => [t.id, t.state]));
    expect(states).toEqual({
      t_inspecting: "interrupted",
      t_running: "interrupted",
      t_validating: "interrupted",
      t_applying: "interrupted",
      t_complete: "complete",
      t_review: "review",
    });
    const t = tasks().get("t_running")!;
    expect(t.steps.at(-1)?.label).toBe("The app closed while this was running");
    expect(t.checkpoints).toEqual({ keep: 1 });
    expect(readdirSync(join(h.ctx.store.dir, "tasks"))).toHaveLength(6);
  });

  it("a restarted service reads tasks written by the previous one", async () => {
    const w = ws();
    h.registry.set("p", makeProc("p", async () => done({ summary: "persisted" })));
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p" });
    await tasks().settled(t.id);
    const { createTaskService } = await import("./tasks");
    const fresh = createTaskService(h.ctx);
    expect(fresh.get(t.id)).toMatchObject({ state: "complete", summary: "persisted" });
  });
});

describe("AI choice and local-only policy", () => {
  const cloud = () => fakeClient(CLOUD);

  it("refuses a connected-AI client in a local-only workspace", async () => {
    const w = ws("local-only");
    h.registry.set("p", makeProc("p", async () => done()));
    await expect(tasks().start({ workspaceId: w.id, procedureId: "p", ai: cloud() })).rejects.toThrow(/keeps everything on this computer/);
    expect(tasks().list(w.id)).toEqual([]);
  });

  it("allows a local client in a local-only workspace and a cloud client when the policy allows it", async () => {
    const strict = ws("local-only");
    const open = h.ctx.svc.workspaces.create({ name: "Open", folder: h.folder, pack: "general", policy: "cloud-allowed" });
    const used: string[] = [];
    h.registry.set("p", makeProc("p", async (ctx) => (used.push(ctx.ai.location.ai), done())));

    const a = await tasks().start({ workspaceId: strict.id, procedureId: "p", ai: fakeClient(LOCAL) });
    const b = await tasks().start({ workspaceId: open.id, procedureId: "p", ai: cloud() });
    expect(a.locations.ai).toBe("local");
    expect(b.locations.ai).toBe("claude");
    await tasks().settled(a.id);
    await tasks().settled(b.id);
    expect(used).toEqual(["local", "claude"]);
  });

  it("falls back to the local client on re-run if the workspace became local-only after a cloud task started", async () => {
    const open = h.ctx.svc.workspaces.create({ name: "Open", folder: h.folder, pack: "general", policy: "cloud-allowed" });
    const used: string[] = [];
    let n = 0;
    h.registry.set(
      "p",
      makeProc("p", async (ctx) => {
        used.push(ctx.ai.location.ai);
        n += 1;
        return n === 1 ? { kind: "needs-input", reason: "?", questions: [{ id: "q", prompt: "?", kind: "text" }] } : done();
      }),
    );
    const t = await tasks().start({ workspaceId: open.id, procedureId: "p", ai: cloud() });
    await tasks().settled(t.id);
    h.ctx.svc.workspaces.update(open.id, { policy: "local-only" });
    await tasks().answer(t.id, { q: "a" });
    await tasks().settled(t.id);
    expect(used).toEqual(["claude", "local"]);
    expect(tasks().get(t.id)?.locations.ai).toBe("local");
  });

  it("waits, instead of failing, while the local AI is not ready, then runs by itself", async () => {
    const w = ws();
    h.runtime.ready = false;
    h.registry.set("p", makeProc("p", async () => done({ summary: "ran" })));
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p" });
    expect(tasks().get(t.id)).toMatchObject({ state: "waiting", waitingOn: "the AI on this computer to finish setting up" });
    await new Promise((r) => setTimeout(r, 120));
    expect(tasks().get(t.id)?.state).toBe("waiting");

    h.runtime.ready = true;
    await new Promise((r) => setTimeout(r, 900));
    const end = tasks().get(t.id)!;
    expect(end.state).toBe("complete");
    expect(end.waitingOn).toBeUndefined();
    expect(h.taskStates(t.id)).toEqual(["inspecting", "waiting", "running", "validating", "complete"]);
  });

  it("stopping a waiting task ends the wait", async () => {
    const w = ws();
    h.runtime.ready = false;
    h.registry.set("p", makeProc("p", async () => done()));
    const t = await tasks().start({ workspaceId: w.id, procedureId: "p" });
    expect(tasks().stop(t.id).state).toBe("interrupted");
    h.runtime.ready = true;
    await new Promise((r) => setTimeout(r, 700));
    expect(tasks().get(t.id)?.state).toBe("interrupted");
  });

  it("a procedure that ignores the stop signal cannot create files afterwards", async () => {
    const w = ws();
    let late: Promise<unknown> = Promise.resolve();
    const b = blocking((ctx) => {
      late = new Promise((r) => setTimeout(r, 30)).then(() => ctx.writeOutput("late.csv", "x", "csv")).catch((e: Error) => e.message);
    });
    const t = await tasks().start({ workspaceId: w.id, procedureId: "block", files: { src: [csv()] } });
    await b.started;
    tasks().stop(t.id);
    expect(await late).toBe("This job was stopped.");
    expect(existsSync(join(h.folder, "NONON Output", "late.csv"))).toBe(false);
  });
});
