import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { ProviderId } from "../../../shared/contracts";
import { LABELS, ProviderError } from "./types";
import type { ResolvedBin } from "./bin";

export interface CliExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Set when the program could not be started at all (missing, not executable). */
  spawnError?: NodeJS.ErrnoException;
}

export interface CliHandle {
  readonly child: ChildProcess;
  readonly closed: Promise<CliExit>;
  write(text: string): void;
  endInput(): void;
  /** Stops the program and everything it started. Resolves when the program is gone. */
  kill(): Promise<void>;
  /** Raw tail of stderr. Scrub before showing. */
  stderr(): string;
}

export interface StartOptions {
  bin: ResolvedBin;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  onLine?: (line: string) => void;
}

const STDERR_KEEP = 16 * 1024;

/** Lets evidence scripts see every program NONON starts, so a cancel test can prove the whole tree is gone. */
export const spawnObserver: { onSpawn?: (pid: number, command: string) => void } = {};

/** Kills the whole process tree. On Windows a plain kill leaves grandchildren (MCP servers, shells) running. */
export function killTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((done) => {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {
        // taskkill fails when the tree is already gone; a direct kill covers the case where it could not run at all.
        try {
          child.kill();
        } catch {
          /* already gone */
        }
        done();
      });
    });
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
  return Promise.resolve();
}

/** A missing staged folder would otherwise surface as a bare ENOENT from the spawn call. */
export function assertWorkingFolder(provider: ProviderId, cwd: string): void {
  if (!existsSync(cwd)) throw new ProviderError(provider, "spawn", `${LABELS[provider]} could not start because its temporary folder is missing. Please try again.`);
}

export function startCli(opts: StartOptions): CliHandle {
  const env = { ...opts.env, ...opts.bin.env };
  const child = spawn(opts.bin.command, [...opts.bin.prefixArgs, ...opts.args], {
    cwd: opts.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    // Own process group on POSIX so killTree can reach the children; Windows uses taskkill /T instead.
    detached: process.platform !== "win32",
  });
  if (child.pid) spawnObserver.onSpawn?.(child.pid, opts.bin.display || opts.bin.command);
  // A write to a process that just died errors asynchronously on Windows; the exit event already tells us.
  child.stdin?.on("error", () => {});

  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
    if (stderr.length > STDERR_KEEP) stderr = stderr.slice(-STDERR_KEEP);
  });

  let buffer = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (line.trim()) opts.onLine?.(line);
    }
  });

  let spawnError: NodeJS.ErrnoException | undefined;
  const closed = new Promise<CliExit>((resolve) => {
    let done = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (done) return;
      done = true;
      if (buffer.trim()) {
        const rest = buffer;
        buffer = "";
        opts.onLine?.(rest);
      }
      resolve({ code, signal, ...(spawnError ? { spawnError } : {}) });
    };
    child.on("error", (e: NodeJS.ErrnoException) => {
      spawnError = e;
      finish(null, null);
    });
    child.on("close", finish);
    // 'close' waits for every holder of the pipes; if a grandchild escaped the kill, 'exit' still ends the turn.
    child.on("exit", (code, signal) => {
      setTimeout(() => finish(code, signal), 1500).unref?.();
    });
  });

  return {
    child,
    closed,
    write(text) {
      try {
        child.stdin?.write(text);
      } catch {
        /* the exit event reports it */
      }
    },
    endInput() {
      try {
        child.stdin?.end();
      } catch {
        /* ignore */
      }
    },
    async kill() {
      await killTree(child);
      await Promise.race([closed, new Promise((r) => setTimeout(r, 5000).unref?.())]);
    },
    stderr: () => stderr,
  };
}

export type StopReason = "aborted" | "timeout";

export interface Supervisor {
  /** Why the program was stopped, if NONON stopped it. */
  readonly stopped: StopReason | null;
  dispose(): void;
}

/** Enforces the cancel signal and the turn timeout on a running program. */
export function supervise(handle: CliHandle, opts: { signal?: AbortSignal; timeoutMs: number }): Supervisor {
  let stopped: StopReason | null = null;
  const stop = (why: StopReason) => {
    if (stopped) return;
    stopped = why;
    void handle.kill();
  };
  const timer = setTimeout(() => stop("timeout"), opts.timeoutMs);
  timer.unref?.();
  const onAbort = () => stop("aborted");
  if (opts.signal?.aborted) onAbort();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });
  return {
    get stopped() {
      return stopped;
    },
    dispose() {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    },
  };
}

export interface OneShot {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError?: NodeJS.ErrnoException;
  timedOut: boolean;
}

/** Runs a short status command (`--version`, `auth status`) and collects its output. */
export async function runOnce(
  bin: ResolvedBin,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  timeoutMs = 15000,
): Promise<OneShot> {
  let stdout = "";
  const handle = startCli({
    bin,
    args,
    cwd,
    env,
    onLine: (l) => {
      stdout += l + "\n";
    },
  });
  handle.endInput();
  const sup = supervise(handle, { timeoutMs });
  const exit = await handle.closed;
  sup.dispose();
  return {
    code: exit.code,
    stdout,
    stderr: handle.stderr(),
    ...(exit.spawnError ? { spawnError: exit.spawnError } : {}),
    timedOut: sup.stopped === "timeout",
  };
}
