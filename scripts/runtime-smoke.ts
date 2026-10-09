/**
 * Real (not mocked) checks of the local AI runtime, run under plain Node (no Electron).
 * Build + run:  node scripts/run-smoke.mjs <command> [args]
 *   assess                      hardware report + recommendation
 *   install <dir> <modelId> [cancelAtFraction]   download into <dir>, optionally cancel then resume
 *   evidence                    cold start, first token, speed, peak RSS, JSON, offline proof, idle unload
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeStatus, Settings } from "../app/src/shared/contracts";
import { createHardwareService } from "../app/src/main/services/hardware";
import { createRuntimeService } from "../app/src/main/services/runtime";
import { nvidiaUsedMemoryMiB } from "../app/src/main/services/runtime/sys";

const modelDir = process.env.NONON_MODEL_DIR ?? "E:\\nonon-dev\\models";

function makeCtx(dir: string, idleSeconds: number, onStatus: (s: RuntimeStatus) => void = () => {}) {
  mkdirSync(dir, { recursive: true });
  const settings = { modelId: null, idleUnloadSeconds: idleSeconds } as Settings;
  return {
    paths: { dataDir: dir, modelDir: dir, resourcesDir: dir, logFile: join(dir, "nonon.log") },
    emit: (event: string, payload: unknown) => {
      if (event === "runtime:status") onStatus(payload as RuntimeStatus);
    },
    log: (m: string) => console.log(`  [log] ${m}`),
    getSettings: () => settings,
    updateSettings: (p: Partial<Settings>) => Object.assign(settings, p),
  } as never;
}

const mb = (n: number | null | undefined) => (n == null ? "n/a" : `${(n / 1048576).toFixed(0)} MiB`);
const sec = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd: string) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8" }).trim();

function meetingNotes(): string {
  const people = ["Maria", "Joel", "Ana", "Ben", "Carla", "Dev", "Elena", "Farid"];
  const topics = [
    "the supplier invoice for the packaging order, which is 4 days late",
    "the new schedule for the Saturday market stall",
    "the budget for printing flyers, capped at 250 dollars",
    "whether to move the customer list into one spreadsheet",
    "the refund request from the Lopez account",
    "booking the delivery van for the 14th",
    "the draft of the March newsletter",
    "training the two new part-time staff on the till",
  ];
  const lines: string[] = ["Weekly team meeting, Tuesday 9:30. Present: " + people.join(", ") + "."];
  for (let i = 0; i < 13; i++) {
    const who = people[i % people.length];
    const what = topics[(i * 3) % topics.length];
    lines.push(`${i + 1}. ${who} raised ${what}. The group agreed ${who} will follow up by Friday and report back at the next meeting, noting any cost above the agreed limit.`);
  }
  return lines.join("\n");
}

async function assess() {
  const hw = createHardwareService({ paths: { modelDir } } as never);
  console.log(JSON.stringify(await hw.assess(), null, 2));
}

async function install(dir: string, modelId: string, cancelAt?: number) {
  let lastLine = "";
  const svc = createRuntimeService(
    makeCtx(dir, 60, (s) => {
      const line = `${s.phase} ${s.progress == null ? "" : `${(s.progress * 100).toFixed(0)}%`} ${s.detail}`;
      if (line !== lastLine && (s.progress == null || Math.round((s.progress ?? 0) * 100) % 10 === 0)) {
        console.log(`  status: ${line}`);
        lastLine = line;
      }
    }),
  );
  console.log("before:", svc.status().phase);
  const t0 = Date.now();
  if (cancelAt !== undefined) {
    const p = svc.install(modelId);
    while ((svc.status().progress ?? 0) < cancelAt || svc.status().phase !== "downloading-model") await sleep(100);
    svc.cancel();
    await p;
    console.log(`cancelled at ${(svc.status().progress ?? 0).toFixed(2)}; phase=${svc.status().phase}; ${svc.status().detail}`);
  }
  await svc.install(modelId);
  console.log(`after: phase=${svc.status().phase} model=${svc.status().modelId} total ${sec(Date.now() - t0)}`);
}

async function evidence() {
  const out: Record<string, unknown> = {};
  const hw = createHardwareService({ paths: { modelDir } } as never);
  const assessment = await hw.assess();
  console.log(`hardware: ${assessment.report.cpu}, ${assessment.report.cores} threads, RAM ${mb(assessment.report.ramBytes)}, GPU ${assessment.report.gpuName} ${mb(assessment.report.gpuMemoryBytes)}, accel ${assessment.report.accel}`);
  console.log(`recommendation: ${assessment.recommendation?.modelId} (${assessment.recommendation?.mode})`);

  const idleSeconds = 10;
  const svc = createRuntimeService(makeCtx(modelDir, idleSeconds));
  console.log(`status before: ${svc.status().phase} model=${svc.status().modelId}`);

  // 1. cold start
  const vramBefore = await nvidiaUsedMemoryMiB();
  let t = Date.now();
  await svc.start();
  const coldStartMs = Date.now() - t;
  const dbg = svc.debug();
  console.log(`cold start (process launch to /health ok): ${sec(coldStartMs)}; engine=${dbg.runtime} cache=${dbg.cacheType} pid=${dbg.pid}`);
  out.coldStartMs = coldStartMs;
  const vramRunning = await nvidiaUsedMemoryMiB();

  // 2. first token + speed on a ~600-token prompt (server is warm here; first request pays shader/graph warmup)
  const client = svc.client();
  const prompt = meetingNotes();
  const ask = (suffix: string) => [
    { role: "system" as const, content: "You are a careful office assistant. Answer plainly." },
    { role: "user" as const, content: `${prompt}\n\n${suffix}` },
  ];
  t = Date.now();
  let first = 0;
  let streamed = "";
  const r1 = await client.chat({
    messages: ask("Summarize this meeting in 5 short bullet points."),
    maxTokens: 220,
    temperature: 0.2,
    onToken: (d) => {
      if (!first) first = Date.now() - t;
      streamed += d;
    },
  });
  const total1 = Date.now() - t;
  console.log(`prompt speed on request 1 = promptTokens / TTFT = ${((r1.promptTokens ?? 0) / (first / 1000)).toFixed(0)} tok/s`);
  console.log(`request 1 (first after start): promptTokens=${r1.promptTokens} completion=${r1.completionTokens} TTFT=${sec(first)} total=${sec(total1)} gen=${r1.tokensPerSecond?.toFixed(1)} tok/s`);
  console.log(`  reply head: ${streamed.slice(0, 160).replace(/\n/g, " | ")}`);
  out.request1 = { promptTokens: r1.promptTokens, completionTokens: r1.completionTokens, ttftMs: first, totalMs: total1, genTps: r1.tokensPerSecond };

  // distinct prompt (no prompt-cache hit) for steady-state numbers
  t = Date.now();
  first = 0;
  const r2 = await client.chat({
    messages: ask("List every person who has a follow-up and the topic of their first one."),
    maxTokens: 220,
    temperature: 0.2,
    onToken: () => {
      if (!first) first = Date.now() - t;
    },
  });
  console.log(`request 2 (warm): promptTokens=${r2.promptTokens} completion=${r2.completionTokens} TTFT=${sec(first)} total=${sec(Date.now() - t)} gen=${r2.tokensPerSecond?.toFixed(1)} tok/s (shares prompt prefix, so prompt cache likely hit)`);

  // 3. JSON schema constrained extraction
  const schema = {
    type: "object",
    properties: {
      vendor: { type: "string" },
      invoiceNumber: { type: "string" },
      total: { type: "number" },
      dueDate: { type: "string" },
      lineItems: { type: "array", items: { type: "object", properties: { description: { type: "string" }, amount: { type: "number" } }, required: ["description", "amount"], additionalProperties: false } },
    },
    required: ["vendor", "invoiceNumber", "total", "dueDate", "lineItems"],
    additionalProperties: false,
  };
  const j = await client.chat({
    messages: [
      { role: "system", content: "Extract the invoice fields. Use only what the text says." },
      { role: "user", content: "Invoice INV-2291 from Bayside Packaging Ltd. 12 cartons at 18.50 = 222.00. Tape rolls, 6 at 4.25 = 25.50. Total due 247.50. Pay by 3 November 2026." },
    ],
    jsonSchema: schema,
    maxTokens: 300,
    temperature: 0,
  });
  let parsed: unknown = null;
  let jsonOk = false;
  try {
    parsed = JSON.parse(j.text);
    const o = parsed as Record<string, unknown>;
    jsonOk = typeof o.vendor === "string" && typeof o.total === "number" && Array.isArray(o.lineItems);
  } catch {
    /* reported below */
  }
  console.log(`json schema: valid=${jsonOk} raw=${j.text.replace(/\s+/g, " ")}`);
  out.json = { valid: jsonOk, parsed };

  // 4. offline proof during generation
  const pid = svc.debug().pid as number;
  let proofDone: Promise<void> = Promise.resolve();
  let seen = 0;
  const gen = client.chat({
    messages: ask("Write a detailed two-paragraph follow-up email covering every action item."),
    maxTokens: 400,
    temperature: 0.7,
    onToken: () => {
      seen += 1;
      if (seen === 20) {
        proofDone = (async () => {
          console.log(`--- sockets owned by llama-server pid ${pid}, sampled while generating (token ${seen}) ---`);
          console.log(ps(`Get-NetTCPConnection -OwningProcess ${pid} | Format-Table LocalAddress,LocalPort,RemoteAddress,RemotePort,State -AutoSize | Out-String -Width 200`));
          console.log("UDP endpoints:");
          console.log(ps(`$u = Get-NetUDPEndpoint -OwningProcess ${pid} -ErrorAction SilentlyContinue; if ($u) { $u | Format-Table LocalAddress,LocalPort | Out-String } else { 'none' }`));
        })();
      }
    },
  });
  await gen;
  await proofDone;

  // 5. peak RSS
  await sleep(2500);
  const st = svc.status();
  console.log(`peak RSS (working set, polled every 2 s): ${mb(st.peakRssBytes)}; context=${st.contextTokens} tokens`);
  out.peakRssBytes = st.peakRssBytes;

  // 6. idle unload
  console.log(`waiting for idle unload (${idleSeconds} s)...`);
  const waitStart = Date.now();
  while (svc.status().phase !== "sleeping" && Date.now() - waitStart < 60_000) await sleep(500);
  const unloadedAfter = Date.now() - waitStart;
  await sleep(1500);
  const vramAfter = await nvidiaUsedMemoryMiB();
  console.log(`GPU memory used (whole card, nvidia-smi, includes the shared dev server and desktop): before start ${vramBefore} MiB, running ${vramRunning} MiB, after idle unload ${vramAfter} MiB`);
  const alive = ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Measure-Object).Count`);
  console.log(`after idle: phase=${svc.status().phase} unload took ${sec(unloadedAfter)} after last request; llama-server pid ${pid} still running? ${alive === "0" ? "no (memory released)" : "YES"}`);
  out.idleUnload = { phase: svc.status().phase, afterMs: unloadedAfter, processGone: alive === "0" };

  // 7. transparent wake
  t = Date.now();
  const r3 = await client.chat({ messages: [{ role: "user", content: "Reply with one word: ready" }], maxTokens: 8, temperature: 0 });
  console.log(`wake on next request: ${sec(Date.now() - t)}, reply=${JSON.stringify(r3.text)}, phase=${svc.status().phase}, starts=${svc.debug().starts}, new pid=${svc.debug().pid}`);

  // 8. abort
  const ac = new AbortController();
  let aborted = false;
  const longReq = client.chat({ messages: ask("Write a very long essay."), maxTokens: 1000, signal: ac.signal, onToken: () => { if (!ac.signal.aborted) setTimeout(() => ac.abort(), 200); } }).catch((e: Error) => { aborted = e.name === "AbortError"; });
  await longReq;
  console.log(`abort mid-stream: rejected with AbortError=${aborted}`);

  await svc.stop();
  console.log(`after stop(): phase=${svc.status().phase}`);
  console.log("EVIDENCE_JSON " + JSON.stringify(out));
}

const [cmd, ...rest] = process.argv.slice(2);
const run =
  cmd === "assess" ? assess()
  : cmd === "install" ? install(rest[0] ?? "", rest[1] ?? "qwen3.5-4b", rest[2] ? Number(rest[2]) : undefined)
  : cmd === "evidence" ? evidence()
  : Promise.reject(new Error("usage: assess | install <dir> <modelId> [cancelAt] | evidence"));
run.then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
