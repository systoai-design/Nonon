import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenAiCompatClient, systemFirst } from "./llama-client";

// MOCKED: a small HTTP server that speaks llama-server's wire format. Real-server behaviour is in runtime-evidence.md.
let server: Server | null = null;
let lastBody: Record<string, unknown> = {};
let lastAuth: string | undefined;

async function fake(handler: (body: Record<string, unknown>, res: import("node:http").ServerResponse) => void): Promise<string> {
  server = createServer((req: IncomingMessage, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastBody = JSON.parse(raw) as Record<string, unknown>;
      lastAuth = req.headers.authorization;
      handler(lastBody, res);
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

describe("createOpenAiCompatClient (mocked server)", () => {
  it("streams deltas, reads timings, and turns thinking off", async () => {
    const url = await fake((_b, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: {"choices":[{"delta":{}}],"timings":{"predicted_per_second":42.5,"predicted_n":2,"prompt_n":9}}\n\n');
      res.end("data: [DONE]\n\n");
    });
    const seen: string[] = [];
    const r = await createOpenAiCompatClient(url, undefined, { apiKey: "k" }).chat({
      messages: [{ role: "user", content: "hi" }],
      onToken: (d) => seen.push(d),
      maxTokens: 50,
      temperature: 0.1,
    });
    expect(seen).toEqual(["Hel", "lo"]);
    expect(r.text).toBe("Hello");
    expect(r.tokensPerSecond).toBe(42.5);
    expect(r.completionTokens).toBe(2);
    expect(r.promptTokens).toBe(9);
    expect(r.location).toEqual({ ai: "local", files: "this-computer" });
    expect(lastBody.stream).toBe(true);
    expect(lastBody.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(lastBody.max_tokens).toBe(50);
    expect(lastAuth).toBe("Bearer k");
  });

  it("sends jsonSchema as response_format and reads a non-streamed reply", async () => {
    const url = await fake((_b, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }));
    });
    const schema = { type: "object", properties: { a: { type: "number" } }, required: ["a"] };
    const r = await createOpenAiCompatClient(`${url}/v1/`).chat({ messages: [{ role: "user", content: "x" }], jsonSchema: schema });
    expect(JSON.parse(r.text)).toEqual({ a: 1 });
    expect(lastBody.stream).toBe(false);
    expect(lastBody.response_format).toEqual({ type: "json_schema", json_schema: { name: "out", schema, strict: true } });
    expect(r.promptTokens).toBe(5);
  });

  it("reports server errors in plain words", async () => {
    const url = await fake((_b, res) => {
      res.writeHead(500);
      res.end("boom");
    });
    await expect(createOpenAiCompatClient(url).chat({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/error 500/);
  });

  it("aborts a stream", async () => {
    const url = await fake((_b, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"a"}}]}\n\n');
    });
    const ac = new AbortController();
    const p = createOpenAiCompatClient(url).chat({ messages: [{ role: "user", content: "x" }], signal: ac.signal, onToken: () => ac.abort() });
    await expect(p).rejects.toThrow();
  });

  it("runs the before and after hooks even when the request fails", async () => {
    const events: string[] = [];
    const c = createOpenAiCompatClient("http://127.0.0.1:1", undefined, {
      beforeRequest: async () => void events.push("before"),
      afterRequest: () => void events.push("after"),
    });
    await expect(c.chat({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow();
    expect(events).toEqual(["before", "after"]);
  });
});

describe("systemFirst", () => {
  it("leaves a normal conversation alone", () => {
    const m = [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "u" }];
    expect(systemFirst(m)).toBe(m);
  });
  it("folds later system messages into the first position", () => {
    const out = systemFirst([
      { role: "user", content: "u1" },
      { role: "system", content: "late" },
      { role: "assistant", content: "a" },
      { role: "system", content: "later" },
    ]);
    expect(out.map((x) => x.role)).toEqual(["system", "user", "assistant"]);
    expect(out[0]?.content).toBe("late\n\nlater");
  });
});
