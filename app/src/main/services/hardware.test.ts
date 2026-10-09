import { describe, expect, it } from "vitest";
import type { HardwareReport } from "../../shared/contracts";
import { CAVEAT, recommend } from "./hardware";

const GB = 1024 ** 3;
// Fixed machines, not real probes: this checks the decision rule only.
const machine = (over: Partial<HardwareReport>): HardwareReport => ({
  platform: "win32",
  arch: "x64",
  cpu: "Test CPU",
  cores: 8,
  ramBytes: 16 * GB,
  freeRamBytes: 8 * GB,
  gpuName: "Test GPU",
  gpuMemoryBytes: 8 * GB,
  accel: "vulkan",
  diskFreeBytes: 100 * GB,
  modelDir: "C:\\x",
  supported: true,
  ...over,
});

describe("recommend", () => {
  it("returns nothing for unsupported machines", () => {
    expect(recommend(machine({ supported: false, unsupportedReason: "Intel Mac" })).recommendation).toBeNull();
  });
  it("returns nothing under 6 GB", () => {
    expect(recommend(machine({ ramBytes: 4 * GB })).recommendation).toBeNull();
  });
  it("offers the 4B in limited mode from 6 to 12 GB", () => {
    for (const ram of [6, 8, 11.5]) {
      const r = recommend(machine({ ramBytes: ram * GB }));
      expect(r.recommendation?.modelId).toBe("qwen3.5-4b");
      expect(r.recommendation?.mode).toBe("limited");
    }
  });
  it("recommends the 9B from 12 GB and offers the 4B as an alternative", () => {
    const r = recommend(machine({ ramBytes: 16 * GB }));
    expect(r.recommendation?.modelId).toBe("qwen3.5-9b");
    expect(r.recommendation?.mode).toBe("recommended");
    expect(r.alternatives.map((a) => a.modelId)).toEqual(["qwen3.5-4b"]);
  });
  it("leads with the 4B when there is plenty of memory but no graphics acceleration", () => {
    const r = recommend(machine({ ramBytes: 32 * GB, accel: "cpu", gpuName: null }));
    expect(r.recommendation?.modelId).toBe("qwen3.5-4b");
    expect(r.alternatives[0]?.modelId).toBe("qwen3.5-9b");
  });
  it("never claims guaranteed minimums and avoids jargon", () => {
    const r = recommend(machine({}));
    expect(r.recommendation?.caveat).toBe(CAVEAT);
    expect(CAVEAT).toMatch(/not promises/);
    expect(r.recommendation?.why).not.toMatch(/token|context window|quantiz|VRAM|GGUF/i);
  });
  it("warns when the drive is nearly full", () => {
    expect(recommend(machine({ diskFreeBytes: 3 * GB })).recommendation?.why).toMatch(/drive space/);
  });
});
