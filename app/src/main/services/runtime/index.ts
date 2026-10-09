import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { CustomModel, DiscoveredModel, InferenceClient, RuntimeStatus } from "../../../shared/contracts";
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
import { discoverReport, inspectModelFile, type DiscoverOptions, type DiscoveredFile } from "./discover";
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
  /** Memory figures for the fit check; defaults to what the operating system reports. */
  machine?: () => { ramBytes: number } | null;
  /** Overrides for the search for AI files already on the computer (tests point it at temporary folders). */
  discover?: Partial<DiscoverOptions>;
}

/** The AI file the server is started with: NONON's own download, or one the person already had. */
interface ActiveModel {
  id: string;
  label: string;
  path: string;
  bytes: number;
  custom: boolean;
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

  const isFile = (p: string) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  };

  function customActive(): ActiveModel | null {
    const c = ctx.getSettings().customModel;
    if (!c || !isFile(c.path)) return null;
    return { id: c.kind === "exact" && c.modelId ? c.modelId : "custom", label: c.label, path: c.path, bytes: c.bytes, custom: true };
  }

  function pinnedActive(): ActiveModel | null {
    const wanted = ctx.getSettings().modelId;
    const wantedModel = wanted ? findModel(wanted) : undefined;
    const m = wantedModel && existsSync(modelPath(wantedModel)) ? wantedModel : [...MODELS].reverse().find((x) => existsSync(modelPath(x)));
    return m ? { id: m.id, label: m.label, path: modelPath(m), bytes: m.bytes, custom: false } : null;
  }

  /** A file the person chose wins over NONON's own download. If it has gone missing, the own download (if any) is used instead. */
  const activeModel = (): ActiveModel | null => customActive() ?? pinnedActive();

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
  const ENGINE_NOTE = "The AI engine (about 30 to 150 MB) still needs a one-time download.";
  const idleStatus = (detail?: string): Partial<RuntimeStatus> => {
    const active = activeModel();
    const engine = anyRuntimeInstalledSync();
    const chosen = ctx.getSettings().customModel;
    let text = detail;
    if (!text) {
      if (active && !engine) text = ENGINE_NOTE;
      else if (active) text = "Installed and ready.";
      else if (chosen) text = `The AI file you chose (${chosen.label}) is no longer where it was. Choose it again, pick another one, or download the AI we recommend.`;
      else text = "The AI on this computer is not installed yet.";
    }
    return {
      phase: active && engine ? "ready" : "not-installed",
      modelId: active?.id ?? (chosen ? null : status.modelId),
      modelLabel: active?.custom ? active.label : undefined,
      progress: null,
      bytesDone: null,
      bytesTotal: null,
      detail: text,
    };
  };
  function anyRuntimeInstalledSync(): boolean {
    const list = runtimeCandidates(platform, arch, true);
    return list.some((p) => existsSync(exeOf(p)));
  }
  if (reason) status = { ...status, phase: "not-installed", detail: reason, error: reason };
  else status = { ...status, ...idleStatus() };

  // ---- install ----------------------------------------------------------------------------
  let installing: { modelId: string; kind: "pinned" | "engine"; promise: Promise<void>; abort: AbortController } | null = null;

  /** Downloads the llama.cpp engine unless one is already unpacked. `extraBytes` is what the caller still has to fetch, for the disk check. */
  async function ensureEngine(modelId: string, abort: AbortController, extraBytes: number, spare: number): Promise<void> {
    const list = await candidates();
    const have = anyRuntimeInstalled(list);
    const runtime = have ?? list[0];
    if (!runtime) throw new Error(reason ?? "The AI on this computer cannot run on this machine.");

    const needRuntime = have === null;
    const runtimeBytes = needRuntime ? runtime.bytes + (runtime.extra?.bytes ?? 0) : 0;
    const needs = runtimeBytes + extraBytes + spare;
    const free = freeDiskBytes(root);
    if (free !== null && needs > 0 && free < needs) {
      throw new Error(`There is not enough room on this drive. The AI on this computer needs about ${gb(needs)}, and only ${gb(free)} is free. Free up some space, then press install again. Nothing was installed.`);
    }
    mkdirSync(join(root, "runtime", runtime.folder), { recursive: true });

    if (needRuntime) {
      const archives = [runtime, ...(runtime.extra ? [runtime.extra] : [])];
      for (const [i, pin] of archives.entries()) {
        const archive = join(root, `engine-${runtime.folder}-${i}${pin.url.endsWith(".tar.gz") ? ".tar.gz" : ".zip"}`);
        const detail = "Downloading the helper files the AI needs.";
        set({ phase: "downloading-runtime", modelId, progress: 0, bytesDone: 0, bytesTotal: pin.bytes, detail });
        await fetchPinned(pin, archive, {
          signal: abort.signal,
          onProgress: (done, total) => set({ phase: "downloading-runtime", modelId, progress: total ? done / total : null, bytesDone: done, bytesTotal: total, detail }, true),
          onVerifying: () => set({ phase: "verifying", detail: "Checking that the file downloaded correctly." }),
        });
        set({ phase: "installing", detail: "Setting up the helper files.", progress: null });
        await extractArchive(archive, join(root, "runtime", runtime.folder));
        rmSync(archive, { force: true });
      }
      if (!existsSync(exeOf(runtime))) throw new Error("The AI helper files are incomplete. Press install to try again.");
    }
  }

  async function doInstall(model: LocalModel, abort: AbortController): Promise<void> {
    const part = (file: string) => (existsSync(`${file}.part`) ? statSync(`${file}.part`).size : 0);
    const modelFile = modelPath(model);
    const modelBytes = existsSync(modelFile) ? 0 : model.bytes - part(modelFile);
    await ensureEngine(model.id, abort, modelBytes, SPARE_DISK_BYTES);

    if (!existsSync(modelFile)) {
      const detail = "Downloading the AI. This is a big file, so it may take a while.";
      set({ phase: "downloading-model", modelId: model.id, progress: 0, bytesDone: 0, bytesTotal: model.bytes, detail });
      await fetchPinned(model, modelFile, {
        signal: abort.signal,
        onProgress: (done, total) => set({ phase: "downloading-model", modelId: model.id, progress: total ? done / total : null, bytesDone: done, bytesTotal: total, detail }, true),
        onVerifying: () => set({ phase: "verifying", detail: "Checking that the file downloaded correctly." }),
      });
    }
    // Downloading NONON's own AI is an explicit choice, so it replaces a file the person had pointed NONON at.
    ctx.updateSettings({ modelId: model.id, customModel: undefined });
    set({ ...idleStatus("The AI is installed and ready."), modelId: model.id, error: undefined });
  }

  /** One install job at a time: the pinned download, or just the engine for an AI file the person already had. */
  function runJob(modelId: string, kind: "pinned" | "engine", job: (abort: AbortController) => Promise<void>, paused: string): Promise<void> {
    const abort = new AbortController();
    const promise = (async () => {
      if (child && status.modelId !== modelId) await stop();
      try {
        await job(abort);
      } catch (e) {
        if (e instanceof DownloadCancelled || abort.signal.aborted) {
          set({ ...idleStatus(paused) });
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        set({ phase: "failed", modelId, progress: null, bytesDone: null, bytesTotal: null, detail: message, error: message });
        throw e;
      } finally {
        installing = null;
      }
    })();
    installing = { modelId, kind, promise, abort };
    return promise;
  }

  function install(modelId: string): Promise<void> {
    const model = findModel(modelId);
    if (!model) return Promise.reject(new Error("That AI is not one of the choices NONON offers."));
    if (reason) return Promise.reject(new Error(reason));
    if (installing) {
      if (installing.modelId === modelId) return installing.promise;
      return Promise.reject(new Error("Another install is already running. Wait for it to finish, or stop it first."));
    }
    return runJob(modelId, "pinned", (abort) => doInstall(model, abort), "Download paused. Press install to carry on from where it stopped.");
  }

  function cancel(): void {
    installing?.abort.abort();
  }

  // ---- AI files the person already has ------------------------------------------------------
  // The window only ever sends back an id from this map, never a path, so it cannot point NONON at an arbitrary file.
  const found = new Map<string, DiscoveredFile>();
  const hashCache = new Map<string, string>();
  let discovering: AbortController | null = null;

  const discoverOptions = (): DiscoverOptions => ({ modelDir: root, ramBytes: opts.machine?.()?.ramBytes ?? totalmem(), platform, hashCache, ...opts.discover });

  async function discover(): Promise<DiscoveredModel[]> {
    discovering?.abort();
    const mine = new AbortController();
    discovering = mine;
    const report = await discoverReport({ ...discoverOptions(), signal: mine.signal });
    if (mine.signal.aborted) return [];
    found.clear();
    for (const f of report.models) found.set(f.id, f);
    ctx.log(`looked for AI files already on this computer: ${report.models.length} usable, ${report.scanMs} ms looking, ${report.hashMs} ms checking${report.timedOut ? " (stopped at the time limit)" : ""}`);
    return report.models.map(({ path: _path, ...shown }) => shown);
  }

  async function adopt(file: DiscoveredFile): Promise<RuntimeStatus> {
    if (reason) throw new Error(reason);
    if (installing) throw new Error("Another install is already running. Wait for it to finish, or stop it first.");
    if (!isFile(file.path)) throw new Error("NONON could not find that file any more. It may have been moved or deleted.");
    await stop();
    const pin = file.modelId ? findModel(file.modelId) : undefined;
    if (pin && resolve(modelPath(pin)) === resolve(file.path)) {
      ctx.updateSettings({ modelId: pin.id, customModel: undefined });
    } else {
      const custom: CustomModel = {
        path: file.path,
        label: file.label,
        kind: file.kind === "exact" ? "exact" : "compatible",
        ...(file.kind === "exact" && file.modelId ? { modelId: file.modelId } : {}),
        bytes: file.bytes,
      };
      ctx.updateSettings({ customModel: custom, modelId: custom.modelId ?? "custom" });
      ctx.log(`using an AI file that was already on this computer (${custom.kind}): ${file.path}`);
    }
    set({ ...idleStatus(), error: undefined });
    const active = activeModel();
    if (active && status.phase === "not-installed") {
      // Only the small engine is missing. The AI file itself is used where it is.
      void runJob(active.id, "engine", async (abort) => {
        await ensureEngine(active.id, abort, 0, 300_000_000);
        set({ ...idleStatus(), error: undefined });
      }, "Download paused. Choose the AI again to carry on.").catch((e) => ctx.log(`engine download failed: ${String(e)}`));
    }
    return status;
  }

  function useExisting(id: string): Promise<RuntimeStatus> {
    const file = found.get(id);
    if (!file) return Promise.reject(new Error("That choice is no longer on the list. Look again, then pick one."));
    return adopt(file);
  }

  async function useFile(path: string): Promise<RuntimeStatus> {
    const checked = await inspectModelFile(path, discoverOptions());
    if (!checked.ok) throw new Error(checked.message);
    return adopt(checked.file);
  }

  async function forgetExisting(): Promise<RuntimeStatus> {
    if (installing?.kind === "engine") {
      installing.abort.abort();
      await installing.promise.catch(() => undefined);
    }
    await stop();
    const s = ctx.getSettings();
    if (s.customModel) ctx.updateSettings({ customModel: undefined, modelId: s.modelId === "custom" ? null : s.modelId });
    set({ ...idleStatus(), modelId: activeModel()?.id ?? null, error: undefined });
    return status;
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

  async function launch(model: ActiveModel, runtime: RuntimePin, quantized: boolean): Promise<void> {
    const exe = exeOf(runtime);
    stageVcRuntime(exe);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    lastLines.length = 0;
    const cache = quantized ? "q8_0" : "f16";
    // No -ngl: llama.cpp's --fit (on by default) puts every layer on the GPU when it fits and spills the rest otherwise.
    const args = [
      "--model", model.path,
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
    const model = activeModel();
    if (!model) throw new Error("The AI on this computer is not installed yet. Install it first.");
    const list = await candidates();
    const present = list.filter((p) => existsSync(exeOf(p)));
    if (!present.length) throw new Error("The AI helper files are not installed yet. Install them first.");

    await killChild();
    set({ phase: "starting", modelId: model.id, modelLabel: model.custom ? model.label : undefined, progress: null, bytesDone: null, bytesTotal: null, detail: "Waking up the AI on this computer.", error: undefined, contextTokens: CONTEXT_TOKENS });
    let failure: unknown = null;
    for (const runtime of present) {
      for (const quantized of [true, false]) {
        try {
          const t0 = Date.now();
          await launch(model, runtime, quantized);
          starts += 1;
          ctx.log(`local AI started: ${model.id} from ${model.path} on ${runtime.id}, cache ${activeCache}, ${Date.now() - t0} ms`);
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
    discover,
    useExisting,
    useFile,
    forgetExisting,
    isReady: () => status.phase === "ready" || status.phase === "running" || status.phase === "sleeping",
    debug: () => ({ pid: child?.pid ?? null, baseUrl, runtime: activeRuntime, cacheType: activeCache, starts, logPath }),
  };
}
