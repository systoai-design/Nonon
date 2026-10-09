import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Harness, makeHarness, writeFile } from "./core/testkit";

let h: Harness;
beforeEach(() => {
  h = makeHarness();
});
afterEach(() => h.cleanup());

const make = (extra: { folder?: string | null; pack?: "general" | "bookkeeping" } = {}) =>
  h.ctx.svc.workspaces.create({ name: "Books", folder: extra.folder === undefined ? h.folder : extra.folder, pack: extra.pack ?? "bookkeeping" });

describe("workspaces CRUD", () => {
  it("makes the first workspace active and defaults to local-only", () => {
    const a = make();
    const b = h.ctx.svc.workspaces.create({ name: "Second", folder: null, pack: "general" });
    expect(h.settings.activeWorkspaceId).toBe(a.id);
    expect(a.policy).toBe("local-only");
    expect(a.autoApply).toBe(false);
    expect(h.ctx.svc.workspaces.list().map((w) => w.id)).toEqual([a.id, b.id]);
  });

  it("persists across a fresh service and moves the active workspace on remove", async () => {
    const a = make();
    const b = h.ctx.svc.workspaces.create({ name: "Second", folder: null, pack: "general" });
    h.ctx.svc.workspaces.update(b.id, { policy: "cloud-allowed", name: " Renamed " });
    const { createWorkspaceService } = await import("./workspaces");
    const again = createWorkspaceService(h.ctx);
    expect(again.get(b.id)).toMatchObject({ name: "Renamed", policy: "cloud-allowed" });
    h.ctx.svc.workspaces.remove(a.id);
    expect(h.settings.activeWorkspaceId).toBe(b.id);
    expect(() => h.ctx.svc.workspaces.update(a.id, { name: "x" })).toThrow(/no longer exists/);
  });
});

describe("files()", () => {
  it("lists to depth 3, skips dotfiles, node_modules and NONON Output, and flags supported types", async () => {
    const ws = make();
    writeFile(join(h.folder, "a.csv"));
    writeFile(join(h.folder, "notes.md"));
    writeFile(join(h.folder, "photo.png"));
    writeFile(join(h.folder, ".hidden.txt"));
    writeFile(join(h.folder, ".git", "config"));
    writeFile(join(h.folder, "node_modules", "x", "y.txt"));
    writeFile(join(h.folder, "NONON Output", "result.csv"));
    writeFile(join(h.folder, "d1", "d2", "deep.txt"));
    writeFile(join(h.folder, "d1", "d2", "d3", "too-deep.txt"));
    const entries = await h.ctx.svc.workspaces.files(ws.id);
    const names = entries.map((e) => e.name);
    expect(names).toEqual(["a.csv", "deep.txt", "notes.md", "photo.png"]);
    expect(entries.find((e) => e.name === "photo.png")?.supported).toBe(false);
    expect(entries.find((e) => e.name === "a.csv")).toMatchObject({ supported: true, ext: ".csv" });
  });

  it("does not follow a folder link out of the workspace", async () => {
    const ws = make();
    const outside = join(h.root, "outside");
    writeFile(join(outside, "secret.txt"));
    symlinkSync(outside, join(h.folder, "linked"), "junction");
    const entries = await h.ctx.svc.workspaces.files(ws.id);
    expect(entries.map((e) => e.name)).not.toContain("secret.txt");
  });

  it("explains a missing folder in plain words", async () => {
    const ws = make({ folder: null });
    await expect(h.ctx.svc.workspaces.files(ws.id)).rejects.toThrow(/no folder yet/);
  });
});

describe("outputDir and assertInside", () => {
  it("creates NONON Output on demand and refuses a workspace with no folder", () => {
    const ws = make();
    const dir = h.ctx.svc.workspaces.outputDir(ws.id);
    expect(dir).toBe(join(h.folder, "NONON Output"));
    expect(existsSync(dir)).toBe(true);
    const bare = make({ folder: null });
    expect(() => h.ctx.svc.workspaces.outputDir(bare.id)).toThrow("This project has no folder yet. Choose a folder to work in first.");
  });

  it("accepts paths inside, including ones that do not exist yet, and rejects .. escapes", () => {
    const ws = make();
    const svc = h.ctx.svc.workspaces;
    expect(() => svc.assertInside(ws.id, join(h.folder, "sub", "new.csv"))).not.toThrow();
    expect(() => svc.assertInside(ws.id, join(h.folder, "NONON Output", "x.csv"))).not.toThrow();
    expect(() => svc.assertInside(ws.id, join(h.folder, "..", "outside.csv"))).toThrow(/outside this project/);
    expect(() => svc.assertInside(ws.id, join(h.folder, "sub", "..", "..", "other"))).toThrow(/outside this project/);
    expect(() => svc.assertInside(ws.id, h.root)).toThrow();
    // A sibling folder that merely shares the name prefix must not pass.
    expect(() => svc.assertInside(ws.id, `${h.folder}-evil${"/"}a.csv`)).toThrow();
  });

  it("rejects a junction inside the folder that leads outside", () => {
    const ws = make();
    const outside = join(h.root, "outside");
    writeFile(join(outside, "secret.csv"));
    symlinkSync(outside, join(h.folder, "escape"), "junction");
    expect(() => h.ctx.svc.workspaces.assertInside(ws.id, join(h.folder, "escape", "secret.csv"))).toThrow(/outside this project/);
    expect(() => h.ctx.svc.workspaces.assertInside(ws.id, join(h.folder, "escape", "brand-new.csv"))).toThrow(/outside this project/);
  });

  it("rejects a file symlink that leads outside (skipped where the OS forbids creating one)", () => {
    const ws = make();
    const target = writeFile(join(h.root, "outside.csv"));
    try {
      symlinkSync(target, join(h.folder, "link.csv"), "file");
    } catch {
      return;
    }
    expect(() => h.ctx.svc.workspaces.assertInside(ws.id, join(h.folder, "link.csv"))).toThrow(/outside this project/);
  });

  it("will not write through a NONON Output link that points outside", () => {
    const ws = make();
    const outside = join(h.root, "elsewhere");
    mkdirSync(outside);
    symlinkSync(outside, join(h.folder, "NONON Output"), "junction");
    expect(() => h.ctx.svc.workspaces.outputDir(ws.id)).toThrow(/points outside/);
  });
});

describe("addSamples", () => {
  it("returns an empty list when the sample folders do not exist", async () => {
    const ws = make();
    expect(await h.ctx.svc.workspaces.addSamples(ws.id)).toEqual([]);
    expect(existsSync(join(h.folder, "Samples"))).toBe(false);
  });

  it("copies the pack and general samples without overwriting the user's edits", async () => {
    const ws = make();
    writeFile(join(h.ctx.paths.resourcesDir, "samples", "bookkeeping", "bank.csv"), "pack");
    writeFile(join(h.ctx.paths.resourcesDir, "samples", "general", "readme.txt"), "general");
    writeFile(join(h.ctx.paths.resourcesDir, "samples", "general", "bank.csv"), "general wins? no");
    writeFile(join(h.ctx.paths.resourcesDir, "samples", "education", "quiz.txt"), "other pack");
    const first = await h.ctx.svc.workspaces.addSamples(ws.id);
    expect(first.map((e) => e.name).sort()).toEqual(["bank.csv", "readme.txt"]);
    expect(readFileSync(join(h.folder, "Samples", "bank.csv"), "utf8")).toBe("pack");

    writeFileSync(join(h.folder, "Samples", "bank.csv"), "user edit");
    const second = await h.ctx.svc.workspaces.addSamples(ws.id);
    expect(second).toHaveLength(2);
    expect(readFileSync(join(h.folder, "Samples", "bank.csv"), "utf8")).toBe("user edit");
  });
});
