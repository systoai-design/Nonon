import type { AppCtx, LanService } from "../types";
import { electronSecretStore } from "../gmail/electron-adapters";
import { createLanService as createWith, type LanDeps } from "./service";

/**
 * This computer's own jobs keep priority: while one of its tasks is running on the local AI, paired requests are told to
 * wait. Chat replies made directly in the chat panel are not tracked here (see lan-evidence.md, known limits).
 */
function localTaskRunning(ctx: AppCtx): boolean {
  return ctx.svc.workspaces
    .list()
    .some((w) => ctx.svc.tasks.list(w.id).some((t) => t.state === "running" && t.locations.ai === "local"));
}

/** Production wiring: the OS-protected secret store and the real local runtime. Tests call service.ts with fakes. */
export function createLanService(ctx: AppCtx, deps: Partial<LanDeps> = {}): LanService {
  return createWith(ctx, { secrets: electronSecretStore, localBusy: () => localTaskRunning(ctx), ...deps });
}

export { HostUnavailableError, PairedAuthError } from "./errors";
