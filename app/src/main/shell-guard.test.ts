import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mayReveal, resolveOpenable } from "./shell-guard";

describe("Open document and Show in folder", () => {
  let root = "";
  let project = "";
  let outside = "";
  let data = "";
  const ws = () => ({ list: () => [{ folder: project }, { folder: null }] });

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "nonon-shell-")));
    project = join(root, "project");
    outside = join(root, "outside");
    data = join(root, "data");
    for (const d of [project, outside, data]) mkdirSync(d);
    writeFileSync(join(project, "report.docx"), "x");
    writeFileSync(join(project, "Totals.XLSX"), "x");
    writeFileSync(join(outside, "secret.txt"), "secret");
    writeFileSync(join(data, "gmail-token.bin"), "secret");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("opens documents inside a project folder", async () => {
    expect(await resolveOpenable(ws(), join(project, "report.docx"))).toBe(join(project, "report.docx"));
    expect(await resolveOpenable(ws(), join(project, "Totals.XLSX"))).toBe(join(project, "Totals.XLSX"));
  });

  it("will not start programs, scripts or shortcuts, even inside a project folder", async () => {
    for (const name of ["setup.exe", "run.bat", "run.cmd", "go.ps1", "x.lnk", "x.url", "x.js", "x.vbs", "x.msi", "x.scr", "x.com", "x.jar", "x.html", "x.hta", "x.xlsm", "x.docm", "noextension", "x.txt.exe"]) {
      writeFileSync(join(project, name), "x");
      await expect(resolveOpenable(ws(), join(project, name))).rejects.toThrow(/only opens documents/);
    }
  });

  it("will not open anything outside the project folders", async () => {
    await expect(resolveOpenable(ws(), join(outside, "secret.txt"))).rejects.toThrow(/outside your project folders/);
    await expect(resolveOpenable(ws(), join(data, "gmail-token.bin"))).rejects.toThrow(/outside your project folders/);
    await expect(resolveOpenable(ws(), join(project, "..", "outside", "secret.txt"))).rejects.toThrow(/outside your project folders/);
    await expect(resolveOpenable(ws(), "report.docx")).rejects.toThrow(/outside your project folders/);
  });

  it("follows links before deciding: a link inside the project that points outside is refused", async () => {
    try {
      symlinkSync(join(outside, "secret.txt"), join(project, "innocent.txt"), "file");
    } catch {
      return; // creating file links needs a privilege some machines do not grant
    }
    await expect(resolveOpenable(ws(), join(project, "innocent.txt"))).rejects.toThrow(/outside your project folders/);
  });

  it("follows folder links and junctions: a folder inside the project that leads outside is refused", async () => {
    symlinkSync(outside, join(project, "shortcut"), "junction");
    await expect(resolveOpenable(ws(), join(project, "shortcut", "secret.txt"))).rejects.toThrow(/outside your project folders/);
    expect(mayReveal(ws(), data, join(project, "shortcut", "secret.txt"))).toBe(false);
  });

  it("checks the real file's type too: a document-named link to a program is refused", async () => {
    writeFileSync(join(project, "tool.exe"), "x");
    try {
      symlinkSync(join(project, "tool.exe"), join(project, "notes.txt"), "file");
    } catch {
      return;
    }
    await expect(resolveOpenable(ws(), join(project, "notes.txt"))).rejects.toThrow(/only opens documents/);
  });

  it("says plainly when the file is gone", async () => {
    await expect(resolveOpenable(ws(), join(project, "missing.docx"))).rejects.toThrow(/could not find/);
  });

  it("shows files in a folder only for projects and NONON's own data", () => {
    expect(mayReveal(ws(), data, join(project, "report.docx"))).toBe(true);
    expect(mayReveal(ws(), data, join(project, "not-made-yet.docx"))).toBe(true);
    expect(mayReveal(ws(), data, join(data, "gmail-token.bin"))).toBe(true);
    expect(mayReveal(ws(), data, join(outside, "secret.txt"))).toBe(false);
    expect(mayReveal(ws(), data, "relative.docx")).toBe(false);
  });
});
