import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderStatus } from "../../../shared/contracts";
import { buildChildEnv, resolveBin, type ResolvedBin } from "./bin";
import { assertWorkingFolder, runOnce, startCli, supervise } from "./process";
import { looksLikeAuthProblem, looksLikeLimit, plainReason, scrubSecrets, tidyTail } from "./scrub";
import { DISCLOSURES, LABELS, ProviderError, type ProviderAdapter, type TurnInput, type TurnResult } from "./types";

export interface AgyAdapterOptions {
  resolve?: () => ResolvedBin | null;
  env?: () => NodeJS.ProcessEnv;
  defaultTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
/** Print mode takes the prompt on the command line, and Windows caps a whole command line near 32,000 characters. */
const ARGV_PROMPT_LIMIT = 12_000;
export const TASK_FILE = "NONON-TASK.md";

export function createAgyAdapter(options: AgyAdapterOptions = {}): ProviderAdapter {
  const resolve = options.resolve ?? (() => resolveBin("agy"));
  const env = options.env ?? (() => buildChildEnv());

  return {
    id: "antigravity",
    label: LABELS.antigravity,

    async probe(): Promise<ProviderStatus> {
      const base = { id: "antigravity" as const, label: LABELS.antigravity, disclosure: DISCLOSURES.antigravity };
      const bin = resolve();
      if (!bin) return { ...base, state: "not-installed", verified: "untested", detail: "Antigravity is not installed on this computer. Install it, then choose Check again." };
      const v = await runOnce(bin, ["--version"], env(), process.cwd(), 15000);
      if (v.spawnError || v.code !== 0) {
        return { ...base, state: "failed", verified: "untested", detail: `The Antigravity program on this computer would not start (${tidyTail(v.stderr || v.spawnError?.message || "no output", 160)}). Try installing it again.` };
      }
      const version = /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1];
      // agy has no sign-in status command and keeps its login in the system keychain, so a file check would guess.
      return {
        ...base,
        state: "not-connected",
        ...(version ? { version } : {}),
        verified: "untested",
        detail: "Antigravity is installed, but NONON cannot tell if you are signed in. Choose Connect to sign in. NONON will then run one small test.",
      };
    },

    async signIn() {
      const bin = resolve();
      if (!bin) throw new ProviderError("antigravity", "not-ready", "Antigravity is not installed on this computer. Install it, then choose Check again.");
      await openInTerminal(bin, env());
    },

    async runTurn(input: TurnInput): Promise<TurnResult> {
      const bin = resolve();
      if (!bin) throw new ProviderError("antigravity", "not-ready", "Antigravity is not installed on this computer. Install it, then choose Check again.");
      assertWorkingFolder("antigravity", input.cwd);
      const started = Date.now();
      const full = input.systemPrompt ? `${input.systemPrompt}\n\n${input.prompt}` : input.prompt;
      let argvPrompt = full;
      let taskFile: string | null = null;
      if (full.length > ARGV_PROMPT_LIMIT) {
        taskFile = join(input.cwd, TASK_FILE);
        writeFileSync(taskFile, full, "utf8");
        argvPrompt = `Read the file ${TASK_FILE} in the current folder. It holds your full instructions. Do what it says and reply with the answer only.`;
      }

      const args = [
        "--print", argvPrompt,
        "--output-format", "stream-json",
        // Terminal restrictions on. Print mode has no approval prompt, so writes and shell commands are refused by default.
        "--sandbox",
        "--disable-slash-commands",
      ];
      if (input.model) args.push("--model", input.model);

      // Real testing showed agy starts every MCP server in the person's global config (including a database one) and
      // loads their skills and notes. Its login lives in the system keychain, not in the profile folder, so a
      // throwaway home keeps the login while dropping all of that. The folder sits next to the staged one.
      const home = `${input.cwd}-home`;
      mkdirSync(home, { recursive: true });
      const childEnv: NodeJS.ProcessEnv = { ...env(), USERPROFILE: home, HOME: home };
      delete childEnv.HOMEDRIVE;
      delete childEnv.HOMEPATH;

      let conversationId: string | undefined;
      let model: string | undefined;
      let result: { status?: string; response?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_tokens?: number } } | null = null;
      let toolErrors = 0;
      let streamed = "";
      const effective: Record<string, string> = {};

      const handle = startCli({
        bin,
        args,
        cwd: input.cwd,
        env: childEnv,
        onLine: (line) => {
          let o: any;
          try {
            o = JSON.parse(line);
          } catch {
            return;
          }
          if (!o || typeof o !== "object") return;
          if (o.event === "init") {
            conversationId = typeof o.conversation_id === "string" ? o.conversation_id : undefined;
            model = typeof o.init?.model === "string" ? o.init.model : undefined;
            if (typeof o.init?.permission_mode === "string") effective.permissionMode = o.init.permission_mode;
            if (typeof o.init?.cwd === "string") effective.cwd = o.init.cwd;
          } else if (o.event === "step_update") {
            const s = o.step_update ?? {};
            if (s.step_type === "tool") {
              const name = String(s.tool_name ?? "tool");
              if (s.state === "ACTIVE") input.onEvent?.({ type: "tool", name, status: "started" });
              else if (s.state === "DONE") input.onEvent?.({ type: "tool", name, status: "done" });
              else if (s.state === "ERROR") {
                toolErrors++;
                input.onEvent?.({ type: "tool", name, status: "denied" });
              }
            } else if (s.step_type === "agent_response" && typeof s.text_delta === "string" && s.text_delta) {
              streamed += s.text_delta;
              input.onEvent?.({ type: "text", delta: s.text_delta });
            }
          } else if (o.event === "result") {
            result = o.result ?? {};
          }
        },
      });
      handle.endInput();
      const sup = supervise(handle, { signal: input.signal, timeoutMs: input.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS });
      const exit = await handle.closed;
      sup.dispose();
      if (taskFile) rmSync(taskFile, { force: true });
      removeQuietly(home);

      if (sup.stopped === "aborted") throw new ProviderError("antigravity", "aborted", "Cancelled. Antigravity was stopped and nothing more was sent.");
      if (sup.stopped === "timeout") throw new ProviderError("antigravity", "timeout", "Antigravity took too long, so NONON stopped it. The job is paused.");
      if (exit.spawnError) throw new ProviderError("antigravity", "spawn", `The Antigravity program could not be started (${scrubSecrets(exit.spawnError.code ?? exit.spawnError.message)}). Nothing was sent.`);

      // Exit code 0 proves nothing here: a refused tool or a missing login can still exit cleanly.
      const final = result as { status?: string; response?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_tokens?: number } } | null;
      if (!final) {
        const raw = `${handle.stderr()} ${streamed}`;
        const why = plainReason("antigravity", raw);
        throw new ProviderError("antigravity", why.code === "failed" ? "protocol" : why.code, why.message);
      }
      const answer = (typeof final.response === "string" ? final.response : streamed).trim();
      if (final.status !== "SUCCESS") {
        const raw = `${final.status ?? ""} ${answer} ${handle.stderr()}`;
        const why = plainReason("antigravity", raw);
        const code = looksLikeAuthProblem(raw) ? "auth" : looksLikeLimit(raw) ? "limit" : why.code;
        throw new ProviderError("antigravity", code, why.message);
      }
      if (!answer) {
        const why = plainReason("antigravity", handle.stderr());
        throw new ProviderError(
          "antigravity",
          why.code === "failed" ? "empty" : why.code,
          toolErrors ? "Antigravity needed a tool that NONON refused, so it gave no answer." : why.code === "failed" ? "Antigravity finished but gave no answer. Please try again." : why.message,
        );
      }
      const warnings: string[] = [];
      if (toolErrors) warnings.push(`${toolErrors} request(s) to use a tool were refused.`);
      const u = final.usage;
      return {
        text: answer,
        provider: "antigravity",
        ...(conversationId ? { sessionId: conversationId } : {}),
        ...(model ? { model } : {}),
        durationMs: Date.now() - started,
        ...(u ? { usage: { inputTokens: (u.input_tokens ?? 0) + (u.cache_read_tokens ?? 0), outputTokens: u.output_tokens ?? 0 } } : {}),
        denials: toolErrors,
        warnings,
        effective,
      };
    },
  };
}

function removeQuietly(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // The stale-folder sweep removes it later; a locked file must not fail the turn.
  }
}

/** agy signs in inside its own interactive screen, so it needs a real terminal window. */
function openInTerminal(bin: ResolvedBin, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    let child;
    if (process.platform === "win32") {
      child = spawn("cmd.exe", ["/c", "start", "NONON sign-in", "/wait", bin.command, ...bin.prefixArgs], { env, stdio: "ignore", windowsHide: false });
    } else if (process.platform === "darwin") {
      const line = [bin.command, ...bin.prefixArgs].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
      child = spawn("osascript", ["-e", `tell application "Terminal" to do script "${line.replace(/"/g, '\\"')}"`, "-e", 'tell application "Terminal" to activate'], { env, stdio: "ignore" });
    } else {
      reject(new Error("To sign in, open the Antigravity program on its own and sign in there. Then come back and choose Check again."));
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* gone */
      }
      resolve();
    }, 10 * 60 * 1000);
    timer.unref?.();
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`The sign-in window could not be opened (${scrubSecrets(e.message)}). Please try again.`));
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
