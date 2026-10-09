import { app, BrowserWindow, Menu, nativeImage, powerMonitor, Tray } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppCtx } from "./services/types";
import type { SchedulerHandle } from "./services/scheduler";

export interface BackgroundHandle {
  /** Call for every window the app creates, so closing it hides it while background routines are on. */
  attachWindow(win: BrowserWindow): void;
  /** For `window-all-closed`: true when the app should quit now. */
  shouldQuitWhenWindowsClosed(): boolean;
  /** For `before-quit`: lets windows really close and removes the tray icon. */
  prepareToQuit(): void;
  /** Re-reads settings.backgroundRoutines; called automatically when settings change through ctx.updateSettings. */
  refresh(): void;
}

/** Non's face from resources/tray: 16 px for normal screens with the 32 px copy for high-density ones. A missing file leaves an empty icon rather than stopping the app. */
function trayImage(resourcesDir: string): Electron.NativeImage {
  const dir = join(resourcesDir, "tray");
  const image = nativeImage.createFromPath(join(dir, "tray-16.png"));
  try {
    image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(join(dir, "tray-32.png")) });
  } catch {
    /* the 16 px image alone still works */
  }
  return image;
}

/**
 * Opt-in background mode. Not unit tested: it needs a running Electron main process, so it is checked by hand.
 * The login item is registered only while the user has switched background routines on, and removed when they switch it off.
 */
export function enableBackground(ctx: AppCtx, deps: { getWindow: () => BrowserWindow | null }): BackgroundHandle {
  let tray: Tray | null = null;
  let quitting = false;
  const attached = new WeakSet<BrowserWindow>();

  const keepAlive = () => ctx.getSettings().backgroundRoutines && !quitting;

  function openWindow(): void {
    const win = deps.getWindow();
    if (!win || win.isDestroyed()) {
      // index.ts recreates the window on "activate".
      app.emit("activate");
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  function quitForReal(): void {
    quitting = true;
    app.quit();
  }

  function ensureTray(): void {
    if (tray) return;
    tray = new Tray(trayImage(ctx.paths.resourcesDir));
    tray.setToolTip("NONON: routines are on. This computer needs to stay on and awake for them to run.");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open NONON", click: openWindow },
        { label: "Routines are on", enabled: false },
        { type: "separator" },
        { label: "Quit", click: quitForReal },
      ]),
    );
    tray.on("click", openWindow);
  }

  function removeTray(): void {
    tray?.destroy();
    tray = null;
  }

  function applyLoginItem(enabled: boolean): void {
    // A dev run would register electron.exe itself as a login item.
    if (!app.isPackaged) return;
    // macOS refuses (and logs an error) when asked to remove a login item that was never added.
    if (app.getLoginItemSettings().openAtLogin === enabled) return;
    try {
      app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: enabled ? ["--hidden"] : [] });
    } catch (e) {
      ctx.log(`login item not changed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function refresh(): void {
    if (ctx.getSettings().backgroundRoutines && !quitting) {
      ensureTray();
      applyLoginItem(true);
    } else {
      removeTray();
      applyLoginItem(false);
    }
  }

  function attachWindow(win: BrowserWindow): void {
    if (attached.has(win)) return;
    attached.add(win);
    win.on("close", (event) => {
      if (!keepAlive()) return;
      event.preventDefault();
      win.hide();
    });
  }

  const original = ctx.updateSettings;
  ctx.updateSettings = (patch) => {
    const next = original(patch);
    if ("backgroundRoutines" in patch) refresh();
    return next;
  };

  const checkSoon = () => {
    void (ctx.svc.scheduler as Partial<SchedulerHandle>).checkNow?.().catch((e: unknown) => {
      ctx.log(`scheduler: wake check failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  };
  powerMonitor.on("resume", checkSoon);
  powerMonitor.on("unlock-screen", checkSoon);

  const current = deps.getWindow();
  if (current) attachWindow(current);
  refresh();

  return {
    attachWindow,
    shouldQuitWhenWindowsClosed: () => !keepAlive(),
    prepareToQuit() {
      quitting = true;
      removeTray();
    },
    refresh,
  };
}
