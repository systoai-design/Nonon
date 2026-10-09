// REAL end-to-end run against the shared dev llama-server (Qwen3.5 4B). Skipped when the server is not up.
// Results are also written to E:\nonon-dev\spreadsheet-real-run.json so they can be quoted in the evidence doc.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createOpenAiCompatClient } from "../../runtime/llama-client";
import { spreadsheetCompare } from "./index";
import { RULES_DEFAULT, SAMPLES, doneOrThrow, fx, makeCtx } from "./testkit";

const URL_FILE = "E:\\nonon-dev\\llm-url.txt";
const baseUrl = existsSync(URL_FILE) ? readFileSync(URL_FILE, "utf8").trim() : "";

async function serverUp(): Promise<boolean> {
  if (!baseUrl) return false;
  try {
    const r = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}
const up = await serverUp();

describe.skipIf(!up)("REAL local model (not mocked)", () => {
  const ai = createOpenAiCompatClient(baseUrl);
  const a = path.join(SAMPLES, "expense-report-may-2026.csv");
  const b = path.join(SAMPLES, "bank-export-may-2026.csv");
  const record: Record<string, unknown> = { baseUrl, when: new Date().toISOString() };

  it("explains the bookkeeping demo pair with real inference", async () => {
    const ctx = await makeCtx({ fileA: a, fileB: b, answers: { ...RULES_DEFAULT, "rule.amountSign": "opposite" }, ai });
    const t0 = Date.now();
    const out = doneOrThrow(await spreadsheetCompare.run(ctx));
    const ms = Date.now() - t0;
    const ex = (out.report as { explanation: { source: string; summary: string; checkFirst: string[]; attempts: number; timingMs?: number } }).explanation;
    record.demo = { totalRunMs: ms, explanation: ex, summary: out.summary, checks: out.checks.map((c) => `${c.status} ${c.id}`) };
    writeFileSync("E:\\nonon-dev\\spreadsheet-real-run.json", JSON.stringify(record, null, 2));
    expect(out.outputs).toHaveLength(1);
    expect(ex.source).toBe("model");
    expect(ex.summary.length).toBeGreaterThan(20);
  }, 180000);

  it("reads ambiguous headers with the real model; the answer stays a validated suggestion", async () => {
    const ctx = await makeCtx({ fileA: fx("ambiguous-a.csv"), fileB: fx("ambiguous-b.csv"), answers: RULES_DEFAULT, ai });
    const t0 = Date.now();
    const out = await spreadsheetCompare.run(ctx);
    expect(out.kind).toBe("needs-input");
    if (out.kind !== "needs-input") return;
    record.headers = { ms: Date.now() - t0, suggestions: Object.fromEntries(out.questions.map((q) => [q.id, q.suggested])) };
    writeFileSync("E:\\nonon-dev\\spreadsheet-real-run.json", JSON.stringify(record, null, 2));
    const s = Object.fromEntries(out.questions.map((q) => [q.id, q.suggested]));
    expect(s).toMatchObject({ "map.a.date": "Txn Dt", "map.a.description": "Details", "map.a.amount": "Amt" });
  }, 120000);
});
