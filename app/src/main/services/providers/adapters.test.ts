/**
 * MOCKED: every adapter here talks to fixtures/fake-cli.mjs, a stand-in that replays protocol shapes captured from the
 * real programs. These tests prove parsing, isolation arguments, cancel, timeout and scrubbing in NONON's code; they say
 * nothing about vendor behaviour (see live.test.ts and docs/project/04-build-log/providers-evidence.md for that).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildChildEnv, type ResolvedBin } from "./bin";
import { createAgyAdapter, TASK_FILE } from "./agy";
import { createClaudeAdapter } from "./claude";
import { createCodexAdapter } from "./codex";
import { isAlive, sleep } from "./test-helpers";
import { ProviderError, type TurnEvent } from "./types";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-cli.mjs");
const root = mkdtempSync(join(tmpdir(), "nonon-adapters-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let vars: Record<string, string> = {};
let logFile = "";
let n = 0;
beforeEach(() => {
  n++;
  logFile = join(root, `log-${n}.jsonl`);
  vars = { FAKE_LOG: logFile, FAKE_PIDFILE: join(root, `pid-${n}.txt`) };
});

const fakeBin = (dialect: string): (() => ResolvedBin) => () => ({ command: process.execPath, prefixArgs: [FAKE, dialect], display: dialect });
const fakeEnv = () => ({ ...buildChildEnv(), ...vars });
const logLines = () => (existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const cwd = () => mkdtempSync(join(root, "cwd-"));

const claude = (extra = {}) => createClaudeAdapter({ resolve: fakeBin("claude"), env: fakeEnv, ...extra });
const codex = (extra = {}) => createCodexAdapter({ resolve: fakeBin("codex"), env: fakeEnv, ...extra });
const agy = (extra = {}) => createAgyAdapter({ resolve: fakeBin("agy"), env: fakeEnv, ...extra });

async function pidGone(file: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    if (existsSync(file)) break;
    await sleep(100);
  }
  const pid = Number(readFileSync(file, "utf8"));
  for (let i = 0; i < 30; i++) {
    if (!isAlive(pid)) return true;
    await sleep(100);
  }
  return false;
}

describe("claude adapter (mocked process)", () => {
  it("probe: ready when signed in, needs-sign-in when not, incompatible when a safety flag is missing", async () => {
    expect((await claude().probe()).state).toBe("ready");
    vars.FAKE_AUTH = "out";
    expect((await claude().probe()).state).toBe("needs-sign-in");
    vars.FAKE_AUTH = "in";
    vars.FAKE_HELP = "--output-format --tools";
    const s = await claude().probe();
    expect(s.state).toBe("incompatible");
    expect(s.detail).toContain("--strict-mcp-config");
  });

  it("probe: not-installed when nothing resolves", async () => {
    expect((await createClaudeAdapter({ resolve: () => null }).probe()).state).toBe("not-installed");
  });

  it("text-only turn: no tools, no outside MCP, user settings and plugins off, prompt on stdin", async () => {
    const events: TurnEvent[] = [];
    const out = await claude().runTurn({ prompt: "Reply with the single word OK.", systemPrompt: "Be brief.", cwd: cwd(), onEvent: (e) => events.push(e) });
    expect(out.text).toBe("OK");
    expect(out.provider).toBe("claude");
    expect(out.effective.tools).toBe("none");
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe("OK");
    const call = logLines().find((l) => l.stdin !== undefined);
    expect(call.stdin).toBe("Reply with the single word OK.");
    const a: string[] = call.args;
    expect(a).toEqual(expect.arrayContaining(["-p", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands", "--safe-mode", "--restricted"]));
    expect(a[a.indexOf("--setting-sources") + 1]).toBe("project");
    expect(a[a.indexOf("--tools") + 1]).toBe("");
    expect(a[a.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(a[a.indexOf("--append-system-prompt") + 1]).toBe("Be brief.");
    for (const banned of ["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "bypassPermissions", "--allowedTools"]) expect(a).not.toContain(banned);
  });

  it("file turn: only the read tools are allowed", async () => {
    await claude().runTurn({ prompt: "x", cwd: cwd(), allowFileRead: true });
    const a: string[] = logLines().find((l) => l.stdin !== undefined).args;
    expect(a[a.indexOf("--tools") + 1]).toBe("Read,Glob,Grep");
    expect(a.slice(a.indexOf("--allowedTools") + 1, a.indexOf("--allowedTools") + 4)).toEqual(["Read", "Glob", "Grep"]);
  });

  it("does not pass the host's credentials or session variables to the child", async () => {
    const hostEnv = { ...process.env, ANTHROPIC_API_KEY: "sk-ant-leak-1234567890", CLAUDE_CODE_OAUTH_SCOPES: "x", OPENAI_API_KEY: "sk-leak" };
    await createClaudeAdapter({ resolve: fakeBin("claude"), env: () => ({ ...buildChildEnv(["CLAUDE_CONFIG_DIR"], { env: hostEnv }), ...vars }) }).runTurn({ prompt: "x", cwd: cwd() });
    const keys: string[] = logLines().find((l) => l.envKeys)?.envKeys ?? [];
    expect(keys.length).toBeGreaterThan(3);
    for (const banned of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_SCOPES", "OPENAI_API_KEY"]) expect(keys).not.toContain(banned);
  });

  it("long system prompts move into the stdin text instead of the command line", async () => {
    await claude().runTurn({ prompt: "task", systemPrompt: "s".repeat(7000), cwd: cwd() });
    const call = logLines().find((l) => l.stdin !== undefined);
    expect(call.args).not.toContain("--append-system-prompt");
    expect(call.stdin).toContain("s".repeat(7000));
  });

  it("an extra tool or an MCP server in the init event stops the turn as an isolation failure", async () => {
    vars.FAKE_MODE = "extra-tool";
    await expect(claude().runTurn({ prompt: "x", cwd: cwd() })).rejects.toMatchObject({ code: "isolation" });
    vars.FAKE_MODE = "mcp";
    await expect(claude().runTurn({ prompt: "x", cwd: cwd() })).rejects.toMatchObject({ code: "isolation" });
  });

  it("is_error results become named, plain errors (the real CLI reports subtype success with is_error true)", async () => {
    vars.FAKE_MODE = "auth-error";
    const err = await claude().runTurn({ prompt: "x", cwd: cwd() }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe("auth");
    expect(err.message).toMatch(/^Claude needs you to sign in/);
    vars.FAKE_MODE = "limit-error";
    expect(await claude().runTurn({ prompt: "x", cwd: cwd() }).catch((e) => e.code)).toBe("limit");
  });

  it("a stream that ends without a result is a protocol error, not an empty success", async () => {
    vars.FAKE_MODE = "no-result";
    expect(await claude().runTurn({ prompt: "x", cwd: cwd() }).catch((e) => e.code)).toBe("protocol");
  });

  it("counts refused tools", async () => {
    vars.FAKE_MODE = "denials";
    const out = await claude().runTurn({ prompt: "x", cwd: cwd() });
    expect(out.denials).toBe(1);
    expect(out.warnings[0]).toContain("refused");
  });

  it("abort kills the process tree (grandchild included)", async () => {
    vars.FAKE_MODE = "hang";
    const ac = new AbortController();
    const run = claude().runTurn({ prompt: "x", cwd: cwd(), signal: ac.signal }).catch((e) => e);
    await sleep(1200);
    ac.abort();
    const err = await run;
    expect(err.name).toBe("AbortError");
    expect(err.code).toBe("aborted");
    expect(await pidGone(vars.FAKE_PIDFILE as string)).toBe(true);
  });

  it("timeout is a named error and also clears the tree", async () => {
    vars.FAKE_MODE = "hang";
    const err = await claude().runTurn({ prompt: "x", cwd: cwd(), timeoutMs: 1200 }).catch((e) => e);
    expect(err.code).toBe("timeout");
    expect(err.message).toContain("Claude");
    expect(await pidGone(vars.FAKE_PIDFILE as string)).toBe(true);
  });

  it("a missing working folder is a plain spawn error", async () => {
    const err = await claude().runTurn({ prompt: "x", cwd: join(root, "nope", "nope") }).catch((e) => e);
    expect(err.code).toBe("spawn");
  });

  it("scrubs secrets from stderr-derived errors", async () => {
    vars.FAKE_MODE = "stderr-secret";
    const err = await claude().runTurn({ prompt: "x", cwd: cwd() }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).not.toContain("sk-ant");
    expect(err.message).not.toContain("abcdef1234567890abcdef");
  });
});

describe("codex adapter (mocked exec)", () => {
  it("probe: ready when signed in, needs-sign-in when not, incompatible when an isolation option is missing", async () => {
    expect(await codex().probe()).toMatchObject({ state: "ready", version: "0.153.4" });
    vars.FAKE_AUTH = "out";
    expect((await codex().probe()).state).toBe("needs-sign-in");
    vars.FAKE_AUTH = "in";
    vars.FAKE_EXEC_HELP = "--json --sandbox";
    const s = await codex().probe();
    expect(s.state).toBe("incompatible");
    expect(s.detail).toContain("--ignore-user-config");
  });

  it("turn: ignores the person's own Codex config, read-only, no approvals, prompt on stdin, optional features off", async () => {
    const events: TurnEvent[] = [];
    const out = await codex().runTurn({ prompt: "Reply with the single word OK.", systemPrompt: "Be brief.", cwd: cwd(), onEvent: (e) => events.push(e) });
    expect(out.text).toBe("OK");
    expect(out.usage).toEqual({ inputTokens: 5, outputTokens: 1 });
    expect(out.sessionId).toBe("thr-1");
    expect(out.warnings[0]).toContain("skills");
    const call = logLines().find((l) => l.stdin !== undefined);
    const a: string[] = call.args;
    expect(a).toEqual(expect.arrayContaining(["exec", "--json", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check", "-"]));
    expect(a[a.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(a[a.indexOf("-C") + 1]).toBe(call.cwd);
    expect(a).toContain('approval_policy="never"');
    expect(a).toContain("memories");
    for (const banned of ["--dangerously-bypass-approvals-and-sandbox", "danger-full-access", "workspace-write", "--full-auto"]) expect(a).not.toContain(banned);
    expect(call.stdin).toBe("Be brief.\n\nReply with the single word OK.");
    expect(events).toContainEqual({ type: "text", delta: "OK" });
  });

  it("does not pass the host's credentials to the child (only CODEX_HOME may)", async () => {
    const hostEnv = { ...process.env, OPENAI_API_KEY: "sk-leak-123456789012345678", ANTHROPIC_API_KEY: "sk-ant-leak-1234567890", CODEX_HOME: "D:/codex-home" };
    await createCodexAdapter({ resolve: fakeBin("codex"), env: () => ({ ...buildChildEnv(["CODEX_HOME"], { env: hostEnv }), ...vars }) }).runTurn({ prompt: "x", cwd: cwd() });
    const keys: string[] = logLines().find((l) => l.envKeys)?.envKeys ?? [];
    expect(keys).toContain("CODEX_HOME");
    expect(keys).not.toContain("OPENAI_API_KEY");
    expect(keys).not.toContain("ANTHROPIC_API_KEY");
  });

  it("a declined command is counted as a denial", async () => {
    vars.FAKE_MODE = "denied";
    const events: TurnEvent[] = [];
    const out = await codex().runTurn({ prompt: "x", cwd: cwd(), onEvent: (e) => events.push(e) });
    expect(out.denials).toBe(1);
    expect(events).toContainEqual({ type: "tool", name: "command_execution", status: "denied" });
  });

  it("a retry notice before success is not a failure", async () => {
    vars.FAKE_MODE = "retry-then-ok";
    expect((await codex().runTurn({ prompt: "x", cwd: cwd() })).text).toBe("OK");
  });

  it("a stream in an unknown format that exits cleanly is reported as incompatible, not success", async () => {
    vars.FAKE_MODE = "drift";
    const err = await codex().runTurn({ prompt: "x", cwd: cwd() }).catch((e) => e);
    expect(err.code).toBe("incompatible");
    expect(err.message).toContain("Codex");
  });

  it("a failed turn is mapped to a plain auth error naming Codex", async () => {
    vars.FAKE_MODE = "failed-turn";
    const err = await codex().runTurn({ prompt: "x", cwd: cwd() }).catch((e) => e);
    expect(err.code).toBe("auth");
    expect(err.message).toMatch(/^Codex needs you to sign in/);
  });

  it("abort and timeout kill the whole tree", async () => {
    vars.FAKE_MODE = "hang";
    const ac = new AbortController();
    const run = codex().runTurn({ prompt: "x", cwd: cwd(), signal: ac.signal }).catch((e) => e);
    await sleep(1200);
    ac.abort();
    const err = await run;
    expect(err.name).toBe("AbortError");
    expect(await pidGone(vars.FAKE_PIDFILE as string)).toBe(true);

    rmSync(vars.FAKE_PIDFILE as string, { force: true });
    const t = await codex().runTurn({ prompt: "x", cwd: cwd(), timeoutMs: 1500 }).catch((e) => e);
    expect(t.code).toBe("timeout");
    expect(await pidGone(vars.FAKE_PIDFILE as string)).toBe(true);
  });
});

describe("antigravity adapter (mocked process)", () => {
  it("probe cannot see a sign-in, so it says not-connected and untested rather than guessing", async () => {
    const s = await agy().probe();
    expect(s).toMatchObject({ state: "not-connected", verified: "untested", version: "1.2.17" });
  });

  it("turn: sandbox on, slash commands off, never the skip-permissions switch; usage includes cache reads", async () => {
    const out = await agy().runTurn({ prompt: "Reply with the single word OK.", cwd: cwd() });
    expect(out.text).toBe("OK");
    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 1 });
    const a: string[] = logLines().find((l) => l.prompt !== undefined).args;
    expect(a).toEqual(expect.arrayContaining(["--print", "--output-format", "stream-json", "--sandbox", "--disable-slash-commands"]));
    expect(a).not.toContain("--dangerously-skip-permissions");
  });

  it("runs with a throwaway home so the person's global tool servers, skills and notes never load, and removes it afterwards", async () => {
    const dir = cwd();
    await agy().runTurn({ prompt: "x", cwd: dir });
    const call = logLines().find((l) => l.prompt !== undefined);
    expect(call.home).toBe(`${dir}-home`);
    expect(call.home).not.toBe(process.env.USERPROFILE);
    expect(call.homeExists).toBe(true);
    expect(existsSync(`${dir}-home`)).toBe(false);
  });

  it("exit code 0 with a refused tool and no answer is an error, not success", async () => {
    vars.FAKE_MODE = "tool-denied";
    const err = await agy().runTurn({ prompt: "x", cwd: cwd() }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe("empty");
    expect(err.message).toContain("refused");
  });

  it("a non-SUCCESS result and a missing result are both errors", async () => {
    vars.FAKE_MODE = "error-status";
    expect(await agy().runTurn({ prompt: "x", cwd: cwd() }).catch((e) => e.code)).toBe("auth");
    vars.FAKE_MODE = "no-result";
    expect(await agy().runTurn({ prompt: "x", cwd: cwd() }).catch((e) => e.code)).toBe("protocol");
  });

  it("a long prompt is handed over as a staged file, and the file is removed afterwards", async () => {
    const dir = cwd();
    const long = "word ".repeat(4000);
    const out = await agy().runTurn({ prompt: long, cwd: dir });
    expect(out.text).toBe(`TASKFILE:${long.length}`);
    const call = logLines().find((l) => l.prompt !== undefined);
    expect(call.prompt).toContain(TASK_FILE);
    expect(call.prompt.length).toBeLessThan(300);
    expect(existsSync(join(dir, TASK_FILE))).toBe(false);
  });

  it("abort kills the tree", async () => {
    vars.FAKE_MODE = "hang";
    const ac = new AbortController();
    const run = agy().runTurn({ prompt: "x", cwd: cwd(), signal: ac.signal }).catch((e) => e);
    await sleep(1200);
    ac.abort();
    expect((await run).code).toBe("aborted");
    expect(await pidGone(vars.FAKE_PIDFILE as string)).toBe(true);
  });
});
