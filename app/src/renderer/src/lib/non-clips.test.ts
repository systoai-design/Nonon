import { describe, expect, it } from "vitest";
import { NON_CLIPS } from "../assets/non/clips";
import { CLIP_FOR_STATE } from "./non-clips";

describe("Non clips", () => {
  it("has a clip for every state, and only one-shot clips for greeting and success", () => {
    for (const state of ["idle", "greeting", "listening", "thinking", "talking", "success"] as const) {
      expect(NON_CLIPS[CLIP_FOR_STATE[state].clip], state).toBeTruthy();
    }
    expect(CLIP_FOR_STATE.greeting.loop).toBe(false);
    expect(CLIP_FOR_STATE.success.loop).toBe(false);
    expect(CLIP_FOR_STATE.idle.loop && CLIP_FOR_STATE.thinking.loop && CLIP_FOR_STATE.talking.loop && CLIP_FOR_STATE.listening.loop).toBe(true);
  });
});
