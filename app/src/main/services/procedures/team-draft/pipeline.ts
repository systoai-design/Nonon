import type { ProjectRoles, ProviderId, RoleName } from "../../../../shared/contracts";
import { ProviderError } from "../../providers/types";
import type { StageDeps, StageRunRequest, StageRunResult } from "../../providers/stages";
import type { TeamDraftHost } from "./host";
import { MAX_TOKENS, SYSTEM } from "./prompts";
import type { TeamSource } from "./source";
import { CHECKERS, JSON_SCHEMA, specFromPrompt } from "./validate";

export const STAGE_LABEL: Record<RoleName, string> = { design: "Plan", implement: "Write", review: "Check" };
const CLOUD_NAME: Record<ProviderId, string> = { claude: "Claude", codex: "Codex", antigravity: "Antigravity" };

/** "This computer" for the on-device AI, "Claude (online)" for the others. Shown in the task steps and the provenance table. */
export function providerLabel(p: ProviderId | "local"): string {
  return p === "local" ? "This computer" : `${CLOUD_NAME[p]} (online)`;
}
export function providerName(p: ProviderId | "local"): string {
  return p === "local" ? "The AI on this computer" : CLOUD_NAME[p];
}

export interface StageTrace {
  stage: RoleName;
  provider: ProviderId | "local";
  attempts: number;
  ms: number;
  /** What code removed from the reply (line numbers that are not in the source, repeated sentences). */
  dropped: string[];
  model?: string;
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n)}...`);

/**
 * The stage runner for team-draft. Wraps the provider service's own runner and adds what this procedure needs:
 * a stage with no role runs locally; cloud is refused before anything is sent when the workspace keeps files here;
 * every reply is checked and gets one retry; nothing is ever re-routed to another provider.
 */
export function teamStageDeps(host: TeamDraftHost, opts: { workspaceName: string; source: TeamSource; trace: StageTrace[] }): StageDeps {
  const base = host.deps;
  return {
    roles(workspaceId): ProjectRoles {
      const r = base.roles(workspaceId).roles;
      return { workspaceId, roles: { design: r.design ?? "local", implement: r.implement ?? "local", review: r.review ?? "local" } };
    },
    load: (w) => base.load(w),
    save: (w, records) => base.save(w, records),
    ...(base.now ? { now: base.now.bind(base) } : {}),

    async run(req: StageRunRequest): Promise<StageRunResult> {
      if (req.provider !== "local" && host.policy(req.workspaceId) !== "cloud-allowed") {
        throw new ProviderError(
          "none",
          "policy",
          `"${opts.workspaceName}" keeps everything on this computer, so ${CLOUD_NAME[req.provider]} was not used and nothing was sent. Choose This computer for the ${STAGE_LABEL[req.role]} step, or allow online AI for this project.`,
        );
      }
      const check = CHECKERS[req.role];
      const plan = req.role === "implement" ? specFromPrompt(req.prompt) : null;
      const started = Date.now();
      let prompt = req.prompt;
      let fallback: { text: string; problems: string[]; res: StageRunResult } | null = null;
      let lastError = "";

      for (let attempt = 1; attempt <= 2; attempt++) {
        const res = await base.run({
          ...req,
          prompt,
          systemPrompt: SYSTEM[req.role],
          jsonSchema: JSON_SCHEMA[req.role],
          maxTokens: MAX_TOKENS[req.role],
          temperature: 0.2,
          inputs: [],
        });
        const checked = check(res.text, opts.source, plan);
        if (checked.ok && checked.problems.length === 0) {
          opts.trace.push({ stage: req.role, provider: req.provider, attempts: attempt, ms: Date.now() - started, dropped: [], ...(res.model ? { model: res.model } : {}) });
          return { ...res, text: checked.text };
        }
        if (checked.ok) {
          fallback = { text: checked.text, problems: checked.problems, res };
          lastError = checked.problems.join("; ");
        } else {
          lastError = checked.error;
        }
        prompt = `${req.prompt}\n\nYour earlier reply could not be used: ${lastError}. Here it is:\n${clip(res.text, 2500)}\n\nReply again with only valid JSON in the required shape. Use only line numbers that exist in the source.`;
      }

      if (fallback) {
        opts.trace.push({ stage: req.role, provider: req.provider, attempts: 2, ms: Date.now() - started, dropped: fallback.problems, ...(fallback.res.model ? { model: fallback.res.model } : {}) });
        return { ...fallback.res, text: fallback.text, warnings: [...fallback.res.warnings, ...fallback.problems] };
      }
      const who = providerName(req.provider);
      throw new ProviderError(
        req.provider === "local" ? "none" : req.provider,
        "failed",
        `${who} did not give a usable result for the ${STAGE_LABEL[req.role]} step, even after a second try. Nothing was made up and nothing was passed to another AI.`,
      );
    },
  };
}
