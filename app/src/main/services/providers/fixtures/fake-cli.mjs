// MOCKED stand-in for the three vendor programs, used only by unit tests. It speaks just enough of each
// protocol (shapes copied from real captures made on 2026-10-09) to exercise parsing, cancel and isolation code.
// Usage: node fake-cli.mjs <claude|codex|agy> [real arguments...]; behaviour comes from FAKE_MODE and friends.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const [, , dialect, ...args] = process.argv;
const mode = process.env.FAKE_MODE ?? "ok";
const log = (obj) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, JSON.stringify(obj) + "\n");
const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function leakGrandchild() {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  if (process.env.FAKE_PIDFILE) writeFileSync(process.env.FAKE_PIDFILE, String(child.pid));
}

async function hang() {
  leakGrandchild();
  await sleep(120000);
}

if (mode === "stderr-secret") {
  process.stderr.write("request failed token=sk-ant-api03-ABCDEFGHIJKLMNOP and Authorization: Bearer abcdef1234567890abcdef\n");
  process.exit(3);
}

if (dialect === "claude") await claude();
else if (dialect === "codex") await codex();
else if (dialect === "agy") await agy();
else process.exit(2);

async function claude() {
  if (args.includes("--version")) return console.log("2.1.280 (Claude Code)");
  if (args.includes("--help")) {
    return console.log(
      process.env.FAKE_HELP ??
        "--output-format --strict-mcp-config --setting-sources --tools --permission-mode --no-session-persistence --disable-slash-commands --safe-mode --restricted --permission-prompts",
    );
  }
  if (args[0] === "auth" && args[1] === "status") {
    const inn = (process.env.FAKE_AUTH ?? "in") === "in";
    console.log(JSON.stringify({ loggedIn: inn, authMethod: inn ? "claude.ai" : "none" }));
    process.exit(inn ? 0 : 1);
  }
  let stdin = "";
  for await (const c of process.stdin) stdin += c;
  log({ dialect, args, stdin, cwd: process.cwd(), envKeys: Object.keys(process.env) });
  const toolsArg = args[args.indexOf("--tools") + 1] ?? "";
  const tools = toolsArg ? toolsArg.split(",") : [];
  out({ type: "system", subtype: "init", session_id: "sess-1", model: "claude-test", tools: mode === "extra-tool" ? [...tools, "Bash"] : tools, mcp_servers: mode === "mcp" ? [{ name: "x" }] : [], permissionMode: "dontAsk" });
  if (mode === "hang") return hang();
  if (mode === "no-result") return;
  if (mode === "auth-error") {
    out({ type: "assistant", error: "authentication_failed", message: { content: [{ type: "text", text: "Failed to authenticate: OAuth session expired" }] } });
    out({ type: "result", subtype: "success", is_error: true, result: "Failed to authenticate: OAuth session expired and could not be refreshed", terminal_reason: "api_error" });
    process.exit(1);
  }
  if (mode === "limit-error") {
    out({ type: "result", subtype: "success", is_error: true, result: "Claude usage limit reached", terminal_reason: "api_error" });
    process.exit(1);
  }
  process.stdout.write("this is not json\n");
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "O" } } });
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "K" } } });
  out({ type: "assistant", message: { content: [{ type: "text", text: "OK" }] } });
  out({ type: "result", subtype: "success", is_error: false, result: process.env.FAKE_ANSWER ?? "OK", session_id: "sess-1", total_cost_usd: 0.001, usage: { input_tokens: 10, output_tokens: 2 }, permission_denials: mode === "denials" ? [{ tool_name: "Bash" }] : [] });
}

async function codex() {
  if (args.includes("--version")) return console.log("codex-cli 0.153.4");
  if (args[0] === "login" && args[1] === "status") {
    const inn = (process.env.FAKE_AUTH ?? "in") === "in";
    console.log(inn ? "Logged in using ChatGPT" : "Not logged in");
    process.exit(inn ? 0 : 1);
  }
  if (args[0] === "exec" && args.includes("--help")) {
    return console.log(process.env.FAKE_EXEC_HELP ?? "--json --ignore-user-config --ignore-rules --ephemeral --sandbox --skip-git-repo-check");
  }
  if (args[0] !== "exec") process.exit(2);
  let stdin = "";
  for await (const c of process.stdin) stdin += c;
  log({ dialect, args, stdin, cwd: process.cwd(), envKeys: Object.keys(process.env) });
  out({ type: "thread.started", thread_id: "thr-1" });
  out({ type: "turn.started" });
  if (mode === "hang") return hang();
  if (mode === "drift") {
    out({ kind: "something-new", payload: 1 });
    return;
  }
  if (mode === "failed-turn") {
    out({ type: "error", message: "unauthorized: 401 token expired" });
    out({ type: "turn.failed", error: { message: "unauthorized: 401 token expired" } });
    process.exit(1);
  }
  out({ type: "item.completed", item: { id: "item_0", type: "error", message: "Exceeded skills context budget." } });
  if (mode === "denied") out({ type: "item.completed", item: { id: "item_1", type: "command_execution", command: "rm -rf /", status: "declined" } });
  if (mode === "retry-then-ok") out({ type: "error", message: "Reconnecting... 1/5" });
  out({ type: "item.completed", item: { id: "item_2", type: "agent_message", text: process.env.FAKE_ANSWER ?? "OK" } });
  out({ type: "turn.completed", usage: { input_tokens: 5, output_tokens: 1 } });
}

async function agy() {
  if (args.includes("--version")) return console.log("1.2.17");
  const prompt = args[args.indexOf("--print") + 1] ?? "";
  log({ dialect, args, cwd: process.cwd(), prompt, home: process.env.USERPROFILE, homeExists: existsSync(process.env.USERPROFILE ?? "") });
  out({ event: "init", conversation_id: "conv-1", init: { model: "gemini-test", cwd: process.cwd(), permission_mode: "request-review", tools: ["view_file"] } });
  if (mode === "hang") return hang();
  if (mode === "no-result") return;
  if (mode === "writes-file") {
    writeFileSync(join(process.cwd(), "hello.txt"), "hi\n");
    const notes = join(process.cwd(), "notes.txt");
    if (existsSync(notes)) appendFileSync(notes, "added by agy\n");
  }
  if (mode === "tool-denied") {
    out({ event: "step_update", step_update: { step_type: "tool", tool_name: "write_to_file", state: "ACTIVE", step_index: 1 } });
    out({ event: "step_update", step_update: { step_type: "tool", tool_name: "write_to_file", state: "ERROR", step_index: 1 } });
    out({ event: "result", result: { status: "SUCCESS", response: "", usage: { input_tokens: 5, output_tokens: 0 } } });
    return;
  }
  if (mode === "error-status") {
    out({ event: "result", result: { status: "ERROR", response: "You are not logged into Antigravity", usage: {} } });
    return;
  }
  let answer = process.env.FAKE_ANSWER ?? "OK";
  if (prompt.includes("NONON-TASK.md")) {
    const text = readFileSync(join(process.cwd(), "NONON-TASK.md"), "utf8");
    answer = `TASKFILE:${text.length}`;
  }
  out({ event: "step_update", step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: answer } });
  out({ event: "result", result: { status: "SUCCESS", response: `${answer}\n`, usage: { input_tokens: 7, output_tokens: 1, cache_read_tokens: 3 } } });
}
