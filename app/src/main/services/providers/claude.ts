import { spawn } from "node:child_process";
import type { ProviderStatus } from "../../../shared/contracts";
import { buildChildEnv, resolveBin, type ResolvedBin } from "./bin";
import { assertWorkingFolder, runOnce, startCli, supervise } from "./process";
import { looksLikeAuthProblem, looksLikeLimit, plainReason, scrubSecrets, tidyTail } from "./scrub";
import { DISCLOSURES, LABELS, ProviderError, type ProviderAdapter, type TurnInput, type TurnResult } from "./types";

export interface ClaudeAdapterOptions {
  /** Tests point this at a fake program. */
  resolve?: () => ResolvedBin | null;
  env?: () => NodeJS.ProcessEnv;
  defaultTimeoutMs?: number;
}

/** Flags this adapter depends on. A build that lacks one is reported as incompatible instead of failing mid-turn. */
const REQUIRED_FLAGS = [
  "--output-format",
  "--strict-mcp-config",
  "--setting-sources",
  "--tools",
  "--permission-mode",
  "--no-session-persistence",
  "--disable-slash-commands",
];
/** Extra hardening used when the installed build has it. Verified on 2.1.280. */
const OPTIONAL_FLAGS = ["--safe-mode", "--restricted", "--permission-prompts"];

const READ_TOOLS = ["Read", "Glob", "Grep"];
const SYSTEM_PROMPT_ARGV_LIMIT = 6000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function createClaudeAdapter(options: ClaudeAdapterOptions = {}): ProviderAdapter & { flags(): Promise<string[]> } {
  const resolve = options.resolve ?? (() => resolveBin("claude"));
  const env = options.env ?? (() => buildChildEnv(["CLAUDE_CONFIG_DIR"]));
  let helpCache: { key: string; text: string } | null = null;

  async function helpText(bin: ResolvedBin): Promise<string> {
    const key = `${bin.command}|${bin.prefixArgs.join(" ")}`;
    if (helpCache?.key === key) return helpCache.text;
    const r = await runOnce(bin, ["--help"], env(), process.cwd(), 20000);
    helpCache = { key, text: r.stdout };
    return r.stdout;
  }

  return {
    id: "claude",
    label: LABELS.claude,

    async flags() {
      const bin = resolve();
      if (!bin) return [];
      const help = await helpText(bin);
      return OPTIONAL_FLAGS.filter((f) => help.includes(f));
    },

    async probe(): Promise<ProviderStatus> {
      const base = { id: "claude" as const, label: LABELS.claude, disclosure: DISCLOSURES.claude };
      const bin = resolve();
      if (!bin) {
        return { ...base, state: "not-installed", verified: "untested", detail: "Claude Code is not installed on this computer. Install it, then choose Check again." };
      }
      const cwd = process.cwd();
      const v = await runOnce(bin, ["--version"], env(), cwd, 15000);
      if (v.spawnError || v.code !== 0) {
        return { ...base, state: "failed", verified: "untested", detail: `The Claude program on this computer would not start (${tidyTail(v.stderr || v.spawnError?.message || "no output", 160)}). Try installing it again.` };
      }
      const version = /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1];
      const help = await helpText(bin);
      const missing = REQUIRED_FLAGS.filter((f) => !help.includes(f));
      if (missing.length) {
        return {
          ...base,
          state: "incompatible",
          ...(version ? { version } : {}),
          verified: "probe-only",
          detail: `This version of Claude Code is too old for NONON to use it safely. It is missing: ${missing.join(", ")}. Update Claude Code, then check again.`,
        };
      }
      const a = await runOnce(bin, ["auth", "status"], env(), cwd, 20000);
      // A signed-out CLI exits 1 but still prints its JSON, so the text decides, not the exit code.
      let loggedIn: boolean | undefined;
      try {
        const parsed = JSON.parse(a.stdout.trim()) as { loggedIn?: unknown };
        if (typeof parsed.loggedIn === "boolean") loggedIn = parsed.loggedIn;
      } catch {
        /* handled below */
      }
      if (loggedIn === undefined) {
        return {
          ...base,
          state: "failed",
          ...(version ? { version } : {}),
          verified: "probe-only",
          detail: `NONON could not tell whether you are signed in to Claude (${tidyTail(a.stderr || a.stdout || "no output", 160)}). Please try again.`,
        };
      }
      if (!loggedIn) {
        return {
          ...base,
          state: "needs-sign-in",
          ...(version ? { version } : {}),
          verified: "probe-only",
          detail: "Claude Code is installed, but you are not signed in. Choose Sign in to use Claude's own sign-in page. This check did not use your plan.",
        };
      }
      return {
        ...base,
        state: "ready",
        ...(version ? { version } : {}),
        verified: "probe-only",
        detail: "You are signed in. This check did not send anything to Claude, so it cannot promise a job will work.",
      };
    },

    async signIn() {
      const bin = resolve();
      if (!bin) throw new ProviderError("claude", "not-ready", "Claude Code is not installed on this computer. Install it, then choose Check again.");
      await runVendorSignIn(bin, ["auth", "login"], env());
    },

    async runTurn(input: TurnInput): Promise<TurnResult> {
      const bin = resolve();
      if (!bin) throw new ProviderError("claude", "not-ready", "Claude Code is not installed on this computer. Install it, then choose Check again.");
      const optional = await this.flags();
      const has = (f: string) => optional.includes(f);

      const files = input.allowFileRead === true;
      const args = [
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--strict-mcp-config",
        // Only the staged folder's own settings; the user's global plugins, hooks and MCP servers never load.
        "--setting-sources", "project",
        "--disable-slash-commands",
        "--permission-mode", "dontAsk",
      ];
      if (has("--permission-prompts")) args.push("--permission-prompts", "none");
      if (has("--safe-mode")) args.push("--safe-mode");
      if (has("--restricted")) args.push("--restricted");
      if (files) args.push("--tools", READ_TOOLS.join(","), "--allowedTools", ...READ_TOOLS);
      else args.push("--tools", "");
      if (input.model) args.push("--model", input.model);

      let prompt = input.prompt;
      if (input.systemPrompt) {
        if (input.systemPrompt.length <= SYSTEM_PROMPT_ARGV_LIMIT) args.push("--append-system-prompt", input.systemPrompt);
        else prompt = `${input.systemPrompt}\n\n${prompt}`;
      }

      assertWorkingFolder("claude", input.cwd);
      const started = Date.now();
      let text = "";
      let partial = "";
      let result: ClaudeResult | null = null;
      let initSeen = false;
      let isolationBreach: string | null = null;
      const effective: Record<string, string> = {};
      let denials = 0;
      const warnings: string[] = [];
      let sessionId: string | undefined;
      let model: string | undefined;
      const allowed = new Set(files ? READ_TOOLS : []);

      const handle = startCli({
        bin,
        args,
        cwd: input.cwd,
        env: env(),
        onLine: (line) => {
          const evt = parseJson(line);
          if (!evt) return;
          if (evt.type === "system" && evt.subtype === "init") {
            initSeen = true;
            sessionId = str(evt.session_id);
            model = str(evt.model);
            const tools = Array.isArray(evt.tools) ? evt.tools.map(String) : [];
            const mcp = Array.isArray(evt.mcp_servers) ? evt.mcp_servers : [];
            effective.tools = tools.length ? tools.join(",") : "none";
            effective.mcpServers = String(mcp.length);
            effective.permissionMode = String(evt.permissionMode ?? "");
            const extra = tools.filter((t) => !allowed.has(t));
            if (extra.length) isolationBreach = `Claude tried to use tools that NONON does not allow (${extra.join(", ")})`;
            else if (mcp.length) isolationBreach = "Claude tried to connect to outside tools that NONON does not allow";
            if (isolationBreach) void handle.kill();
          } else if (evt.type === "stream_event") {
            const e = evt.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
            if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) {
              partial += e.delta.text;
              input.onEvent?.({ type: "text", delta: e.delta.text });
            }
          } else if (evt.type === "assistant") {
            const content = (evt.message as { content?: unknown[] } | undefined)?.content ?? [];
            for (const block of content as { type?: string; text?: string; name?: string }[]) {
              if (block.type === "text" && typeof block.text === "string" && !evt.error) text = block.text;
              if (block.type === "tool_use") input.onEvent?.({ type: "tool", name: String(block.name ?? "tool"), status: "started" });
            }
          } else if (evt.type === "result") {
            result = evt as unknown as ClaudeResult;
          }
        },
      });
      handle.write(prompt);
      handle.endInput();
      const sup = supervise(handle, { signal: input.signal, timeoutMs: input.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS });
      const exit = await handle.closed;
      sup.dispose();

      if (sup.stopped === "aborted") throw new ProviderError("claude", "aborted", "Cancelled. Claude was stopped and nothing more was sent.");
      if (sup.stopped === "timeout") throw new ProviderError("claude", "timeout", "Claude took too long, so NONON stopped it. The job is paused.");
      if (isolationBreach) throw new ProviderError("claude", "isolation", `${isolationBreach}, so NONON stopped this step. Nothing was changed.`);
      if (exit.spawnError) throw new ProviderError("claude", "spawn", `The Claude program could not be started (${scrubSecrets(exit.spawnError.code ?? exit.spawnError.message)}). Nothing was sent.`);

      const final = result as ClaudeResult | null;
      if (!final) {
        const why = plainReason("claude", handle.stderr());
        throw new ProviderError("claude", why.code === "failed" ? "protocol" : why.code, initSeen ? `Claude ended without an answer. ${why.message}` : why.message);
      }
      if (final.is_error === true || final.subtype?.startsWith("error")) {
        const raw = `${str(final.result) ?? ""} ${str(final.terminal_reason) ?? ""}`;
        const why = plainReason("claude", raw);
        const code = looksLikeAuthProblem(raw) ? "auth" : looksLikeLimit(raw) ? "limit" : why.code;
        throw new ProviderError("claude", code, why.message);
      }
      denials = Array.isArray(final.permission_denials) ? final.permission_denials.length : 0;
      if (denials) warnings.push(`${denials} request(s) to use a tool were refused.`);
      const answer = (str(final.result) ?? text ?? partial).trim();
      if (!answer) throw new ProviderError("claude", "empty", "Claude finished but gave no answer. Please try again.");
      const session = str(final.session_id) ?? sessionId;
      return {
        text: answer,
        provider: "claude",
        ...(session ? { sessionId: session } : {}),
        ...(model ? { model } : {}),
        durationMs: Date.now() - started,
        ...(final.usage ? { usage: { inputTokens: num(final.usage.input_tokens), outputTokens: num(final.usage.output_tokens) } } : {}),
        ...(typeof final.total_cost_usd === "number" ? { costUsd: final.total_cost_usd } : {}),
        denials,
        warnings,
        effective,
      };
    },
  };
}

interface ClaudeResult {
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  session_id?: unknown;
  terminal_reason?: unknown;
  total_cost_usd?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
  permission_denials?: unknown[];
}

function parseJson(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/**
 * Runs the vendor's own sign-in command and waits for it. The vendor opens its own browser page; NONON never sees
 * or stores what the person types there.
 */
export function runVendorSignIn(bin: ResolvedBin, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 5 * 60 * 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin.command, [...bin.prefixArgs, ...args], {
      env: { ...env, ...bin.env },
      stdio: "ignore",
      windowsHide: false,
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* gone */
      }
      reject(new Error("Sign-in timed out. Try again."));
    }, timeoutMs);
    timer.unref?.();
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`The sign-in program could not be started (${scrubSecrets(e.message)}). Please try again.`));
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
