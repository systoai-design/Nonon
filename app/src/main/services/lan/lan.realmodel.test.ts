import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenAiCompatClient } from "../runtime/llama-client";
import { localAddresses } from "./cert";
import { makeWorld, pairClient, type World } from "./testkit";

/**
 * Live check: the host wraps the real local llama-server client, a second client in this process pairs over TLS and gets
 * a real completion. Skipped when the shared dev server (E:\nonon-dev\llm-url.txt) is not running.
 * Both ends are in one process, so this proves the code path end to end, not two machines.
 */
let baseUrl: string | null = null;
try {
  baseUrl = readFileSync("E:/nonon-dev/llm-url.txt", "utf8").trim();
} catch {
  baseUrl = null;
}
let reachable = false;
if (baseUrl) reachable = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);

describe.skipIf(!reachable)("paired computer with the real local model", () => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.cleanup();
    world = null;
  });

  for (const [label, address] of [
    ["loopback 127.0.0.1", "127.0.0.1"],
    ["this PC's LAN address", localAddresses().find((a) => a.startsWith("192.168.") || a.startsWith("10.") || /^172\.(1[6-9]|2\d|3[01])\./.test(a))],
  ] as const) {
    it.skipIf(!address)(`gets a real completion over TLS via ${label}`, async () => {
      const real = createOpenAiCompatClient(baseUrl!);
      world = await makeWorld({ host: { bindHost: "0.0.0.0", advertiseHost: () => address! } });
      world.hostH.runtime.client = real;
      const payload = await pairClient(world);
      expect(payload.h).toBe(address);

      const client = world.clientLan.client()!;
      expect(client.location.ai).toBe("paired");

      const direct0 = Date.now();
      await real.chat({ messages: [{ role: "user", content: "Reply with exactly one word: pong" }], maxTokens: 24, temperature: 0 });
      const directMs = Date.now() - direct0;

      const deltas: string[] = [];
      const t0 = Date.now();
      const plain = await client.chat({
        messages: [{ role: "user", content: "Reply with exactly one word: pong" }],
        maxTokens: 24,
        temperature: 0,
        onToken: (d) => deltas.push(d),
      });
      const ms = Date.now() - t0;
      console.log(`[real model via ${label}] direct local call ${directMs} ms, paired call ${ms} ms, ${deltas.length} deltas, ${plain.completionTokens ?? "?"} tokens, ${plain.tokensPerSecond?.toFixed(1) ?? "?"} tok/s, reply=${JSON.stringify(plain.text.trim().slice(0, 60))}`);
      expect(plain.text.toLowerCase()).toContain("pong");
      expect(deltas.join("")).toBe(plain.text);
      expect(plain.location.ai).toBe("paired");

      const structured = await client.chat({
        messages: [{ role: "user", content: "What is 17 plus 25? Answer as JSON." }],
        jsonSchema: { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"], additionalProperties: false },
        maxTokens: 40,
        temperature: 0,
      });
      expect(JSON.parse(structured.text)).toEqual({ answer: 42 });
    }, 120_000);
  }
});
