import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import type { CloudPolicy, ProviderStatus, Workspace } from "../../../shared/contracts";
import { createStore } from "../store";
import type { AppCtx } from "../types";

export function tempDir(root: string, label: string): string {
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, `${label}-`));
}

export interface FakeCtx {
  ctx: AppCtx;
  workspace: Workspace;
  events: ProviderStatus[][];
  setPolicy(policy: CloudPolicy): void;
}

/** A throwaway app context: real JSON store in a temp folder, one fake workspace. Used by tests only. */
export function fakeCtx(root: string, policy: CloudPolicy = "cloud-allowed"): FakeCtx {
  const dataDir = tempDir(root, "data");
  const workspace: Workspace = {
    id: "ws-test",
    name: "Test workspace",
    folder: null,
    pack: "general",
    policy,
    autoApply: false,
    createdAt: new Date(0).toISOString(),
  };
  const events: ProviderStatus[][] = [];
  const ctx = {
    paths: { dataDir, modelDir: join(dataDir, "models"), resourcesDir: dataDir, logFile: join(dataDir, "log.txt") },
    store: createStore(dataDir),
    emit: (event: string, payload: unknown) => {
      if (event === "providers:updated") events.push(payload as ProviderStatus[]);
    },
    log: () => {},
    recentLog: () => [],
    getSettings: () => ({}),
    updateSettings: () => ({}),
    svc: {
      workspaces: {
        get: (id: string) => (id === workspace.id ? workspace : undefined),
        outputDir: () => join(dataDir, "output"),
      },
      runtime: {
        client: () => ({
          location: { ai: "local" as const, files: "this-computer" as const },
          chat: async () => ({ text: "local-answer", location: { ai: "local" as const, files: "this-computer" as const } }),
        }),
      },
    },
  } as unknown as AppCtx;
  return {
    ctx,
    workspace,
    events,
    setPolicy(p) {
      workspace.policy = p;
    },
  };
}

/** Child process ids below `root`, found through the OS process table (Windows and POSIX). */
export function descendants(root: number): number[] {
  const rows: { pid: number; ppid: number }[] = [];
  if (process.platform === "win32") {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress"],
      { encoding: "utf8", windowsHide: true },
    );
    for (const r of JSON.parse(out) as { ProcessId: number; ParentProcessId: number }[]) rows.push({ pid: r.ProcessId, ppid: r.ParentProcessId });
  } else {
    const out = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
    for (const line of out.split("\n")) {
      const [a, b] = line.trim().split(/\s+/).map(Number);
      if (a && b !== undefined) rows.push({ pid: a, ppid: b });
    }
  }
  const found = new Set<number>();
  const queue = [root];
  while (queue.length) {
    const p = queue.shift() as number;
    for (const r of rows) if (r.ppid === p && !found.has(r.pid)) {
      found.add(r.pid);
      queue.push(r.pid);
    }
  }
  return [...found];
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
