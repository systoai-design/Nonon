import { describe, expect, it } from "vitest";
import type { TaskState } from "../../../shared/contracts";
import { aiHint, aiLabel, plainError, stateLabel } from "./format";

describe("plainError", () => {
  it("strips the Electron wrapper and keeps a plain sentence", () => {
    const e = new Error("Error invoking remote method 'task:start': Error: Pick a spreadsheet first");
    expect(plainError(e)).toBe("Pick a spreadsheet first.");
  });

  it("never shows raw technical text", () => {
    const raw = [
      "Error invoking remote method 'x': TypeError: Cannot read properties of undefined (reading 'id')",
      "ipc handler for task:resume failed",
      "Unexpected token < in JSON at position 0",
      "at Object.run (C:\\app\\main\\index.js:12:5)",
      "{\"code\":500}",
    ];
    for (const r of raw) {
      const out = plainError(new Error(r));
      expect(out).not.toMatch(/ipc|undefined|JSON|\.js|TypeError|\{/);
      expect(out).toMatch(/Something went wrong/);
    }
  });

  it("explains file and network failures in plain words", () => {
    expect(plainError(new Error("ENOENT: no such file or directory, open 'C:\\a.xlsx'"))).toMatch(/could not find that file/);
    expect(plainError(new Error("EBUSY: resource busy or locked"))).toMatch(/open in another app/);
    expect(plainError(new Error("connect ECONNREFUSED 127.0.0.1:1"))).toMatch(/reach the internet/);
  });

  it("handles empty and non-error values", () => {
    expect(plainError(undefined)).toMatch(/Something went wrong/);
    expect(plainError("")).toMatch(/Something went wrong/);
  });
});

describe("plain labels", () => {
  it("uses the agreed task status words", () => {
    const want: Record<TaskState, string> = {
      inspecting: "Looking at your files",
      clarifying: "Needs a quick answer from you",
      running: "Working on it",
      validating: "Double-checking",
      review: "Ready for you to check",
      applying: "Making the change",
      complete: "Done",
      interrupted: "Stopped",
      waiting: "Waiting",
      "needs-attention": "Needs a look",
      rejected: "You said no",
      failed: "Something went wrong",
    };
    for (const [state, text] of Object.entries(want)) expect(stateLabel(state as TaskState)).toBe(text);
  });

  it("explains where the AI runs", () => {
    expect(aiLabel("claude")).toBe("Claude (online)");
    expect(aiHint("local")).toBe("The thinking happens on this computer. Nothing is sent to the internet.");
    expect(aiHint("claude")).toBe("The parts of your files this task needs are sent to Claude.");
  });
});
