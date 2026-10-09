/** MOCKED adapter: proves the staging wrapper (copy in, inline text, diff out, clean up) without any vendor program. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DATA_GUARD, runStagedTurn } from "./run-turn";
import type { ProviderAdapter, TurnInput } from "./types";

const root = mkdtempSync(join(tmpdir(), "nonon-run-turn-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function adapter(act: (input: TurnInput) => void | Promise<void>): ProviderAdapter & { seen: TurnInput[] } {
  const seen: TurnInput[] = [];
  return {
    id: "claude",
    label: "Claude",
    seen,
    probe: async () => {
      throw new Error("not used");
    },
    signIn: async () => undefined,
    runTurn: async (input) => {
      seen.push(input);
      await act(input);
      return { text: "done", provider: "claude", durationMs: 1, denials: 0, warnings: [], effective: {} };
    },
  };
}

describe("runStagedTurn", () => {
  it("gives the provider only a copy, inlines plain text, adds the data guard, and removes the copy afterwards", async () => {
    const original = join(root, "report.txt");
    writeFileSync(original, "Q3 numbers: 42\n");
    const a = adapter((input) => {
      expect(readFileSync(join(input.cwd, "report.txt"), "utf8")).toContain("Q3 numbers");
    });
    const out = await runStagedTurn({
      adapter: a,
      stageRoot: join(root, "stages"),
      inputs: [{ name: "report.txt", fromPath: original }],
      prompt: "Summarise.",
      systemPrompt: "Be brief.",
    });
    const call = a.seen[0] as TurnInput;
    expect(call.cwd.startsWith(join(root, "stages"))).toBe(true);
    expect(call.cwd).not.toBe(root);
    expect(call.allowFileRead).toBe(true);
    expect(call.prompt).toContain("--- file: report.txt ---");
    expect(call.prompt).toContain("Q3 numbers: 42");
    expect(call.prompt.endsWith("Summarise.")).toBe(true);
    expect(call.systemPrompt).toContain(DATA_GUARD);
    expect(call.systemPrompt).toContain("Be brief.");
    expect(out.diff).toEqual({ added: [], modified: [], removed: [] });
    expect(existsSync(call.cwd)).toBe(false);
    expect(readFileSync(original, "utf8")).toBe("Q3 numbers: 42\n");
  });

  it("a provider that edits its copy changes nothing original; the change comes back as a suggestion in the output folder", async () => {
    const original = join(root, "letter.txt");
    writeFileSync(original, "Dear Sam\n");
    const a = adapter((input) => {
      writeFileSync(join(input.cwd, "letter.txt"), "Dear Samuel\n");
      writeFileSync(join(input.cwd, "extra.md"), "# extra\n");
    });
    const out = await runStagedTurn({
      adapter: a,
      stageRoot: join(root, "stages"),
      inputs: [{ name: "letter.txt", fromPath: original }],
      prompt: "Fix the name.",
      proposals: { outputDir: join(root, "NONON Output"), originals: { "letter.txt": original } },
    });
    expect(readFileSync(original, "utf8")).toBe("Dear Sam\n");
    expect(out.diff).toMatchObject({ added: ["extra.md"], modified: ["letter.txt"] });
    expect(out.warnings.join(" ")).toContain("only shown as suggestions");
    const targets = out.proposals.map((p) => p.target).sort();
    expect(targets).toEqual([original, join(root, "NONON Output", "extra.md")].sort());
    for (const p of out.proposals) for (const e of p.edits) if (e.op === "create-file") expect(e.path.startsWith(join(root, "NONON Output"))).toBe(true);
    expect(existsSync(join(root, "NONON Output"))).toBe(false);
  });

  it("cleans up the copy even when the provider fails", async () => {
    const a = adapter(() => {
      throw new Error("provider failed");
    });
    await expect(runStagedTurn({ adapter: a, stageRoot: join(root, "stages"), prompt: "x" })).rejects.toThrow("provider failed");
    expect(existsSync((a.seen[0] as TurnInput).cwd)).toBe(false);
  });

  it("does not inline binary files and says when text was left out for size", async () => {
    const a = adapter(() => undefined);
    await runStagedTurn({
      adapter: a,
      stageRoot: join(root, "stages"),
      inputs: [
        { name: "pic.png", content: Buffer.from([1, 2, 3, 0]) },
        { name: "a.txt", content: "A".repeat(150_000) },
        { name: "b.txt", content: "B".repeat(150_000) },
      ],
      prompt: "Look.",
    });
    const prompt = (a.seen[0] as TurnInput).prompt;
    expect(prompt).not.toContain("pic.png ---");
    expect(prompt).toContain("--- file: a.txt ---");
    expect(prompt).not.toContain("--- file: b.txt ---");
    expect(prompt).toContain("not shown here: b.txt");
  });
});
