import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InferenceClient, InferenceRequest, ProcedureInput } from "../../shared/contracts";
import { type Harness, done, fakeClient, makeHarness, makeProc, writeFile } from "./core/testkit";

let h: Harness;
beforeEach(() => {
  h = makeHarness();
});
afterEach(() => h.cleanup());

const SHEET = [".csv", ".xlsx"];
const compareInputs: ProcedureInput[] = [
  { key: "left", label: "First spreadsheet", kind: "file", accept: SHEET },
  { key: "right", label: "Second spreadsheet", kind: "file", accept: SHEET },
];
const notesInputs: ProcedureInput[] = [{ key: "notes", label: "Meeting notes", kind: "file", accept: [".txt", ".md", ".docx"] }];

function setup(pack: "bookkeeping" | "general" = "bookkeeping") {
  const ws = h.ctx.svc.workspaces.create({ name: "Books", folder: h.folder, pack });
  const started: { id: string; files: Record<string, string[]> }[] = [];
  const add = (id: string, inputs: ProcedureInput[], extra: Partial<Parameters<typeof makeProc>[3]> = {}) =>
    h.registry.set(
      id,
      makeProc(
        id,
        async (ctx) => {
          started.push({ id, files: ctx.files });
          return done();
        },
        inputs,
        { pack: "bookkeeping", title: id === "spreadsheet-compare" ? "Compare spreadsheets" : id, summary: `${id} summary`, ...extra },
      ),
    );
  add("spreadsheet-compare", compareInputs);
  add("meeting-followup", notesInputs);
  add("study-packet", notesInputs);
  return { ws, started };
}

describe("routing without a model (deterministic fallback)", () => {
  beforeEach(() => {
    h.runtime.ready = false;
  });

  it("two spreadsheets and the word compare start spreadsheet-compare with both files mapped in order", async () => {
    const { ws } = setup();
    const a = writeFile(join(h.folder, "bank.csv"));
    const b = writeFile(join(h.folder, "ledger.csv"));
    const added = await h.ctx.svc.chat.send(ws.id, "Please compare these two", [a, b]);
    expect(added.map((e) => e.role)).toEqual(["user", "companion"]);
    expect(added[0]?.attachments?.map((x) => x.name)).toEqual(["bank.csv", "ledger.csv"]);
    const taskId = added[1]!.taskId!;
    expect(taskId).toBeTruthy();
    const task = h.ctx.svc.tasks.get(taskId)!;
    expect(task.procedureId).toBe("spreadsheet-compare");
    expect(task.inputs.left?.[0]?.path).toBe(a);
    expect(task.inputs.right?.[0]?.path).toBe(b);
    expect(task.state).toBe("waiting");
    expect(added[1]!.text).toMatch(/still getting ready/);
  });

  it("finds files named in the message even when none are attached", async () => {
    const { ws } = setup();
    const a = writeFile(join(h.folder, "bank.csv"));
    const b = writeFile(join(h.folder, "ledger.xlsx"), "fake");
    const added = await h.ctx.svc.chat.send(ws.id, "does ledger.xlsx match bank.csv?");
    const task = h.ctx.svc.tasks.get(added[1]!.taskId!)!;
    expect(task.inputs.left?.[0]?.path).toBe(b);
    expect(task.inputs.right?.[0]?.path).toBe(a);
  });

  it("asks for the missing files instead of starting", async () => {
    const { ws, started } = setup();
    const a = writeFile(join(h.folder, "bank.csv"));
    const added = await h.ctx.svc.chat.send(ws.id, "reconcile my bank statement", [a]);
    expect(added).toHaveLength(2);
    expect(added[1]!.taskId).toBeUndefined();
    expect(added[1]!.text).toBe('I can do that with "Compare spreadsheets". Add Second spreadsheet (.csv or .xlsx), then send your request again.');
    expect(h.ctx.svc.tasks.list(ws.id)).toEqual([]);
    expect(started).toEqual([]);
  });

  it("picks meeting-followup and study-packet from keywords and the attached notes", async () => {
    const { ws } = setup();
    const notes = writeFile(join(h.folder, "notes.txt"), "we agreed");
    const m = await h.ctx.svc.chat.send(ws.id, "turn my meeting notes into action items", [notes]);
    expect(h.ctx.svc.tasks.get(m[1]!.taskId!)?.procedureId).toBe("meeting-followup");
    const s = await h.ctx.svc.chat.send(ws.id, "make a quiz and flashcards from this", [notes]);
    expect(h.ctx.svc.tasks.get(s[1]!.taskId!)?.procedureId).toBe("study-packet");
  });

  it("never picks a procedure that is not registered", async () => {
    const ws = h.ctx.svc.workspaces.create({ name: "W", folder: h.folder, pack: "general" });
    const added = await h.ctx.svc.chat.send(ws.id, "compare these spreadsheets please");
    expect(added[1]!.taskId).toBeUndefined();
    expect(added[1]!.text).toMatch(/still getting set up/);
  });

  it("with no model and no match, says so plainly and does not pretend to have chatted", async () => {
    setup();
    const ws = h.ctx.svc.workspaces.list()[0]!;
    const added = await h.ctx.svc.chat.send(ws.id, "hello there");
    expect(added[1]!.text).toBe(
      "I am still getting set up, so I cannot chat just yet. You can start a job from the cards, or attach your files and ask again in a moment.",
    );
  });
});

describe("routing with the local model", () => {
  it("forces a JSON schema with the registered ids plus none, and only sends titles, summaries and file names", async () => {
    const { ws } = setup();
    const a = writeFile(join(h.folder, "bank.csv"), "secret,cell\n42,43\n");
    const b = writeFile(join(h.folder, "ledger.csv"));
    const client = fakeClient(undefined, () => JSON.stringify({ procedureId: "spreadsheet-compare", reason: "two sheets" }));
    h.runtime.client = client;
    const added = await h.ctx.svc.chat.send(ws.id, "line these up for me", [a, b]);
    expect(h.ctx.svc.tasks.get(added[1]!.taskId!)?.procedureId).toBe("spreadsheet-compare");

    const req = client.calls[0]!;
    const schema = req.jsonSchema as { properties: { procedureId: { enum: string[] } }; required: string[] };
    expect(schema.properties.procedureId.enum.sort()).toEqual(["meeting-followup", "none", "spreadsheet-compare", "study-packet"]);
    expect(schema.required).toEqual(["procedureId", "reason"]);
    const sent = JSON.stringify(req.messages);
    expect(sent).toContain("bank.csv");
    expect(sent).toContain("spreadsheet-compare summary");
    expect(sent).not.toContain("secret,cell");
  });

  it("falls back to the keyword rules when the model answers none", async () => {
    const { ws } = setup();
    const a = writeFile(join(h.folder, "bank.csv"));
    const b = writeFile(join(h.folder, "ledger.csv"));
    h.runtime.client = fakeClient(undefined, () => JSON.stringify({ procedureId: "none", reason: "unsure" }));
    const added = await h.ctx.svc.chat.send(ws.id, "compare them", [a, b]);
    expect(h.ctx.svc.tasks.get(added[1]!.taskId!)?.procedureId).toBe("spreadsheet-compare");
  });

  it("retries once on an unusable answer, then falls back to the rules", async () => {
    const { ws } = setup();
    const a = writeFile(join(h.folder, "bank.csv"));
    const b = writeFile(join(h.folder, "ledger.csv"));
    const client = fakeClient(undefined, () => "I think compare");
    h.runtime.client = client;
    const added = await h.ctx.svc.chat.send(ws.id, "please reconcile", [a, b]);
    expect(client.calls).toHaveLength(2);
    expect(h.ctx.svc.tasks.get(added[1]!.taskId!)?.procedureId).toBe("spreadsheet-compare");
  });

  it("answers conversationally in a few sentences when no job fits, grounded in the workspace file names", async () => {
    const { ws } = setup();
    writeFile(join(h.folder, "budget.xlsx"), "x");
    const client = fakeClient(undefined, (req) =>
      req.jsonSchema ? JSON.stringify({ procedureId: "none", reason: "chat" }) : "You have one file called budget.xlsx. Tell me what to do with it. I can compare it with another sheet. Extra sentence here.",
    );
    h.runtime.client = client;
    const added = await h.ctx.svc.chat.send(ws.id, "what files do I have?");
    expect(added[1]!.taskId).toBeUndefined();
    expect(added[1]!.text).toBe("You have one file called budget.xlsx. Tell me what to do with it. I can compare it with another sheet.");
    const chatReq = client.calls.find((c) => !c.jsonSchema)!;
    expect(JSON.stringify(chatReq.messages)).toContain("budget.xlsx");
  });

  it("does not pass off a reply that claims finished work", async () => {
    const { ws } = setup();
    h.runtime.client = fakeClient(undefined, (req) =>
      req.jsonSchema ? JSON.stringify({ procedureId: "none", reason: "chat" }) : "I have already compared everything and saved the report.",
    );
    const added = await h.ctx.svc.chat.send(ws.id, "how is it going?");
    expect(added[1]!.text).not.toMatch(/compared everything/);
    expect(added[1]!.text).toMatch(/not sure how to help/);
    expect(added[1]!.text).toContain("Compare spreadsheets");
  });

  it("local-only workspaces only ever talk to the local client", async () => {
    const { ws } = setup();
    const client = fakeClient(undefined, () => JSON.stringify({ procedureId: "none", reason: "" }));
    h.runtime.client = client;
    await h.ctx.svc.chat.send(ws.id, "hello");
    expect(client.calls.every((c) => c.messages.length > 0)).toBe(true);
    expect(client.location.ai).toBe("local");
  });
});

describe("schedules", () => {
  it("routes a recurring request to the scheduler and attaches the proposed routine", async () => {
    const { ws } = setup();
    const added = await h.ctx.svc.chat.send(ws.id, "Every weekday at 8 make me a summary of the newest notes");
    expect(h.proposals).toEqual([{ workspaceId: ws.id, text: "Every weekday at 8 make me a summary of the newest notes" }]);
    expect(added).toHaveLength(2);
    expect(added[1]!.routine?.schedule.humanText).toBe("Every weekday at 8:00 AM");
    expect(added[1]!.taskId).toBeUndefined();
    expect(h.ctx.svc.tasks.list(ws.id)).toEqual([]);
  });

  it.each(["each Monday please do the report", "run this daily", "Weekly summary of my notes"])("recognises %s", async (text) => {
    const { ws } = setup();
    await h.ctx.svc.chat.send(ws.id, text);
    expect(h.proposals).toHaveLength(1);
  });

  it("does not treat an ordinary request as a schedule", async () => {
    const { ws } = setup();
    h.runtime.ready = false;
    await h.ctx.svc.chat.send(ws.id, "compare every row in these sheets");
    expect(h.proposals).toEqual([]);
  });
});

describe("history and persistence", () => {
  it("persists entries, emits chat:entry for each, and survives a new service instance", async () => {
    const { ws } = setup();
    h.runtime.ready = false;
    const added = await h.ctx.svc.chat.send(ws.id, "hello");
    const emitted = h.events.filter((e) => e.event === "chat:entry").map((e) => (e.payload as { id: string }).id);
    expect(emitted).toEqual(added.map((e) => e.id));
    const { createChatService } = await import("./chat");
    const fresh = createChatService(h.ctx);
    expect(fresh.history(ws.id).map((e) => e.id)).toEqual(added.map((e) => e.id));
    expect(fresh.history("other")).toEqual([]);
  });

  it("rejects an empty message and an unknown workspace in plain words", async () => {
    const { ws } = setup();
    await expect(h.ctx.svc.chat.send(ws.id, "   ")).rejects.toThrow("Type a message first.");
    await expect(h.ctx.svc.chat.send("nope", "hi")).rejects.toThrow(/no longer exists/);
  });

  it("explains a start failure instead of faking progress", async () => {
    const { ws } = setup();
    h.runtime.ready = false;
    const odd = writeFile(join(h.folder, "bank.txt"));
    const added = await h.ctx.svc.chat.send(ws.id, "compare these", [odd, odd]);
    expect(added[1]!.taskId).toBeUndefined();
    expect(added[1]!.text).toMatch(/Add First spreadsheet/);
    expect(basename(odd)).toBe("bank.txt");
  });
});

describe("streaming replies", () => {
  /** Answers the routing call with "none", then writes its chat reply piece by piece through onToken. */
  function streamingClient(pieces: string[], gate?: Promise<void>): InferenceClient {
    return {
      location: { ai: "local", files: "this-computer" },
      async chat(req: InferenceRequest) {
        if (req.jsonSchema) return { text: JSON.stringify({ procedureId: "none", reason: "chat" }), location: this.location };
        let text = "";
        for (const piece of pieces) {
          if (gate && text) await Promise.race([gate, new Promise((_, no) => req.signal?.addEventListener("abort", () => no(new Error("aborted"))))]);
          text += piece;
          req.onToken?.(piece);
        }
        return { text, location: this.location };
      },
    };
  }

  it("emits the reply piece by piece under one entry id, then the whole reply as the final entry", async () => {
    const { ws } = setup();
    h.runtime.client = streamingClient(["You have ", "one file. ", "Tell me more."]);
    const added = await h.ctx.svc.chat.send(ws.id, "what do I have?");
    const reply = added[1]!;
    const seen = h.events.filter((e) => e.event === "chat:delta" || (e.event === "chat:entry" && (e.payload as { id: string }).id === reply.id));
    expect(seen.map((e) => e.event)).toEqual(["chat:delta", "chat:delta", "chat:delta", "chat:entry"]);
    const deltas = seen.filter((e) => e.event === "chat:delta").map((e) => e.payload as { workspaceId: string; entryId: string; text: string });
    expect(deltas.every((d) => d.entryId === reply.id && d.workspaceId === ws.id)).toBe(true);
    expect(deltas.map((d) => d.text).join("")).toBe("You have one file. Tell me more.");
    expect(reply.text).toBe("You have one file. Tell me more.");
  });

  it("does not stream replies that are not written by the AI", async () => {
    const { ws } = setup();
    h.runtime.ready = false;
    await h.ctx.svc.chat.send(ws.id, "hello");
    expect(h.events.some((e) => e.event === "chat:delta")).toBe(false);
  });

  it("hides reasoning blocks while streaming", async () => {
    const { ws } = setup();
    h.runtime.client = streamingClient(["<think>", "secret plan", "</think>", "Hello there."]);
    await h.ctx.svc.chat.send(ws.id, "hi");
    const shown = h.events.filter((e) => e.event === "chat:delta").map((e) => (e.payload as { text: string }).text);
    expect(shown.join("")).not.toContain("secret plan");
    expect(shown.join("")).toContain("Hello there.");
  });

  it("stop keeps what was written as the final entry and ends the stream", async () => {
    const { ws } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.runtime.client = streamingClient(["Sure, I can ", "help with that. ", "More later."], gate);
    const sending = h.ctx.svc.chat.send(ws.id, "tell me something");
    while (!h.events.some((e) => e.event === "chat:delta")) await new Promise((r) => setTimeout(r, 5));
    h.ctx.svc.chat.stop(ws.id);
    const added = await sending;
    release();
    expect(added[1]!.text).toBe("Sure, I can");
    expect(h.events.filter((e) => e.event === "chat:entry").pop()?.payload).toMatchObject({ id: added[1]!.id });
  });

  it("stop with nothing in flight does nothing", () => {
    setup();
    expect(() => h.ctx.svc.chat.stop("nothing")).not.toThrow();
  });
});
