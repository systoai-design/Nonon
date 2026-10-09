import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { AppState } from "../shared/contracts";
import type { ChannelName, Channels } from "../shared/ipc";
import { BadRequest, parseArg } from "./ipc-schema";
import { mayReveal, resolveOpenable } from "./shell-guard";
import { previewOutput } from "./services/outputs";
import type { AppCtx } from "./services/types";
import { applyUiScale } from "./view-scale";

type Handlers = { [K in ChannelName]: (arg: Channels[K]["arg"]) => Promise<Channels[K]["res"]> | Channels[K]["res"] };

/** `isTrustedPage` says whether a frame URL is the app's own page; anything else that gets a script running cannot call in. */
export function registerIpc(ctx: AppCtx, getWindow: () => BrowserWindow | null, version: string, isTrustedPage: (url: string) => boolean): void {
  const { svc } = ctx;

  const handlers: Handlers = {
    "app:state": () => {
      const state: AppState = {
        settings: ctx.getSettings(),
        workspaces: svc.workspaces.list(),
        runtime: svc.runtime.status(),
        hardware: svc.hardware.last(),
        providers: svc.providers.list(),
        gmail: svc.gmail.status(),
        version,
        platform: process.platform,
      };
      return state;
    },
    "settings:update": (patch) => {
      const next = ctx.updateSettings(patch);
      if (patch.uiScale !== undefined) applyUiScale(getWindow(), next.uiScale);
      return next;
    },
    "shell:reveal": ({ path }) => {
      if (mayReveal(svc.workspaces, ctx.paths.dataDir, path)) shell.showItemInFolder(path);
    },
    "shell:open": async ({ path }) => {
      const err = await shell.openPath(await resolveOpenable(svc.workspaces, path));
      if (err) throw new Error(err);
    },
    "output:preview": ({ path, maxRows }) => previewOutput(svc.workspaces, path, maxRows),

    "workspace:create": (input) => svc.workspaces.create(input),
    "workspace:update": ({ id, patch }) => svc.workspaces.update(id, patch),
    "workspace:remove": ({ id }) => svc.workspaces.remove(id),
    "workspace:pick-folder": async () => {
      const win = getWindow();
      const opts = {
        properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[],
        title: "Choose a folder NONON may work in",
      };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return res.canceled ? null : (res.filePaths[0] ?? null);
    },
    "workspace:files": ({ id }) => svc.workspaces.files(id),
    "workspace:pick-files": async ({ accept }) => {
      const win = getWindow();
      const filters = accept?.length ? [{ name: "Supported files", extensions: accept.map((e) => e.replace(/^\./, "")) }] : undefined;
      const opts = { properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[], filters };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return res.canceled ? [] : res.filePaths;
    },
    "workspace:add-samples": ({ id }) => svc.workspaces.addSamples(id),

    "hardware:assess": () => svc.hardware.assess(),
    "runtime:status": () => svc.runtime.status(),
    "runtime:install": ({ modelId }) => {
      ctx.updateSettings({ modelId });
      void svc.runtime.install(modelId).catch((e) => ctx.log(`runtime install failed: ${String(e)}`));
    },
    "runtime:cancel": () => svc.runtime.cancel(),
    "runtime:start": () => svc.runtime.start(),
    "runtime:stop": () => svc.runtime.stop(),

    "procedure:list": ({ pack }) => svc.procedures.list(pack).map(({ run: _run, ...info }) => info),
    "task:list": ({ workspaceId }) => svc.tasks.list(workspaceId),
    "task:get": ({ id }) => svc.tasks.get(id) ?? null,
    "task:start": (input) => svc.tasks.start(input),
    "task:answer": ({ id, answers, remember }) => svc.tasks.answer(id, answers, remember),
    "task:stop": ({ id }) => svc.tasks.stop(id),
    "task:resume": ({ id }) => svc.tasks.resume(id),

    "chat:history": ({ workspaceId }) => svc.chat.history(workspaceId),
    "chat:send": ({ workspaceId, text, files }) => svc.chat.send(workspaceId, text, files),
    "chat:stop": ({ workspaceId }) => svc.chat.stop(workspaceId),

    "change:list": (filter) => svc.changes.list(filter),
    "change:apply": ({ id }) => svc.changes.apply(id),
    "change:reject": ({ id }) => svc.changes.reject(id),
    "change:recover": ({ id }) => svc.changes.recover(id),

    "routine:list": ({ workspaceId }) => svc.scheduler.list(workspaceId),
    "routine:propose": ({ workspaceId, text }) => svc.scheduler.propose(workspaceId, text),
    "routine:save": ({ routine }) => svc.scheduler.save(routine),
    "routine:set-enabled": ({ id, enabled }) => svc.scheduler.setEnabled(id, enabled),
    "routine:run-now": ({ id }) => svc.scheduler.runNow(id),
    "routine:remove": ({ id }) => svc.scheduler.remove(id),
    "routine:runs": ({ routineId, limit }) => svc.scheduler.runs(routineId, limit),

    "gmail:status": () => svc.gmail.status(),
    "gmail:connect": () => svc.gmail.connect(),
    "gmail:disconnect": () => svc.gmail.disconnect(),
    "gmail:brief": ({ workspaceId, forceOffline }) => svc.gmail.brief(workspaceId, { forceOffline }),

    "provider:list": () => svc.providers.list(),
    "provider:probe": ({ id }) => svc.providers.probe(id),
    "provider:sign-in": ({ id }) => svc.providers.signIn(id),
    "roles:get": ({ workspaceId }) => svc.providers.roles(workspaceId),
    "roles:set": ({ workspaceId, role, provider }) => svc.providers.setRole(workspaceId, role, provider),

    "lan:status": () => svc.lan.status(),
    "lan:host-start": () => svc.lan.startHost(),
    "lan:host-stop": () => svc.lan.stopHost(),
    "lan:pairing-code": () => svc.lan.createPairingCode(),
    "lan:approve": ({ requestId }) => svc.lan.approve(requestId),
    "lan:deny": ({ requestId }) => svc.lan.deny(requestId),
    "lan:revoke": ({ deviceId }) => svc.lan.revoke(deviceId),
    "lan:pair": ({ pairing, deviceName }) => svc.lan.pair(pairing, deviceName),
    "lan:client-status": () => svc.lan.clientStatus(),
    "lan:unpair": () => svc.lan.unpair(),

    "diagnostics:snapshot": () => ({
      runtime: svc.runtime.status(),
      hardware: svc.hardware.last(),
      log: ctx.recentLog().slice(-200),
    }),
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, raw) => {
      try {
        const frame = event.senderFrame;
        if (!frame || frame !== event.sender.mainFrame || !isTrustedPage(frame.url)) {
          ctx.log(`ipc ${channel} refused: caller is not the app window`);
          throw new BadRequest();
        }
        return await (handler as (a: unknown) => unknown)(parseArg(channel, raw));
      } catch (e) {
        ctx.log(`ipc ${channel} failed: ${e instanceof Error ? e.message : String(e)}`);
        throw e instanceof Error ? e : new Error(String(e));
      }
    });
  }
}
