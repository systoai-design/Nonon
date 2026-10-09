import { execFile } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { CUDA_DRIVER_NEEDED } from "./catalog";

function run(cmd: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((done) => {
    execFile(cmd, args, { windowsHide: true, timeout, encoding: "utf8", maxBuffer: 4_000_000 }, (err, stdout, stderr) => {
      done(err && !stdout ? "" : `${stdout ?? ""}${stderr ?? ""}`);
    });
  });
}

/** Free bytes on the drive that holds `folder`, or where it will be once created. Null when unreadable. */
export function freeDiskBytes(folder: string): number | null {
  let probe = resolve(folder);
  while (!existsSync(probe)) {
    const up = dirname(probe);
    if (up === probe) return null;
    probe = up;
  }
  try {
    const s = statfsSync(probe);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => done(port));
    });
  });
}

/** Resident memory of one process in bytes (Windows working set, macOS RSS). Null if the process is gone. */
export async function sampleRssBytes(pid: number): Promise<number | null> {
  if (process.platform === "win32") {
    const out = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], 5000);
    const m = /^"[^"]*","\d+","[^"]*","\d+","([\d.,\s ]+)\s*K"/m.exec(out);
    if (!m?.[1]) return null;
    const kb = Number.parseInt(m[1].replace(/\D/g, ""), 10);
    return Number.isFinite(kb) ? kb * 1024 : null;
  }
  const out = await run("ps", ["-o", "rss=", "-p", String(pid)], 5000);
  const kb = Number.parseInt(out.trim(), 10);
  return Number.isFinite(kb) ? kb * 1024 : null;
}

/** True only if `pid` is currently a llama-server process, so a recycled pid is never killed by mistake. */
export async function isLlamaServer(pid: number): Promise<boolean> {
  if (process.platform === "win32") {
    const out = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FI", "IMAGENAME eq llama-server.exe", "/FO", "CSV", "/NH"], 5000);
    return out.toLowerCase().includes("llama-server");
  }
  return (await run("ps", ["-o", "comm=", "-p", String(pid)], 5000)).includes("llama-server");
}

export interface GpuInfo {
  name: string | null;
  memoryBytes: number | null;
  nvidia: boolean;
  /** CUDA version the NVIDIA driver reports, e.g. {major:13,minor:3}. */
  cuda: { major: number; minor: number } | null;
}

export function cudaDriverRuns(cuda: GpuInfo["cuda"]): boolean {
  if (!cuda) return false;
  return cuda.major > CUDA_DRIVER_NEEDED.major || (cuda.major === CUDA_DRIVER_NEEDED.major && cuda.minor >= CUDA_DRIVER_NEEDED.minor);
}

export async function readWindowsGpu(): Promise<GpuInfo> {
  const info: GpuInfo = { name: null, memoryBytes: null, nvidia: false, cuda: null };
  const smi = await run("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], 6000);
  const row = smi
    .split(/\r?\n/)
    .map((l) => l.split(",").map((s) => s.trim()))
    .filter((c) => c.length >= 2 && Number.isFinite(Number(c[1])))
    .sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  if (row) {
    info.nvidia = true;
    info.name = row[0] ?? null;
    info.memoryBytes = Number(row[1]) * 1024 * 1024;
    const head = await run("nvidia-smi", [], 6000);
    const m = /CUDA (?:UMD )?Version:\s*(\d+)\.(\d+)/.exec(head);
    if (m) info.cuda = { major: Number(m[1]), minor: Number(m[2]) };
    return info;
  }
  const cim = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + '|' + $_.AdapterRAM }"],
    12000,
  );
  let best: { name: string; ram: number } | null = null;
  for (const line of cim.split(/\r?\n/)) {
    const [name, ram] = line.trim().split("|");
    if (!name || /basic render|remote|virtual|hyper-v/i.test(name)) continue;
    const bytes = Number(ram);
    if (!best || (Number.isFinite(bytes) && bytes > best.ram)) best = { name, ram: Number.isFinite(bytes) ? bytes : 0 };
  }
  if (best) {
    info.name = best.name;
    // WMI AdapterRAM is a 32-bit field and tops out at 4 GB, so it is only used when no better number exists.
    info.memoryBytes = best.ram > 0 ? best.ram : null;
    const reg = await run(
      "reg",
      ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}", "/s", "/v", "HardwareInformation.qwMemorySize"],
      6000,
    );
    let max = 0;
    for (const m of reg.matchAll(/qwMemorySize\s+REG_QWORD\s+0x([0-9a-f]+)/gi)) max = Math.max(max, Number.parseInt(m[1] ?? "0", 16));
    if (max > 0) info.memoryBytes = max;
  }
  return info;
}

/** Bytes of GPU memory in use by one process on NVIDIA cards, or null. Used only for evidence. */
export async function nvidiaUsedMemoryMiB(): Promise<number | null> {
  const out = await run("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], 5000);
  const n = Number.parseInt(out.trim().split(/\r?\n/)[0] ?? "", 10);
  return Number.isFinite(n) ? n : null;
}
