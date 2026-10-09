import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildChildEnv, resolveBin } from "./bin";

const root = mkdtempSync(join(tmpdir(), "nonon-bin-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("resolveBin (Windows shim parsing, run with a fake npm folder)", () => {
  it("follows an npm .cmd shim to the real .exe", () => {
    const npm = join(root, "npm");
    const exeDir = join(npm, "node_modules", "@anthropic-ai", "claude-code", "bin");
    mkdirSync(exeDir, { recursive: true });
    writeFileSync(join(exeDir, "claude.exe"), "x");
    writeFileSync(join(npm, "claude.cmd"), '@ECHO off\r\nSETLOCAL\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
    const bin = resolveBin("claude", { platform: "win32", env: { PATH: npm }, home: root });
    expect(bin?.command.toLowerCase()).toContain("claude.exe");
    expect(bin?.prefixArgs).toEqual([]);
  });

  it("follows a node shim to node plus the script", () => {
    const npm = join(root, "npm2");
    const jsDir = join(npm, "node_modules", "@openai", "codex", "bin");
    mkdirSync(jsDir, { recursive: true });
    writeFileSync(join(jsDir, "codex.js"), "//");
    writeFileSync(join(npm, "node.exe"), "x");
    writeFileSync(join(npm, "codex.cmd"), '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
    const bin = resolveBin("codex", { platform: "win32", env: { PATH: npm }, home: root });
    expect(bin?.command.toLowerCase()).toContain("node.exe");
    expect(bin?.prefixArgs[0]?.toLowerCase()).toContain("codex.js");
  });

  it("returns null when the program is not installed", () => {
    expect(resolveBin("agy", { platform: "win32", env: { PATH: join(root, "empty") }, home: join(root, "nohome") })).toBeNull();
  });
});

describe("buildChildEnv", () => {
  it("passes an allowlist only: no host session tokens, API keys or plugin switches", () => {
    const source: NodeJS.ProcessEnv = {
      PATH: "C:\\bin",
      SystemRoot: "C:\\Windows",
      USERPROFILE: "C:\\Users\\x",
      HTTPS_PROXY: "http://proxy:8080",
      ANTHROPIC_API_KEY: "sk-ant-should-not-pass",
      ANTHROPIC_BASE_URL: "https://elsewhere.test",
      CLAUDE_CODE_OAUTH_SCOPES: "user:inference",
      CLAUDE_CODE_MESSAGING_TOKEN: "tok",
      CLAUDECODE: "1",
      OPENAI_API_KEY: "sk-openai-should-not-pass",
      GEMINI_API_KEY: "g",
      CODEX_HOME: "D:\\codex-home",
    };
    const env = buildChildEnv(["CODEX_HOME"], { platform: "win32", env: source, home: "C:\\Users\\x" });
    expect(env.HTTPS_PROXY).toBe("http://proxy:8080");
    expect(env.CODEX_HOME).toBe("D:\\codex-home");
    expect(env.USERPROFILE).toBe("C:\\Users\\x");
    for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_SCOPES", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDECODE", "OPENAI_API_KEY", "GEMINI_API_KEY"]) {
      expect(env[k]).toBeUndefined();
    }
    expect(env.PATH).toContain("C:\\bin");
  });
});
