import { join } from "node:path";
import type {
  ChatMessage,
  InferenceClient,
  InferenceRequest,
  InferenceResult,
  Locations,
  ProjectRoles,
  ProviderId,
  ProviderStatus,
  RoleName,
} from "../../../shared/contracts";
import { bindTeamDraftHost } from "../procedures/team-draft/host";
import type { AppCtx, ProviderService } from "../types";
import { createAgyAdapter } from "./agy";
import { createClaudeAdapter } from "./claude";
import { createCodexAdapter } from "./codex";
import { runStagedTurn } from "./run-turn";
import { scrubSecrets } from "./scrub";
import { sweepStages, type ProposalContext, type StageInput } from "./stage";
import { runStages, type ArtifactRecord, type ProjectStageOptions, type ProjectStageResult, type StageDeps } from "./stages";
import { DISCLOSURES, LABELS, ProviderError, type ProviderAdapter, type TurnEvent } from "./types";

export { runStagedTurn, DATA_GUARD } from "./run-turn";
export { ProviderError } from "./types";
export type { ProviderAdapter, TurnEvent, TurnInput, TurnResult } from "./types";
export type { ArtifactRecord, ProjectStageOptions, ProjectStageResult, StageDeps } from "./stages";

const PROVIDERS: ProviderId[] = ["claude", "codex", "antigravity"];
const TEST_PROMPT = "Reply with the single word OK.";

/** The service plus the few extras the app needs beyond the agreed interface. */
export interface ProviderServiceX extends ProviderService {
  /** Runs one tiny real turn so `verified` can become `turn-tested`. Uses the person's own plan. */
  verify(id: ProviderId): Promise<ProviderStatus>;
  /** What `runProjectStages` needs. */
  readonly stageDeps: StageDeps;
}

export interface ProviderServiceOptions {
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  /** Where throwaway staged folders go. Defaults to <data dir>/provider-stage. */
  stageRoot?: string;
  now?: () => Date;
  /** Turn time limit. Tests shorten it to force a timeout. */
  timeoutMs?: number;
}

interface PersistedState {
  verified?: Partial<Record<ProviderId, { at: string; version?: string }>>;
}

const locationFor = (id: ProviderId): Locations => ({ ai: id, files: "this-computer" });

export function createProviderService(ctx: AppCtx, options: ProviderServiceOptions = {}): ProviderServiceX {
  const adapters: Record<ProviderId, ProviderAdapter> = {
    claude: options.adapters?.claude ?? createClaudeAdapter(),
    codex: options.adapters?.codex ?? createCodexAdapter(),
    antigravity: options.adapters?.antigravity ?? createAgyAdapter(),
  };
  const stageRoot = options.stageRoot ?? join(ctx.paths.dataDir, "provider-stage");
  const now = options.now ?? (() => new Date());
  try {
    sweepStages(stageRoot);
  } catch {
    /* a locked leftover folder is cleaned on the next start */
  }

  const statuses = new Map<ProviderId, ProviderStatus>();
  /** The adapter's latest own reading, before session and remembered evidence is added. */
  const raws = new Map<ProviderId, ProviderStatus>();
  const turnTested = new Map<ProviderId, string>();
  const incompatible = new Map<ProviderId, { version: string | undefined; reason: string }>();
  let initialProbe: Promise<void> | null = null;

  const placeholder = (id: ProviderId): ProviderStatus => ({
    id,
    label: LABELS[id],
    state: "not-connected",
    disclosure: DISCLOSURES[id],
    detail: "Not checked yet.",
    verified: "untested",
  });
  for (const id of PROVIDERS) statuses.set(id, placeholder(id));

  const persisted = (): PersistedState => ctx.store.read<PersistedState>("provider-state.json", {});
  const remember = (id: ProviderId, version: string | undefined) => {
    const state = persisted();
    state.verified = { ...state.verified, [id]: { at: now().toISOString(), ...(version ? { version } : {}) } };
    ctx.store.write("provider-state.json", state);
  };
  const forget = (id: ProviderId) => {
    const state = persisted();
    if (state.verified?.[id]) {
      delete state.verified[id];
      ctx.store.write("provider-state.json", state);
    }
  };

  const publish = () => ctx.emit("providers:updated", list());
  const set = (status: ProviderStatus) => {
    statuses.set(status.id, status);
    publish();
    return status;
  };

  /** Combine what the adapter just saw with what this session and earlier sessions proved. */
  function reconcile(raw: ProviderStatus): ProviderStatus {
    const id = raw.id;
    const mark = incompatible.get(id);
    if (mark && mark.version === raw.version && raw.state !== "not-installed") {
      return { ...raw, state: "incompatible", verified: "probe-only", detail: mark.reason };
    }
    if (raw.state === "needs-sign-in" || raw.state === "not-installed") {
      turnTested.delete(id);
      if (raw.state === "needs-sign-in") forget(id);
      return raw;
    }
    const sessionOk = turnTested.get(id);
    if (id === "antigravity" && raw.state === "not-connected") {
      // agy cannot report its sign-in, so only a real turn (this session or remembered) makes it usable.
      if (sessionOk) return { ...raw, state: "ready", verified: "turn-tested", detail: "Worked in a small test during this session." };
      const earlier = persisted().verified?.[id];
      if (earlier && earlier.version === raw.version) {
        return { ...raw, state: "ready", verified: "probe-only", detail: `A small test worked on ${earlier.at.slice(0, 10)}. Sign-in is not re-checked until you use it.` };
      }
      return raw;
    }
    if (raw.state === "ready" && sessionOk) {
      return { ...raw, verified: "turn-tested", detail: `${raw.detail ?? ""} A small test worked during this session.`.trim() };
    }
    return raw;
  }

  async function probe(id: ProviderId): Promise<ProviderStatus> {
    let raw: ProviderStatus;
    try {
      raw = await adapters[id].probe();
    } catch (error) {
      raw = { id, label: LABELS[id], state: "failed", disclosure: DISCLOSURES[id], verified: "untested", detail: `NONON could not finish the check: ${scrubSecrets(error instanceof Error ? error.message : String(error)).slice(0, 200)}` };
    }
    raws.set(id, raw);
    return set(reconcile(raw));
  }

  function list(): ProviderStatus[] {
    if (!initialProbe) {
      initialProbe = Promise.all(PROVIDERS.map((id) => probe(id))).then(() => undefined);
      initialProbe.catch(() => undefined);
    }
    return PROVIDERS.map((id) => statuses.get(id) as ProviderStatus);
  }

  function assertAllowed(workspaceId: string, provider: ProviderId): void {
    const ws = ctx.svc.workspaces.get(workspaceId);
    if (!ws) throw new ProviderError("none", "policy", "That project could not be found, so no online AI was used.");
    if (ws.policy !== "cloud-allowed") {
      throw new ProviderError("none", "policy", `"${ws.name}" is set to keep everything on this computer, so ${LABELS[provider]} was not used. Nothing was sent. You can change this in the project settings.`);
    }
    const status = statuses.get(provider);
    if (!status || status.state !== "ready") {
      throw new ProviderError(provider, "not-ready", `${LABELS[provider]} is not ready to use. Open Connected AI in settings to fix it. Nothing was sent.`);
    }
  }

  /** After a failed turn, keep the status honest so the next step does not walk into the same wall. */
  function noteFailure(id: ProviderId, error: unknown): void {
    if (!(error instanceof ProviderError)) return;
    const base = statuses.get(id) ?? placeholder(id);
    if (error.code === "auth") {
      turnTested.delete(id);
      forget(id);
      set({ ...base, state: "needs-sign-in", verified: "probe-only", detail: error.message });
    } else if (error.code === "incompatible") {
      incompatible.set(id, { version: base.version, reason: error.message });
      set({ ...base, state: "incompatible", verified: "probe-only", detail: error.message });
    } else if (error.code === "limit") {
      set({ ...base, state: "unavailable", detail: error.message });
    } else if (error.code === "spawn") {
      set({ ...base, state: "failed", detail: error.message });
    }
  }

  function noteSuccess(id: ProviderId): void {
    turnTested.set(id, now().toISOString());
    const raw = raws.get(id) ?? placeholder(id);
    if (id === "antigravity") remember(id, raw.version);
    set(reconcile(raw.state === "failed" || raw.state === "unavailable" ? { ...raw, state: id === "antigravity" ? "not-connected" : "ready" } : raw));
  }

  function toPrompt(messages: ChatMessage[], jsonSchema?: Record<string, unknown>): { system: string | undefined; prompt: string } {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const turns = messages.filter((m) => m.role !== "system");
    let prompt: string;
    if (turns.length === 1 && turns[0]?.role === "user") prompt = turns[0].content;
    else {
      const transcript = turns.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
      prompt = `Conversation so far:\n\n${transcript}\n\nReply to the last user message.`;
    }
    if (jsonSchema) {
      prompt += `\n\nReply with only one JSON value that matches this JSON Schema. No commentary and no code fence.\n${JSON.stringify(jsonSchema)}`;
    }
    return { system: system || undefined, prompt };
  }

  async function runOne(
    id: ProviderId,
    req: { prompt: string; system?: string; signal?: AbortSignal; onEvent?: (e: TurnEvent) => void; model?: string },
    inputs: StageInput[] = [],
    proposals?: ProposalContext,
  ) {
    try {
      const out = await runStagedTurn({
        adapter: adapters[id],
        stageRoot,
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        inputs,
        prompt: req.prompt,
        ...(req.system ? { systemPrompt: req.system } : {}),
        ...(req.signal ? { signal: req.signal } : {}),
        ...(req.onEvent ? { onEvent: req.onEvent } : {}),
        ...(req.model ? { model: req.model } : {}),
        ...(proposals ? { proposals } : {}),
      });
      noteSuccess(id);
      return out;
    } catch (error) {
      noteFailure(id, error);
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(id, "failed", `${LABELS[id]} stopped because of a problem: ${scrubSecrets(error instanceof Error ? error.message : String(error)).slice(0, 200)}`);
    }
  }

  const service: ProviderServiceX = {
    list,
    probe,

    async signIn(id) {
      const first = await probe(id);
      if (first.state === "not-installed") return first;
      if (id === "antigravity") {
        // No status command, so a real small test is the only honest check. Open the sign-in window only if it fails.
        try {
          return await service.verify(id);
        } catch (error) {
          if (!(error instanceof ProviderError) || error.code !== "auth") return statuses.get(id) ?? first;
        }
      } else if (first.state === "ready") {
        return first;
      }
      try {
        await adapters[id].signIn();
      } catch (error) {
        return set({ ...first, state: "failed", detail: scrubSecrets(error instanceof Error ? error.message : String(error)) });
      }
      if (id === "antigravity") {
        try {
          return await service.verify(id);
        } catch {
          return statuses.get(id) ?? first;
        }
      }
      return probe(id);
    },

    async verify(id) {
      const out = await runOne(id, { prompt: TEST_PROMPT });
      if (!/\bok\b/i.test(out.text)) {
        throw new ProviderError(id, "failed", `${LABELS[id]} answered, but not with the word the test asked for, so the test did not count.`);
      }
      return statuses.get(id) ?? (await probe(id));
    },

    roles(workspaceId): ProjectRoles {
      const all = ctx.store.read<Record<string, ProjectRoles["roles"]>>("roles.json", {});
      return { workspaceId, roles: all[workspaceId] ?? {} };
    },

    setRole(workspaceId, role: RoleName, provider): ProjectRoles {
      if (!["design", "implement", "review"].includes(role)) throw new Error(`Unknown role: ${role}`);
      if (provider !== null && provider !== "local" && !PROVIDERS.includes(provider)) throw new Error(`Unknown provider: ${String(provider)}`);
      if (provider !== null && provider !== "local") {
        const ws = ctx.svc.workspaces.get(workspaceId);
        if (ws && ws.policy !== "cloud-allowed") {
          throw new Error(`"${ws.name}" keeps everything on this computer, so ${LABELS[provider]} cannot be used for a step here. Allow connected AI for this project first.`);
        }
      }
      const all = ctx.store.read<Record<string, ProjectRoles["roles"]>>("roles.json", {});
      const roles = { ...(all[workspaceId] ?? {}) };
      if (provider === null) delete roles[role];
      else roles[role] = provider;
      all[workspaceId] = roles;
      ctx.store.write("roles.json", all);
      return { workspaceId, roles };
    },

    clientFor(workspaceId, provider): InferenceClient {
      assertAllowed(workspaceId, provider);
      return {
        location: locationFor(provider),
        async chat(req: InferenceRequest): Promise<InferenceResult> {
          // Checked again on every call: the policy or the sign-in may have changed since the client was made.
          assertAllowed(workspaceId, provider);
          const { system, prompt } = toPrompt(req.messages, req.jsonSchema);
          const out = await runOne(provider, {
            prompt,
            ...(system ? { system } : {}),
            ...(req.signal ? { signal: req.signal } : {}),
            ...(req.onToken ? { onEvent: (e: TurnEvent) => e.type === "text" && req.onToken?.(e.delta) } : {}),
          });
          return {
            text: out.text,
            ...(out.usage?.inputTokens !== undefined ? { promptTokens: out.usage.inputTokens } : {}),
            ...(out.usage?.outputTokens !== undefined ? { completionTokens: out.usage.outputTokens } : {}),
            location: locationFor(provider),
          };
        },
      };
    },

    stageDeps: {
      roles: (workspaceId) => service.roles(workspaceId),
      async run(request) {
        if (request.provider === "local") {
          const out = await ctx.svc.runtime.client().chat({
            messages: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: request.prompt },
            ],
            ...(request.jsonSchema ? { jsonSchema: request.jsonSchema } : {}),
            ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.signal ? { signal: request.signal } : {}),
          });
          return { text: out.text, proposals: [], warnings: [] };
        }
        assertAllowed(request.workspaceId, request.provider);
        const out = await runOne(
          request.provider,
          { prompt: request.prompt, system: request.systemPrompt, ...(request.signal ? { signal: request.signal } : {}) },
          request.inputs,
          { outputDir: ctx.svc.workspaces.outputDir(request.workspaceId) },
        );
        return { text: out.text, proposals: out.proposals, ...(out.model ? { model: out.model } : {}), warnings: out.warnings };
      },
      load: (workspaceId) => ctx.store.read<Record<string, ArtifactRecord[]>>("stage-artifacts.json", {})[workspaceId] ?? [],
      save(workspaceId, records) {
        const all = ctx.store.read<Record<string, ArtifactRecord[]>>("stage-artifacts.json", {});
        all[workspaceId] = records;
        ctx.store.write("stage-artifacts.json", all);
      },
      now,
    },
  };
  // ProcedureRunContext carries no services, so the team-draft procedure reaches the stage runner through this binding.
  bindTeamDraftHost({
    deps: service.stageDeps,
    policy: (workspaceId) => ctx.svc.workspaces.get(workspaceId)?.policy,
    setRole: (workspaceId, role, provider) => service.setRole(workspaceId, role, provider),
  });
  return service;
}

/**
 * Runs the project's configured roles one after another (design, implement, review) for one task. Each stage gets
 * only the task, the shared files and the earlier artifacts it needs; every artifact records its provider, the hash of
 * its inputs and the time; changed inputs make older artifacts stale. Results come back as text and suggestions for
 * the review layer, never as writes. Not part of `ProviderService` on purpose.
 */
export function runProjectStages(providers: ProviderServiceX, workspaceId: string, opts: ProjectStageOptions): Promise<ProjectStageResult> {
  return runStages(providers.stageDeps, workspaceId, opts);
}
