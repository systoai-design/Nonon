import { z } from "zod";
import type { ChannelName } from "../shared/ipc";

/**
 * Every value the window sends crosses this boundary first. The window is our own code, but it renders
 * text from documents and mail, so main treats what it sends as untrusted input: ids are filename-safe
 * (they become file names in the data folder), paths are plain strings, and sizes are capped.
 */

const ID = /^[A-Za-z0-9_-]{1,100}$/;
export const id = z.string().regex(ID);
const path = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !s.includes("\0"), "bad path");
const shortText = z.string().max(200);
const bigText = z.string().max(2_000_000);
const pack = z.enum(["general", "business", "bookkeeping", "education"]);
const policy = z.enum(["local-only", "cloud-allowed"]);
const provider = z.enum(["claude", "codex", "antigravity"]);
const role = z.enum(["design", "implement", "review"]);
const strings = z.record(z.string().max(200), z.string().max(4096));

const anything = z.unknown();

const settingsPatch = z
  .object({
    onboarded: z.boolean(),
    companionName: z.string().max(60),
    character: z.enum(["non", "pebble", "moss", "ember", "tide"]),
    reducedMotion: z.boolean(),
    activeWorkspaceId: id.nullable(),
    modelId: z.string().max(100).nullable(),
    backgroundRoutines: z.boolean(),
    idleUnloadSeconds: z.number().int().min(0).max(86_400),
    uiScale: z.number().min(0.5).max(2),
  })
  .partial();

const workspacePatch = z
  .object({
    name: z.string().max(200),
    folder: path.nullable(),
    pack,
    policy,
    autoApply: z.boolean(),
    preferredAi: z.enum(["local", "paired"]),
  })
  .partial();

// The scheduler checks the routine in depth; here it only has to be an object whose id is safe.
const routine = z.looseObject({ id: z.string().max(100).regex(/^[A-Za-z0-9_-]*$/), workspaceId: id });

export const ARG_SCHEMAS = {
  "app:state": anything,
  "settings:update": settingsPatch,
  "shell:reveal": z.object({ path }),
  "shell:open": z.object({ path }),
  "output:preview": z.object({ path, maxRows: z.number().int().min(1).max(10_000).optional() }),

  "workspace:create": z.object({ name: z.string().max(200), folder: path.nullable(), pack, policy: policy.optional() }),
  "workspace:update": z.object({ id, patch: workspacePatch }),
  "workspace:remove": z.object({ id }),
  "workspace:pick-folder": anything,
  "workspace:files": z.object({ id }),
  "workspace:pick-files": z.object({ accept: z.array(z.string().max(20)).max(50).optional() }),
  "workspace:add-samples": z.object({ id }),

  "hardware:assess": anything,
  "runtime:status": anything,
  "runtime:install": z.object({ modelId: z.string().max(100) }),
  "runtime:cancel": anything,
  "runtime:start": anything,
  "runtime:stop": anything,
  "runtime:discover": anything,
  "runtime:use-existing": z.object({ id: z.string().regex(/^[0-9a-f]{40}$/) }),
  "runtime:use-file": anything,
  "runtime:forget-existing": anything,

  "procedure:list": z.object({ pack: pack.optional() }),
  "task:list": z.object({ workspaceId: id }),
  "task:get": z.object({ id }),
  "task:start": z.object({
    workspaceId: id,
    procedureId: id,
    files: z.record(id, z.array(path).max(200)).optional(),
    text: z.record(id, bigText).optional(),
    answers: strings.optional(),
  }),
  "task:answer": z.object({ id, answers: strings, remember: z.boolean().optional() }),
  "task:stop": z.object({ id }),
  "task:resume": z.object({ id }),

  "chat:history": z.object({ workspaceId: id }),
  "chat:send": z.object({ workspaceId: id, text: bigText, files: z.array(path).max(200).optional() }),
  "chat:stop": z.object({ workspaceId: id }),

  "change:list": z.object({ workspaceId: id.optional(), taskId: id.optional() }),
  "change:apply": z.object({ id }),
  "change:reject": z.object({ id }),
  "change:recover": z.object({ id }),

  "routine:list": z.object({ workspaceId: id.optional() }),
  "routine:propose": z.object({ workspaceId: id, text: z.string().max(5000) }),
  "routine:save": z.object({ routine }),
  "routine:set-enabled": z.object({ id, enabled: z.boolean() }),
  "routine:run-now": z.object({ id }),
  "routine:remove": z.object({ id }),
  "routine:runs": z.object({ routineId: id.optional(), limit: z.number().int().min(1).max(1000).optional() }),

  "gmail:status": anything,
  "gmail:connect": anything,
  "gmail:disconnect": anything,
  "gmail:brief": z.object({ workspaceId: id, forceOffline: z.boolean().optional() }),

  "provider:list": anything,
  "provider:probe": z.object({ id: provider }),
  "provider:sign-in": z.object({ id: provider }),
  "roles:get": z.object({ workspaceId: id }),
  "roles:set": z.object({ workspaceId: id, role, provider: z.union([provider, z.literal("local"), z.null()]) }),

  "lan:status": anything,
  "lan:host-start": anything,
  "lan:host-stop": anything,
  "lan:pairing-code": anything,
  "lan:approve": z.object({ requestId: id }),
  "lan:deny": z.object({ requestId: id }),
  "lan:revoke": z.object({ deviceId: id }),
  "lan:pair": z.object({ pairing: z.string().min(1).max(1024), deviceName: shortText }),
  "lan:client-status": anything,
  "lan:unpair": anything,

  "diagnostics:snapshot": anything,
} satisfies Record<ChannelName, z.ZodType>;

export class BadRequest extends Error {
  constructor() {
    super("NONON could not understand that request.");
  }
}

/** Returns the checked argument, with unknown keys dropped. Throws BadRequest for anything that does not fit. */
export function parseArg(channel: string, raw: unknown): unknown {
  // Own keys only: "constructor" and "__proto__" are not channels.
  if (typeof channel !== "string" || !Object.hasOwn(ARG_SCHEMAS, channel)) throw new BadRequest();
  const schema = (ARG_SCHEMAS as Record<string, z.ZodType>)[channel] as z.ZodType;
  const result = schema.safeParse(raw);
  if (!result.success) throw new BadRequest();
  return result.data;
}
