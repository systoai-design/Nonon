import type { Settings, Workspace } from "../../../../shared/contracts";

/** What every settings section receives from SettingsView. Actions reject with a plain message. */
export interface SettingsCtx {
  settings: Settings;
  workspaces: Workspace[];
  version: string;
  platform: string;
  patchSettings: (patch: Partial<Settings>) => Promise<void>;
  patchWorkspace: (id: string, patch: Partial<Pick<Workspace, "name" | "folder" | "pack" | "policy" | "autoApply">>) => Promise<void>;
  removeWorkspace: (id: string) => Promise<void>;
}
