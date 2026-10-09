import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FileEntry, Workspace } from "../../shared/contracts";
import { UserError } from "./core/errors";
import { OUTPUT_DIR_NAME, copyTreeNoOverwrite, isReallyInside, listFolder } from "./core/files";
import { isInside, newId, nowIso } from "./fs-util";
import type { AppCtx, WorkspaceService } from "./types";

const FILE = "workspaces.json";

export function createWorkspaceService(ctx: AppCtx): WorkspaceService {
  let items: Workspace[] = ctx.store.read<Workspace[]>(FILE, []);
  const persist = (): void => ctx.store.write(FILE, items);

  const mustGet = (id: string): Workspace => {
    const ws = items.find((w) => w.id === id);
    if (!ws) throw new UserError("That project no longer exists.");
    return ws;
  };

  const folderOf = (ws: Workspace): string => {
    if (!ws.folder) throw new UserError("This project has no folder yet. Choose a folder to work in first.");
    if (!existsSync(ws.folder) || !statSync(ws.folder).isDirectory()) {
      throw new UserError("NONON cannot find this project's folder. It may have been moved or renamed.");
    }
    return ws.folder;
  };

  const svc: WorkspaceService = {
    list: () => items.map((w) => ({ ...w })),
    get: (id) => {
      const ws = items.find((w) => w.id === id);
      return ws ? { ...ws } : undefined;
    },

    create(input) {
      const name = input.name.trim();
      if (!name) throw new UserError("Give the project a name.");
      const ws: Workspace = {
        id: newId("ws"),
        name,
        folder: input.folder ? resolve(input.folder) : null,
        pack: input.pack,
        policy: input.policy ?? "local-only",
        autoApply: false,
        createdAt: nowIso(),
      };
      items = [...items, ws];
      persist();
      const active = ctx.getSettings().activeWorkspaceId;
      if (!active || !items.some((w) => w.id === active)) ctx.updateSettings({ activeWorkspaceId: ws.id });
      return { ...ws };
    },

    update(id, patch) {
      const ws = mustGet(id);
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name) throw new UserError("Give the project a name.");
        ws.name = name;
      }
      if (patch.folder !== undefined) ws.folder = patch.folder ? resolve(patch.folder) : null;
      if (patch.pack !== undefined) ws.pack = patch.pack;
      if (patch.policy !== undefined) ws.policy = patch.policy;
      if (patch.autoApply !== undefined) ws.autoApply = patch.autoApply;
      if (patch.preferredAi !== undefined) ws.preferredAi = patch.preferredAi;
      persist();
      return { ...ws };
    },

    remove(id) {
      mustGet(id);
      items = items.filter((w) => w.id !== id);
      persist();
      if (ctx.getSettings().activeWorkspaceId === id) ctx.updateSettings({ activeWorkspaceId: items[0]?.id ?? null });
    },

    async files(id) {
      return listFolder(folderOf(mustGet(id)));
    },

    outputDir(id) {
      const folder = folderOf(mustGet(id));
      const dir = join(folder, OUTPUT_DIR_NAME);
      mkdirSync(dir, { recursive: true });
      // A pre-existing link named "NONON Output" must not redirect our writes out of the workspace.
      if (!isReallyInside(folder, dir)) throw new UserError("The NONON Output folder points outside this project, so NONON will not write there.");
      return dir;
    },

    assertInside(id, path) {
      const folder = folderOf(mustGet(id));
      if (!isReallyInside(folder, path)) {
        throw new UserError("That file is outside this project's folder, so NONON will not touch it.");
      }
    },

    async addSamples(id) {
      const ws = mustGet(id);
      const folder = folderOf(ws);
      const samplesRoot = join(ctx.paths.resourcesDir, "samples");
      const target = join(folder, "Samples");
      if (!isReallyInside(folder, target)) throw new UserError("The Samples folder points outside this project, so NONON will not write there.");
      // Pack first so its files win a name clash with the shared general samples.
      const sources = ws.pack === "general" ? ["general"] : [ws.pack, "general"];
      for (const pack of sources) copyTreeNoOverwrite(join(samplesRoot, pack), target);
      if (!existsSync(target)) return [];
      return (await listFolder(folder)).filter((e) => isInside(target, e.path));
    },
  };
  return svc;
}
