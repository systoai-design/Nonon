import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOpenAiCompatClient } from "./runtime/llama-client";
import { type Harness, done, makeHarness, makeProc, writeFile } from "./core/testkit";

/** Live check against the shared dev llama-server. Skipped when it is not running. */
const URL_FILE = "E:/nonon-dev/llm-url.txt";
let baseUrl: string | null = null;
try {
  baseUrl = readFileSync(URL_FILE, "utf8").trim();
} catch {
  baseUrl = null;
}
let reachable = false;
if (baseUrl) reachable = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);

describe.skipIf(!reachable)("chat routing against the real local model", () => {
  let h: Harness;
  let modelCalls = 0;
  beforeAll(() => {
    h = makeHarness();
    const real = createOpenAiCompatClient(baseUrl!);
    h.runtime.client = {
      location: real.location,
      chat: (req) => {
        modelCalls += 1;
        return real.chat(req);
      },
    };
    for (const [id, title, summary, inputs] of [
      ["spreadsheet-compare", "Compare two spreadsheets", "Find rows that do not match between two spreadsheets.", ["a", "b"]],
      ["meeting-followup", "Meeting follow-up", "Turn meeting notes into action items and a follow-up draft.", ["notes"]],
      ["study-packet", "Study packet", "Make a summary, quiz and flashcards from study material.", ["source"]],
    ] as const) {
      h.registry.set(
        id,
        makeProc(id, async () => done(), inputs.map((key) => ({ key, label: key, kind: "file" as const, accept: [".csv", ".xlsx", ".txt", ".md"] })), {
          title,
          summary,
          pack: "general",
        }),
      );
    }
  });
  afterAll(() => h.cleanup());

  it("routes plain-English requests to the right job, or to conversation", async () => {
    const ws = h.ctx.svc.workspaces.create({ name: "Live", folder: h.folder, pack: "general" });
    const bank = writeFile(join(h.folder, "bank.csv"));
    const ledger = writeFile(join(h.folder, "ledger.csv"));
    const notes = writeFile(join(h.folder, "monday.txt"), "Ana will send the invoice by Friday.");

    const cases: [string, string, string[]][] = [
      ["find what does not match between my bank and my ledger", "spreadsheet-compare", [bank, ledger]],
      ["line the two sheets up and show me the odd rows", "spreadsheet-compare", [bank, ledger]],
      ["write up the follow-ups from these notes", "meeting-followup", [notes]],
      ["make me a quiz to study from this", "study-packet", [notes]],
    ];
    for (const [text, expected, files] of cases) {
      const added = await h.ctx.svc.chat.send(ws.id, text, files);
      const task = added[1]?.taskId ? h.ctx.svc.tasks.get(added[1].taskId) : undefined;
      console.log(`[live] "${text}" -> ${task?.procedureId ?? added[1]?.text}`);
      expect(task?.procedureId, text).toBe(expected);
    }

    expect(modelCalls).toBeGreaterThanOrEqual(cases.length);
    const chat = await h.ctx.svc.chat.send(ws.id, "hi, what can you help me with?");
    console.log(`[live] conversation -> ${chat[1]?.text}`);
    expect(chat[1]?.taskId).toBeUndefined();
    expect(chat[1]?.text.length).toBeGreaterThan(5);
    expect(chat[1]?.text.length).toBeLessThanOrEqual(500);
  }, 180_000);
});
