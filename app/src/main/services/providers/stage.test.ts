import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createStage, diffStage, diffToProposals, safeRelativeName, sweepStages } from "./stage";

const root = mkdtempSync(join(tmpdir(), "nonon-stage-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("safeRelativeName", () => {
  it("rejects names that climb out or point elsewhere", () => {
    for (const bad of ["../x.txt", "a/../../x", "/etc/passwd", "C:\\Windows\\x", "", "."]) expect(() => safeRelativeName(bad)).toThrow();
    expect(safeRelativeName("sub\\a.txt")).toBe("sub/a.txt");
  });
});

describe("staged copy", () => {
  it("copies only the named inputs and leaves the original untouched", () => {
    const original = join(root, "original.csv");
    writeFileSync(original, "a,b\n1,2\n");
    const stage = createStage(join(root, "stages"), [{ name: "data.csv", fromPath: original }, { name: "brief.txt", content: "do the thing" }]);
    expect([...stage.baseline.keys()].sort()).toEqual(["brief.txt", "data.csv"]);
    expect(readFileSync(join(stage.dir, "data.csv"), "utf8")).toBe("a,b\n1,2\n");
    writeFileSync(join(stage.dir, "data.csv"), "tampered");
    expect(readFileSync(original, "utf8")).toBe("a,b\n1,2\n");
    stage.cleanup();
    expect(existsSync(stage.dir)).toBe(false);
  });

  it("diffs added, modified and removed files", () => {
    const stage = createStage(join(root, "stages"), [{ name: "a.txt", content: "one" }, { name: "b.txt", content: "two" }, { name: "c.txt", content: "three" }]);
    writeFileSync(join(stage.dir, "a.txt"), "ONE");
    rmSync(join(stage.dir, "b.txt"));
    writeFileSync(join(stage.dir, "new.md"), "# new");
    mkdirSync(join(stage.dir, "sub"));
    writeFileSync(join(stage.dir, "sub", "deep.txt"), "x");
    expect(diffStage(stage)).toEqual({ added: ["new.md", "sub/deep.txt"], modified: ["a.txt"], removed: ["b.txt"] });
    stage.cleanup();
  });

  it("refuses an oversized set without leaving a folder behind", () => {
    const big = Buffer.alloc(41 * 1024 * 1024);
    expect(() => createStage(join(root, "stages2"), [{ name: "big.bin", content: big }])).toThrow(/too large/);
    expect(readdirSync(join(root, "stages2"))).toEqual([]);
  });
});

describe("diffToProposals", () => {
  it("turns changes into new files in the output folder, never a write to the original", () => {
    const original = join(root, "notes.txt");
    const out = join(root, "NONON Output");
    const stage = createStage(join(root, "stages"), [{ name: "notes.txt", content: "keep\n" }, { name: "pic.png", content: Buffer.from([1, 2, 0, 3]) }]);
    writeFileSync(join(stage.dir, "notes.txt"), "keep\nplus\n");
    writeFileSync(join(stage.dir, "hello.txt"), "hi\n");
    writeFileSync(join(stage.dir, "pic.png"), Buffer.from([9, 9, 0]));
    rmSync(join(stage.dir, "notes.txt"), { force: false, recursive: false }); // removal wins over the edit
    writeFileSync(join(stage.dir, "notes.txt"), "keep\nplus\n");
    const diff = diffStage(stage);
    const proposals = diffToProposals(stage, diff, { outputDir: out, originals: { "notes.txt": original } });
    const edits = proposals.flatMap((p) => p.edits);
    expect(edits.every((e) => e.op === "create-file")).toBe(true);
    for (const e of edits) if (e.op === "create-file") expect(e.path.startsWith(out)).toBe(true);
    const notes = proposals.find((p) => p.target === original);
    expect(notes?.preview.before).toBe("keep\n");
    expect(notes?.preview.after).toBe("keep\nplus\n");
    expect(notes?.edits[0]).toMatchObject({ path: join(out, "notes (suggested).txt") });
    expect(proposals.some((p) => p.target === join(out, "hello.txt"))).toBe(true);
    // The binary change is reported, not applied.
    expect(proposals.flatMap((p) => p.checks).some((c) => c.status === "warn" && c.detail?.includes("pic.png"))).toBe(true);
    stage.cleanup();
  });
});

describe("sweepStages", () => {
  it("removes only old turn folders", () => {
    const dir = join(root, "sweep");
    mkdirSync(join(dir, "turn-old"), { recursive: true });
    mkdirSync(join(dir, "turn-new"), { recursive: true });
    mkdirSync(join(dir, "keep-me"), { recursive: true });
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    utimesSync(join(dir, "turn-old"), old, old);
    expect(sweepStages(dir)).toBe(1);
    expect(existsSync(join(dir, "turn-old"))).toBe(false);
    expect(existsSync(join(dir, "turn-new"))).toBe(true);
    expect(existsSync(join(dir, "keep-me"))).toBe(true);
  });
});
