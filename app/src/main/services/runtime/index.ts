import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { InferenceClient, RuntimeStatus } from "../../../shared/contracts";
import type { AppCtx, RuntimeService } from "../types";
import {
  CONTEXT_TOKENS,
  MODELS,
  SPARE_DISK_BYTES,
  findModel,
  runtimeCandidates,
  unsupportedReason,
  type LocalModel,
  type RuntimeId,
  type RuntimePin,
} from "./catalog";
import { DownloadCancelled, extractArchive, fetchPinned } from "./download";
import { createOpenAiCompatClient } from "./llama-client";
import { cudaDriverRuns, freeDiskBytes, freePort, isLlamaServer, readWindowsGpu, sampleRssBytes } from "./sys";

/** The slice of AppCtx the runtime uses, so it runs under plain Node (no electron import) in tests and scripts. */
export type RuntimeDeps = Pick<AppCtx, "paths" | "emit" | "log" | "getSettings" | "updateSettings">;

export interface RuntimeOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  /** Force one engine build (evidence runs). Also read from NONON_RUNTIME. */
  forceRuntime?: RuntimeId;
  startTimeoutMs?: number;
}

export interface RuntimeDebug {
  pid: number | null;
  baseUrl: string | null;
  runtime: RuntimeId | null;
  cacheType: string | null;
  starts: number;
  logPath: string;
}

const VC_RUNTIME_DLLS = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"];
const MISSING_DLL_EXIT = 3221225781;
const RSS_POLL_MS = 2000;
const gb = (n: number) => `${(n / 1e9).toFixed(1)} GB`;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createRuntimeService(ctx: RuntimeDeps, opts: RuntimeOptions = {}): RuntimeService & { debug(): RuntimeDebug } {
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const startTimeoutMs = opts.startTimeoutMs ?? 3 * 60_000;
  const root = ctx.paths.modelDir;
  const logPath = join(root, "llama-server.log");
  const pidPath = join(root, "llama-server.pid");
  const reason = unsupportedReason(platform, arch);
  const apiKey = randomBytes(24).toString("hex");

  let candidatesCache: RuntimePin[] | null = null;
  async function candidates(): Promise<RuntimePin[]> {
    if (candidatesCache) return candidatesCache;
    let cudaOk = false;
    if (platform === "win32" && arch === "x64") cudaOk = cudaDriverRuns((await readWindowsGpu()).cuda);
    let list = runtimeCandidates(platform, arch, cudaOk);
    const forced = opts.forceRuntime ?? (process.env.NONON_RUNTIME as RuntimeId | undefined);
    if (forced) {
      const allowed = runtimeCandidates(platform, arch, true).filter((c) => c.id === forced);
      if (allowed.length) list = allowed;
    }
    candidatesCache = list;
    return list;
  }

  const exeOf = (pin: RuntimePin) => join(root, "runtime", pin.folder, pin.exe);
  const modelPath = (m: LocalModel) => join(root, m.file);
  const anyRuntimeInstalled = (list: RuntimePin[]) => list.find((p) => existsSync(exeOf(p))) ?? null;

  function installedModelId(): string | null {
    const wanted = ctx.getSettings().modelId;
    const wantedModel = wanted ? findModel(wanted) : undefined;
    if (wantedModel && existsSync(modelPath(wantedModel))) return wantedModel.id;
    return [...MODELS].reverse().find((m) => existsSync(modelPath(m)))?.id ?? null;
  }

  // ---- status -----------------------------------------------------------------------------
  let status: RuntimeStatus = { phase: "not-installed", modelId: null, progress: null, bytesDone: null, bytesTotal: null, detail: "" };
  let lastProgressEmit = 0;
  function set(patch: Partial<RuntimeStatus>, quiet = false): void {
    status = { ...status, ...patch };
    if (quiet) {
      const now = Date.now();
      if (now - lastProgressEmit < 250) return;
      lastProgressEmit = now;
    }
    ctx.emit("runtime:status", status);
  }
  const idleStatus = (detail?: string): Partial<RuntimeStatus> => {
    const modelId = installedModelId();
    return {
      phase: modelId && anyRuntimeInstalledSync() ? "ready" : "not-installed",
      modelId: modelId ?? status.modelId,
      progress: null,
      bytesDone: null,
      bytesTotal: null,
      detail: detail ?? (modelId ? "Installed and ready." : "The AI on this computer is not installed yet."),
    };
  };
  function anyRuntimeInstalledSync(): boolean {
    const list = runtimeCandidates(platform, arch, true);
    return list.some((p) => existsSync(exeOf(p)));
  }
  if (reason) status = { ...status, phase: "not-installed", detail: reason, error: reason };
  else status = { ...status, ...idleStatus() };

  // ---- install ----------------------------------------------------------------------------
  let installing: { modelId: string; promise: Promise<void>; abort: AbortController } | null = null;

  async function doInstall(model: LocalModel, abort: AbortController): Promise<void> {
    const list = await candidates();
    const have = anyRuntimeInstalled(list);
    const runtime = have ?? list[0];
    if (!runtime) throw new Error(reason ?? "The AI on this computer cannot run on this machine.");

    const part = (file: string) => (existsSync(`${file}.part`) ? statSync(`${file}.part`).size : 0);
    const modelFile = modelPath(model);
    const needRuntime = have === null;
    const runtimeBytes = needRuntime ? runtime.bytes + (runtime.extra?.bytes ?? 0) : 0;
    const modelBytes = existsSync(modelFile) ? 0 : model.bytes - part(modelFile);
    const needs = runtimeBytes + modelBytes + SPARE_DISK_BYTES;
    const free = freeDiskBytes(root);
    if (free !== null && needs > 0 && free < needs) {
      throw new Error(`There is not enough room on this drive. The AI on this computer needs about ${gb(needs)}, and only ${gb(free)} is free. Free up some space, then press install again. Nothing was installed.`);
    }
    mkdirSync(join(root, "runtime", runtime.folder), { recursive: true });

    const track = (phase: "downloading-runtime" | "downloading-model", detail: string) => (done: number, total: number) =>
      set({ phase, modelId: model.id, progress: total ? done / total : null, bytesDone: done, bytesTotal: total, detail }, true);
    const verifying = () => set({ phase: "verifying", detail: "Checking that the file downloaded correctly." });

    if (needRuntime) {
      const archives = [runtime, ...(runtime.extra ? [runtime.extra] : [])];
      for (const [i, pin] of archives.entries()) {
        const archive = join(root, `engine-${runtime.folder}-${i}${pin.url.endsWith(".tar.gz") ? ".tar.gz" : ".zip"}`);
        set({ phase: "downloading-runtime", modelId: model.id, progress: 0, bytesDone: 0, bytesTotal: pin.bytes, detail: "Downloading the helper files the AI needs." });
        await fetchPinned(pin, archive, { signal: abort.signal, onProgress: track("downloading-runtime", "Downloading the helper files the AI needs."), onVerifying: verifying });
        set({ phase: "installing", detail: "Setting up the helper files.", progress: null });
        await extractArchive(archive, join(root, "runtime", runtime.folder));
        rmSync(archive, { force: true });
      }
      if (!existsSync(exeOf(runtime))) throw new Error("The AI helper files are incomplete. Press install to try again.");
    }

    if (!existsSync(modelFile)) {
      set({ phase: "downloading-model", modelId: model.id, progress: 0, bytesDone: 0, bytesTotal: model.bytes, detail: "Downloading the AI. This is a big file, so it may take a while." });
      await fetchPinned(model, modelFile, { signal: abort.signal, onProgress: track("downloading-model", "Downloading the AI. This is a big file, so it may take a while."), onVerifying: verifying });
    }
    ctx.updateSettings({ modelId: model.id });
    set({ ...idleStatus("The AI is installed and ready."), modelId: model.id, error: undefined });
  }

  function install(modelId: string): Promise<void> {
    const model = findModel(modelId);
    if (!model) return Promise.reject(new Error("That AI is not one of the choices NONON offers."));
    if (reason) return Promise.reject(new Error(reason));
    if (installing) {
      if (installing.modelId === modelId) return installing.promise;
      return Promise.reject(new Error("Another install is already running. Wait for it to finish, or stop it first."));
    }
    const abort = new AbortController();
    const promise = (async () => {
      if (child && status.modelId !== modelId) await stop();
      try {
        await doInstall(model, abort);
      } catch (e) {
        if (e instanceof DownloadCancelled || abort.signal.aborted) {
          set({ ...idleStatus("Download paused. Press install to carry on from where it stopped.") });
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        set({ phase: "failed", modelId, progress: null, bytesDone: null, bytesTotal: null, detail: message, error: message });
        throw e;
      } finally {
        installing = null;
      }
    })();
    installing = { modelId, promise, abort };
    return promise;
  }

  function cancel(): void {
    installing?.abort.abort();
  }

  // ---- server process ---------------------------------------------------------------------
  let child: ChildProcess | null = null;
  let baseUrl: string | null = null;
  let activeRuntime: RuntimeId | null = null;
  let activeCache: string | null = null;
  let starting: Promise<void> | null = null;
  let stopping = false;
  let starts = 0;
  let inflight = 0;
  let idleTimer: NodeJS.Timeout | null = null;
  let rssTimer: NodeJS.Timeout | null = null;
  let peakRss = 0;
  const lastLines: string[] = [];

  const alive = (p: ChildProcess | null): boolean => p !== null && p.exitCode === null && p.signalCode === null;

  function whyItStopped(code: number | null): string {
    if (code === MISSING_DLL_EXIT) {
      return "Windows is missing a small piece the AI needs (Microsoft Visual C++ Redistributable 2015-2022, x64). Install it from Microsoft, then try again.";
    }
    const line = [...lastLines].reverse().find((l) => /error|fail|unable|cannot|out of memory/i.test(l)) ?? lastLines.at(-1);
    ctx.log(`local AI stopped (code ${code ?? "none"})${line ? `: ${line}` : ""}`);
    return "The AI on this computer stopped working. Try again. If it keeps stopping, close other apps or restart your computer.";
  }

  function stageVcRuntime(exe: string): void {
    if (platform !== "win32") return;
    const from = join(ctx.paths.resourcesDir, "vcruntime");
    for (const name of VC_RUNTIME_DLLS) {
      const target = join(dirname(exe), name);
      if (!existsSync(target) && existsSync(join(from, name))) copyFileSync(join(from, name), target);
    }
  }

  async function waitHealthy(proc: ChildProcess, url: string): Promise<void> {
    const deadline = Date.now() + startTimeoutMs;
    while (Date.now() < deadline) {
      if (!alive(proc)) throw new Error(whyItStopped(proc.exitCode));
      const ok = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) })
        .then((r) => r.ok)
        .catch(() => false);
      if (ok) return;
      await delay(250);
    }
    throw Object.assign(new Error("The AI on this computer took too long to wake up. Close other apps to free up memory, then try again."), { timeout: true });
  }

  async function launch(model: LocalModel, runtime: RuntimePin, quantized: boolean): Promise<void> {
    const exe = exeOf(runtime);
    stageVcRuntime(exe);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    lastLines.length = 0;
    const cache = quantized ? "q8_0" : "f16";
    // No -ngl: llama.cpp's --fit (on by default) puts every layer on the GPU when it fits and spills the rest otherwise.
    const args = [
      "--model", modelPath(model),
      "--ctx-size", String(CONTEXT_TOKENS),
      "--host", "127.0.0.1",
      "--port", String(port),
      "--alias", model.id,
      "--parallel", "1",
      "--jinja",
      "--reasoning", "off",
      "--cache-type-k", cache,
      "--cache-type-v", cache,
      "--flash-attn", quantized ? "on" : "auto",
      "--fit", "on",
      "--no-webui",
    ];
    // The key travels in the environment: on the command line any local process could read it.
    const proc = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LLAMA_API_KEY: apiKey }, cwd: dirname(exe) });
    child = proc;
    stopping = false;
    const log = createWriteStream(logPath, { flags: "w" });
    log.on("error", () => {});
    const remember = (chunk: Buffer) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        lastLines.push(line.trim().slice(0, 300));
        if (lastLines.length > 30) lastLines.shift();
      }
    };
    proc.stdout?.on("data", (c: Buffer) => { log.write(c); remember(c); });
    proc.stderr?.on("data", (c: Buffer) => { log.write(c); remember(c); });
    proc.once("exit", (code) => {
      log.end();
      if (child !== proc) return;
      child = null;
      baseUrl = null;
      stopSampling();
      rmSync(pidPath, { force: true });
      if (!stopping && !starting && status.phase !== "sleeping") {
        const message = whyItStopped(code);
        set({ phase: "failed", detail: message, error: message });
      }
    });
    if (proc.pid) writeFileSync(pidPath, String(proc.pid));
    try {
      await waitHealthy(proc, url);
    } catch (e) {
      await killChild();
      throw e;
    }
    baseUrl = url;
    activeRuntime = runtime.id;
    activeCache = cache;
  }

  function startSampling(proc: ChildProcess): void {
    stopSampling();
    peakRss = 0;
    const tick = async () => {
      if (!proc.pid || !alive(proc)) return;
      const rss = await sampleRssBytes(proc.pid);
      if (rss !== null && rss > peakRss) {
        const grew = rss - peakRss > 50_000_000;
        peakRss = rss;
        set({ peakRssBytes: peakRss }, !grew);
      }
    };
    void tick();
    rssTimer = setInterval(() => void tick(), RSS_POLL_MS);
    rssTimer.unref();
  }
  function stopSampling(): void {
    if (rssTimer) clearInterval(rssTimer);
    rssTimer = null;
  }

  async function killChild(): Promise<void> {
    const proc = child;
    if (!proc) return;
    stopping = true;
    child = null;
    baseUrl = null;
    stopSampling();
    rmSync(pidPath, { force: true });
    if (!alive(proc)) return;
    const exited = once(proc, "exit").catch(() => undefined);
    proc.kill();
    await Promise.race([exited, delay(5000)]);
    if (alive(proc)) proc.kill("SIGKILL");
  }

  async function doStart(): Promise<void> {
    if (reason) throw new Error(reason);
    const modelId = installedModelId();
    const model = modelId ? findModel(modelId) : undefined;
    if (!model) throw new Error("The AI on this computer is not installed yet. Install it first.");
    const list = await candidates();
    const present = list.filter((p) => existsSync(exeOf(p)));
    if (!present.length) throw new Error("The AI helper files are not installed yet. Install them first.");

    await killChild();
    set({ phase: "starting", modelId: model.id, progress: null, bytesDone: null, bytesTotal: null, detail: "Waking up the AI on this computer.", error: undefined, contextTokens: CONTEXT_TOKENS });
    let failure: unknown = null;
    for (const runtime of present) {
      for (const quantized of [true, false]) {
        try {
          const t0 = Date.now();
          await launch(model, runtime, quantized);
          starts += 1;
          ctx.log(`local AI started: ${model.id} on ${runtime.id}, cache ${activeCache}, ${Date.now() - t0} ms`);
          set({ phase: "running", detail: "The AI is running on this computer.", error: undefined });
          if (child) startSampling(child);
          touchIdle();
          return;
        } catch (e) {
          failure = e;
          ctx.log(`local AI start failed (${runtime.id}, ${quantized ? "q8" : "f16"} cache): ${e instanceof Error ? e.message : String(e)}`);
          if ((e as { timeout?: boolean }).timeout) break;
        }
      }
    }
    const message = failure instanceof Error ? failure.message : "The AI on this computer could not start. Try again.";
    set({ phase: "failed", detail: message, error: message });
    throw new Error(message);
  }

  function start(): Promise<void> {
    if (installing) return Promise.reject(new Error("The AI on this computer is still being installed. Please wait for it to finish."));
    if (alive(child) && baseUrl) return Promise.resolve();
    if (!starting) starting = doStart().finally(() => { starting = null; });
    return starting;
  }

  async function stop(): Promise<void> {
    clearIdle();
    if (starting) await starting.catch(() => undefined);
    await killChild();
    if (status.phase === "running" || status.phase === "starting" || status.phase === "sleeping") set(idleStatus());
  }

  // ---- idle unload ------------------------------------------------------------------------
  function clearIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }
  function touchIdle(): void {
    clearIdle();
    const seconds = ctx.getSettings().idleUnloadSeconds;
    if (!(seconds > 0) || inflight > 0 || !alive(child)) return;
    idleTimer = setTimeout(() => void sleep(), seconds * 1000);
    idleTimer.unref();
  }
  async function sleep(): Promise<void> {
    if (inflight > 0 || starting || !alive(child)) return;
    set({ phase: "sleeping", detail: "Resting to free up memory. It wakes up by itself when you ask for something." });
    await killChild();
    ctx.log("local AI unloaded after idle");
  }

  // ---- client -----------------------------------------------------------------------------
  const llm: InferenceClient = createOpenAiCompatClient("http://127.0.0.1", { ai: "local", files: "this-computer" }, {
    apiKey,
    resolveBaseUrl: () => baseUrl ?? "http://127.0.0.1:1",
    beforeRequest: async () => {
      inflight += 1;
      clearIdle();
      await start();
    },
    afterRequest: () => {
      inflight = Math.max(0, inflight - 1);
      touchIdle();
    },
  });

  // A server left behind by a crashed app would keep gigabytes of memory.
  function reapOrphan(): void {
    try {
      const pid = Number.parseInt(readFileSync(pidPath, "utf8"), 10);
      rmSync(pidPath, { force: true });
      if (Number.isFinite(pid)) {
        void isLlamaServer(pid).then((yes) => {
          if (!yes) return;
          try { process.kill(pid); } catch { /* already gone */ }
        });
      }
    } catch { /* no pid file */ }
  }
  reapOrphan();
  process.once("exit", () => { try { child?.kill(); } catch { /* ignore */ } });

  return {
    status: () => status,
    install,
    cancel,
    start,
    stop,
    client: () => llm,
    isReady: () => status.phase === "ready" || status.phase === "running" || status.phase === "sleeping",
    debug: () => ({ pid: child?.pid ?? null, baseUrl, runtime: activeRuntime, cacheType: activeCache, starts, logPath }),
  };
}
