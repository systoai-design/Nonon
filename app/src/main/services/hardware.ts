import { cpus, freemem, totalmem } from "node:os";
import type { HardwareReport, ModelRecommendation } from "../../shared/contracts";
import type { AppCtx, HardwareService } from "./types";
import { findModel, unsupportedReason, type LocalModel } from "./runtime/catalog";
import { cudaDriverRuns, freeDiskBytes, readWindowsGpu } from "./runtime/sys";

const GB = 1024 ** 3;

export const CAVEAT =
  "These are our best estimates from computers we tested. They are not promises. Other open apps, a slow drive or an old graphics card can make it slower.";

export interface Assessment {
  report: HardwareReport;
  recommendation: ModelRecommendation | null;
  alternatives: ModelRecommendation[];
}

function rec(modelId: string, mode: ModelRecommendation["mode"], why: string): ModelRecommendation {
  const m = findModel(modelId) as LocalModel;
  return { modelId, label: m.label, mode, downloadBytes: m.bytes, why, caveat: CAVEAT };
}

/** Pure decision from a hardware report: no AI, no network, testable with fixed machines. */
export function recommend(report: HardwareReport): Pick<Assessment, "recommendation" | "alternatives"> {
  if (!report.supported) return { recommendation: null, alternatives: [] };
  const ramGb = report.ramBytes / GB;
  if (ramGb < 6) return { recommendation: null, alternatives: [] };

  const tight = report.diskFreeBytes < 6 * GB;
  const diskNote = tight ? " Free up some drive space first. The download needs a few gigabytes." : "";
  const small = rec(
    "qwen3.5-4b",
    "limited",
    `This computer has about ${Math.round(ramGb)} GB of memory. The smaller AI fits well and runs without internet. It is quicker, but less careful with long or tricky documents.${diskNote}`,
  );
  if (ramGb < 12) return { recommendation: small, alternatives: [] };

  // Without a graphics card the larger helper would write slowly, so the smaller one leads there.
  if (report.accel === "cpu") {
    const large = rec(
      "qwen3.5-9b",
      "recommended",
      "More careful with long documents, but this computer has no graphics card, so it would be slow.",
    );
    return {
      recommendation: rec(
        "qwen3.5-4b",
        "limited",
        `This computer has plenty of memory but no graphics card, so the smaller AI will feel quicker. It runs without internet.${diskNote}`,
      ),
      alternatives: [large],
    };
  }

  return {
    recommendation: rec(
      "qwen3.5-9b",
      "recommended",
      `This computer has about ${Math.round(ramGb)} GB of memory${report.gpuName ? `, plus a graphics card (${report.gpuName})` : ""}, enough for the more careful AI. It runs without internet.${diskNote}`,
    ),
    alternatives: [rec("qwen3.5-4b", "limited", "Smaller and quicker. A good choice if you want to keep memory free for other apps.")],
  };
}

async function readReport(modelDir: string): Promise<HardwareReport> {
  const platform = process.platform === "win32" || process.platform === "darwin" ? process.platform : "linux";
  const arch = process.arch;
  const reason = unsupportedReason(process.platform, arch);
  const cpu = cpus();
  const base = {
    platform,
    arch,
    cpu: cpu[0]?.model.trim() ?? "Unknown processor",
    cores: cpu.length,
    ramBytes: totalmem(),
    freeRamBytes: freemem(),
    diskFreeBytes: freeDiskBytes(modelDir) ?? 0,
    modelDir,
    supported: reason === undefined,
    ...(reason ? { unsupportedReason: reason } : {}),
  } as const;

  if (process.platform === "darwin" && arch === "arm64") {
    // Unified memory: the GPU shares system RAM, so the whole figure is what the model can use.
    return { ...base, gpuName: cpu[0]?.model.trim() ?? "Apple silicon", gpuMemoryBytes: totalmem(), accel: "metal" };
  }
  if (process.platform === "win32" && arch === "x64") {
    const gpu = await readWindowsGpu();
    const accel = gpu.nvidia && cudaDriverRuns(gpu.cuda) ? "cuda" : gpu.name ? "vulkan" : "cpu";
    return { ...base, gpuName: gpu.name, gpuMemoryBytes: gpu.memoryBytes, accel };
  }
  return { ...base, gpuName: null, gpuMemoryBytes: null, accel: "cpu" };
}

export function createHardwareService(ctx: Pick<AppCtx, "paths">): HardwareService {
  let last: HardwareReport | null = null;
  return {
    async assess() {
      const report = await readReport(ctx.paths.modelDir);
      last = report;
      return { report, ...recommend(report) };
    },
    last: () => last,
  };
}
