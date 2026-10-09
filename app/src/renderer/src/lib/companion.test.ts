import { describe, expect, it } from "vitest";
import { statusFor, type NonState } from "./companion";

describe("statusFor", () => {
  it("gives every state a readable line that does not depend on seeing the animation", () => {
    const states: NonState[] = ["idle", "greeting", "listening", "thinking", "talking", "success"];
    const lines = states.map((s) => statusFor(s, "Non"));
    expect(lines).toEqual(["Non is ready", "Hi, I'm Non", "Non is listening", "Non is working on it", "Non is writing a reply", "Done"]);
    expect(new Set(lines).size).toBe(states.length);
  });

  it("uses the name the person chose", () => {
    expect(statusFor("thinking", "Biscuit")).toBe("Biscuit is working on it");
  });
});
