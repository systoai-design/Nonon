import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARG_SCHEMAS, BadRequest, parseArg } from "./ipc-schema";

describe("ipc argument checks", () => {
  it("has a schema for every channel the window can call, and no extras", () => {
    const text = readFileSync(join(__dirname, "../shared/ipc.ts"), "utf8");
    const body = text.slice(text.indexOf("export interface Channels"), text.indexOf("export type ChannelName"));
    const declared = [...body.matchAll(/^\s+"([a-z-]+:[a-z-]+)":/gm)].map((m) => m[1]).sort();
    expect(declared.length).toBeGreaterThan(50);
    expect(Object.keys(ARG_SCHEMAS).sort()).toEqual(declared);
  });

  it("refuses a channel that does not exist", () => {
    expect(() => parseArg("fs:read", { path: "C:\\x" })).toThrow(BadRequest);
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"]) expect(() => parseArg(name, {})).toThrow(BadRequest);
  });

  it("refuses ids that could climb out of the data folder (chat:history, task:get, change:apply)", () => {
    // These ids are used to build file names like chat/<id>.json and tasks/<id>.json.
    for (const bad of ["../settings", "..\\gmail-cache", "a/b", "a\\b", "ws.1", "", " ", "a".repeat(101), "x\0y", "C:evil"]) {
      expect(() => parseArg("chat:history", { workspaceId: bad })).toThrow(BadRequest);
      expect(() => parseArg("task:get", { id: bad })).toThrow(BadRequest);
      expect(() => parseArg("change:apply", { id: bad })).toThrow(BadRequest);
    }
  });

  it("accepts the ids the app really makes", () => {
    const ids = ["ws_mgabc12xyz", "task_mg1abc", "rtn_6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab", "dev_0123456789abcdef", "pr_0123456789abcdef", "spreadsheet-compare"];
    for (const good of ids) {
      expect(parseArg("chat:history", { workspaceId: good })).toEqual({ workspaceId: good });
      expect(parseArg("lan:revoke", { deviceId: good })).toEqual({ deviceId: good });
    }
  });

  it("rejects wrong types, missing fields and oversized values", () => {
    expect(() => parseArg("shell:open", {})).toThrow(BadRequest);
    expect(() => parseArg("shell:open", { path: 7 })).toThrow(BadRequest);
    expect(() => parseArg("shell:open", { path: "a".repeat(5000) })).toThrow(BadRequest);
    expect(() => parseArg("shell:open", { path: "C:\\a\0.txt" })).toThrow(BadRequest);
    expect(() => parseArg("shell:open", null)).toThrow(BadRequest);
    expect(() => parseArg("output:preview", { path: "C:\\a.csv", maxRows: -1 })).toThrow(BadRequest);
    expect(() => parseArg("chat:send", { workspaceId: "ws_1", text: "x".repeat(2_000_001) })).toThrow(BadRequest);
    expect(() => parseArg("task:start", { workspaceId: "ws_1", procedureId: "spreadsheet-compare", files: { "../x": ["C:\\a.csv"] } })).toThrow(BadRequest);
    expect(() => parseArg("lan:pair", { pairing: "x".repeat(2000), deviceName: "pc" })).toThrow(BadRequest);
    expect(() => parseArg("provider:probe", { id: "shell" })).toThrow(BadRequest);
    expect(() => parseArg("roles:set", { workspaceId: "ws_1", role: "root", provider: "claude" })).toThrow(BadRequest);
  });

  it("only lets the window change the settings it knows about", () => {
    const out = parseArg("settings:update", { companionName: "Non", onboarded: true, evil: "x", __proto__: { polluted: true } }) as Record<string, unknown>;
    expect(out).toEqual({ companionName: "Non", onboarded: true });
    expect(() => parseArg("settings:update", { idleUnloadSeconds: -5 })).toThrow(BadRequest);
    expect(() => parseArg("settings:update", { activeWorkspaceId: "../x" })).toThrow(BadRequest);
  });

  it("passes a normal task start through unchanged", () => {
    const arg = {
      workspaceId: "ws_abc",
      procedureId: "spreadsheet-compare",
      files: { fileA: ["E:\\Books\\a.csv"], fileB: ["E:\\Books\\b.csv"] },
      text: { notes: "May" },
      answers: { period: "May 2026" },
    };
    expect(parseArg("task:start", arg)).toEqual(arg);
  });

  it("keeps a saved routine intact for the scheduler to check in depth", () => {
    const routine = { id: "", workspaceId: "ws_1", title: "x", schedule: { cron: "0 8 * * 1-5", timezone: "Asia/Manila", humanText: "" }, extra: 1 };
    expect(parseArg("routine:save", { routine })).toEqual({ routine });
    expect(() => parseArg("routine:save", { routine: { ...routine, id: "../../x" } })).toThrow(BadRequest);
  });

  it("does not care what a no-argument channel is sent", () => {
    expect(parseArg("app:state", undefined)).toBeUndefined();
    expect(parseArg("lan:host-start", { anything: 1 })).toEqual({ anything: 1 });
  });
});
