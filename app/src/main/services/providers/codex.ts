import type { ProviderStatus } from "../../../shared/contracts";
import { buildChildEnv, resolveBin, type ResolvedBin } from "./bin";
import { assertWorkingFolder, runOnce, startCli, supervise } from "./process";
import { runVendorSignIn } from "./claude";
import { looksLikeAuthProblem, looksLikeLimit, plainReason, scrubSecrets, tidyTail } from "./scrub";
import { DISCLOSURES, LABELS, ProviderError, type ProviderAdapter, type TurnInput, type TurnResult } from "./types";

export interface CodexAdapterOptions {
  resolve?: () => ResolvedBin | null;
  env?: () => NodeJS.ProcessEnv;
  defaultTimeoutMs?: number;
}

/** The release line this adapter was tested against. Other lines still run if the options below exist. */
export const CODEX_TESTED_LINE = "0.153";

/**
 * Why `codex exec` and not `codex app-server`: both were tried on this PC. The app-server cannot be told to skip the
 * person's own config, so it started their global MCP servers (a code index, a docs lookup, a script runner) and read
 * their default model, which their account could not use. `exec --ignore-user-config` starts none of that, and login
 * still comes from the vendor's own store. Flags the adapter relies on; a build without one is "incompatible".
 */
const REQUIRED_FLAGS = ["--json", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--sandbox", "--skip-git-repo-check"];

const FEATURES_OFF = ["apps", "plugins", "hooks", "memories", "browser_use", "computer_use", "in_app_browser", "multi_agent", "image_generation"];
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function execArgs(cwd: string, model?: string): string[] {
  return [
    "exec",
    "--json",
    // Only login is read from the person's Codex folder; settings, plugins and tool servers are not.
    "--ignore-user-config",
    "--ignore-rules",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox", "read-only",
    // A request for more access is refused, never put to anyone.
    "-c", 'approval_policy="never"',
    ...FEATURES_OFF.flatMap((f) => ["--disable", f]),
    "-C", cwd,
    ...(model ? ["-m", model] : []),
    "-",
  ];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export function createCodexAdapter(options: CodexAdapterOptions = {}): ProviderAdapter {
  const resolve = options.resolve ?? (() => resolveBin("codex"));
  const env = options.env ?? (() => buildChildEnv(["CODEX_HOME"]));

  return {
    id: "codex",
    label: LABELS.codex,

    async probe(): Promise<ProviderStatus> {
      const base = { id: "codex" as const, label: LABELS.codex, disclosure: DISCLOSURES.codex };
      const bin = resolve();
      if (!bin) return { ...base, state: "not-installed", verified: "untested", detail: "Codex is not installed on this computer. Install it, then choose Check again." };
      const v = await runOnce(bin, ["--version"], env(), process.cwd(), 15000);
      if (v.spawnError || v.code !== 0) {
        return { ...base, state: "failed", verified: "untested", detail: `The Codex program on this computer would not start (${tidyTail(v.stderr || v.spawnError?.message || "no output", 160)}). Try installing it again.` };
      }
      const version = /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1];
      const withVersion = version ? { version } : {};
      const help = await runOnce(bin, ["exec", "--help"], env(), process.cwd(), 20000);
      const missing = REQUIRED_FLAGS.filter((f) => !help.stdout.includes(f));
      if (missing.length) {
        return {
          ...base,
          state: "incompatible",
          ...withVersion,
          verified: "probe-only",
          detail: `This version of Codex is too old for NONON to use it safely. It is missing: ${missing.join(", ")}. Update Codex to version ${CODEX_TESTED_LINE}.x or newer, then check again.`,
        };
      }
      const status = await runOnce(bin, ["login", "status"], env(), process.cwd(), 20000);
      const text = `${status.stdout}\n${status.stderr}`;
      if (status.code !== 0 || /not logged in/i.test(text)) {
        return { ...base, state: "needs-sign-in", ...withVersion, verified: "probe-only", detail: "Codex is installed, but you are not signed in. Choose Sign in to use Codex's own sign-in page. This check did not use your plan." };
      }
      const tested = version?.startsWith(`${CODEX_TESTED_LINE}.`) ?? false;
      return {
        ...base,
        state: "ready",
        ...withVersion,
        verified: "probe-only",
        detail:
          (tested ? "You are signed in." : `You are signed in. This Codex version (${version ?? "unknown"}) is not the one NONON was tested with (${CODEX_TESTED_LINE}.x), so the first job may not work as expected.`) +
          " This check did not send anything to Codex, so it cannot promise a job will work.",
      };
    },

    async signIn() {
      const bin = resolve();
      if (!bin) throw new ProviderError("codex", "not-ready", "Codex is not installed on this computer. Install it, then choose Check again.");
      await runVendorSignIn(bin, ["login"], env());
    },

    async runTurn(input: TurnInput): Promise<TurnResult> {
      const bin = resolve();
      if (!bin) throw new ProviderError("codex", "not-ready", "Codex is not installed on this computer. Install it, then choose Check again.");
      assertWorkingFolder("codex", input.cwd);
      const started = Date.now();
      const warnings: string[] = [];
      const effective: Record<string, string> = { sandbox: "read-only (requested)", approvals: "never (requested)", userConfig: "ignored" };
      let denials = 0;
      let threadId: string | undefined;
      let lastText = "";
      let completed = false;
      let failedMessage: string | undefined;
      let sawThread = false;
      let usage: TurnResult["usage"];

      const handle = startCli({
        bin,
        args: execArgs(input.cwd, input.model),
        cwd: input.cwd,
        env: env(),
        onLine: (line) => {
          let evt: any;
          try {
            evt = JSON.parse(line);
          } catch {
            return;
          }
          if (!evt || typeof evt !== "object") return;
          switch (evt.type) {
            case "thread.started":
              sawThread = true;
              threadId = str(evt.thread_id);
              break;
            case "item.started": {
              const t = str(evt.item?.type);
              if (t && t !== "agent_message" && t !== "reasoning" && t !== "error") input.onEvent?.({ type: "tool", name: t, status: "started" });
              break;
            }
            case "item.completed": {
              const item = evt.item ?? {};
              if (item.type === "agent_message" && typeof item.text === "string" && item.text.trim()) {
                lastText = item.text;
                input.onEvent?.({ type: "text", delta: item.text });
              } else if (item.type === "error") {
                const m = str(item.message);
                if (m) warnings.push(tidyTail(m, 200));
              } else if (item.type !== "reasoning" && typeof item.type === "string") {
                const refused = item.status === "declined" || (item.type === "file_change" && item.status === "failed");
                if (refused) denials++;
                input.onEvent?.({ type: "tool", name: item.type, status: refused ? "denied" : "done" });
              }
              break;
            }
            case "turn.completed":
              completed = true;
              if (evt.usage) usage = { inputTokens: typeof evt.usage.input_tokens === "number" ? evt.usage.input_tokens : undefined, outputTokens: typeof evt.usage.output_tokens === "number" ? evt.usage.output_tokens : undefined };
              break;
            case "turn.failed":
              failedMessage = str(evt.error?.message) ?? "The turn failed.";
              break;
            case "error":
              // Codex also reports retries here; only turn.failed ends the turn.
              if (!failedMessage) failedMessage = str(evt.message);
              break;
          }
        },
      });
      handle.write(input.systemPrompt ? `${input.systemPrompt}\n\n${input.prompt}` : input.prompt);
      handle.endInput();
      const sup = supervise(handle, { signal: input.signal, timeoutMs: input.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS });
      const exit = await handle.closed;
      sup.dispose();

      if (sup.stopped === "aborted") throw new ProviderError("codex", "aborted", "Cancelled. Codex was stopped and nothing more was sent.");
      if (sup.stopped === "timeout") throw new ProviderError("codex", "timeout", "Codex took too long, so NONON stopped it. The job is paused.");
      if (exit.spawnError) throw new ProviderError("codex", "spawn", `The Codex program could not be started (${scrubSecrets(exit.spawnError.code ?? exit.spawnError.message)}). Nothing was sent.`);

      if (!completed) {
        const raw = `${failedMessage ?? ""} ${handle.stderr()}`;
        if (failedMessage || exit.code !== 0) {
          const why = plainReason("codex", raw);
          const code = looksLikeAuthProblem(raw) ? "auth" : looksLikeLimit(raw) ? "limit" : why.code;
          throw new ProviderError("codex", code, why.message);
        }
        throw new ProviderError("codex", "incompatible", sawThread ? "Codex stopped without saying it was finished, and NONON could not understand what it sent back." : "Codex sent back an answer that NONON could not understand.");
      }
      const text = lastText.trim();
      if (!text) throw new ProviderError("codex", "empty", "Codex finished but gave no answer. Please try again.");
      return {
        text,
        provider: "codex",
        ...(threadId ? { sessionId: threadId } : {}),
        durationMs: Date.now() - started,
        ...(usage ? { usage } : {}),
        denials,
        warnings,
        effective,
      };
    },
  };
}
