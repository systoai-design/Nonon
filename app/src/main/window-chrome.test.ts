import { describe, expect, it } from "vitest";
import { fitToWorkArea } from "./window-chrome";

describe("fitToWorkArea", () => {
  it("keeps the normal size on a big screen", () => {
    expect(fitToWorkArea({ width: 1920, height: 1040 })).toEqual({ width: 1280, height: 820, minWidth: 960, minHeight: 640 });
  });
  it("shrinks to a short screen so the message box stays visible", () => {
    const s = fitToWorkArea({ width: 1536, height: 784 });
    expect(s.height).toBe(784);
    expect(s.width).toBe(1280);
  });
  it("never lets the minimum exceed the screen", () => {
    const s = fitToWorkArea({ width: 900, height: 600 });
    expect(s).toEqual({ width: 900, height: 600, minWidth: 900, minHeight: 600 });
  });
});
