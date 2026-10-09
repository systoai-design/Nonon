import { describe, expect, it } from "vitest";
import { procedures as general } from "../general";
import { procedures as meeting } from "../meeting-followup";
import { procedures as study } from "../study-packet";

const mine = [...meeting, ...study, ...general];

describe("document procedure definitions", () => {
  it("registers the five procedures with the right packs", () => {
    expect(mine.map((p) => `${p.pack}/${p.id}`).sort()).toEqual([
      "business/meeting-followup",
      "education/lesson-outline",
      "education/study-packet",
      "general/document-draft",
      "general/organize-folder-review",
    ]);
  });

  it("every definition states exactly what it supports and where it stops", () => {
    for (const p of mine) {
      expect(p.revision, p.id).toBe("1");
      expect(p.supports.length, p.id).toBeGreaterThan(60);
      expect(p.limits.length, p.id).toBeGreaterThanOrEqual(3);
      expect(p.summary.length, p.id).toBeGreaterThan(20);
      expect(new Set(p.inputs.map((i) => i.key)).size, p.id).toBe(p.inputs.length);
      for (const i of p.inputs) if (i.kind === "file" || i.kind === "files") expect(i.accept, `${p.id}.${i.key}`).toEqual(expect.arrayContaining([".txt"]));
    }
  });

  it("user-visible copy avoids jargon and em dashes", () => {
    const text = mine.flatMap((p) => [p.title, p.summary, p.supports, ...p.limits, ...p.inputs.flatMap((i) => [i.label, i.help ?? ""])]).join("\n");
    expect(text).not.toMatch(/[—–]/);
    expect(text).not.toMatch(/\b(?:token|inference|context window|LLM)s?\b/i);
  });
});
