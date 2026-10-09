import type { AppCtx, GmailService } from "../types";
import { bindGmailService } from "../procedures/gmail-brief";
import { electronOpenExternal, electronSecretStore } from "./electron-adapters";
import { createGmailService as createWith, type GmailDeps } from "./service";

/** Production wiring: system browser and the OS-protected secret store. Tests call service.ts with fakes. */
export function createGmailService(ctx: AppCtx, deps: Partial<GmailDeps> = {}): GmailService {
  const service = createWith(ctx, { openExternal: electronOpenExternal, secrets: electronSecretStore, ...deps });
  bindGmailService(service);
  return service;
}
