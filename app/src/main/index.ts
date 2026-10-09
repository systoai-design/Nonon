import { app, BrowserWindow, Notification, screen, session, shell } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Events } from "../shared/ipc";
import { createApp } from "./app";
import { enableBackground, type BackgroundHandle } from "./background";
import { ALLOWED_PERMISSIONS, PRIVACY_SWITCHES, devOrigin, isAllowedWindowRequest, isAppPage, isSafeExternalUrl } from "./hardening";
import { registerIpc } from "./ipc";
import { fitToWorkArea, installAppMenu, windowFrameOptions } from "./window-chrome";
import { attachViewScale } from "./view-scale";
import type { SchedulerHandle } from "./services/scheduler";
import type { AppCtx } from "./services/types";

for (const [name, value] of PRIVACY_SWITCHES) {
  if (value === undefined) app.commandLine.appendSwitch(name);
  else app.commandLine.appendSwitch(name, value);
}

const ICON = join(__dirname, "../../build/icon.png");
const INDEX_HTML = join(__dirname, "../renderer/index.html");
// A real install never loads a page from a server, whatever the environment says.
const DEV = app.isPackaged ? undefined : devOrigin(process.env.ELECTRON_RENDERER_URL);
let win: BrowserWindow | null = null;
let background: BackgroundHandle | null = null;
let appCtx: AppCtx | null = null;

function emit<K extends keyof Events>(event: K, payload: Events[K]): void {
  if (win && !win.isDestroyed()) win.webContents.send(`evt:${event}`, payload);
}

function createWindow(startHidden = false): BrowserWindow {
  const size = fitToWorkArea(screen.getPrimaryDisplay().workAreaSize);
  const w = new BrowserWindow({
    ...size,
    show: !startHidden,
    backgroundColor: "#fafafa",
    autoHideMenuBar: true,
    title: "NONON",
    ...(existsSync(ICON) ? { icon: ICON } : {}),
    ...windowFrameOptions(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload only needs ipcRenderer, contextBridge and webUtils, all of which a sandboxed preload has.
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  background?.attachWindow(w);
  if (appCtx) {
    const c = appCtx;
    attachViewScale(w, () => c.getSettings().uiScale, (scale) => void c.updateSettings({ uiScale: scale }));
  }
  if (DEV) void w.loadURL(DEV);
  else void w.loadFile(INDEX_HTML);
  return w;
}

/**
 * The window only ever shows NONON's own page. It cannot navigate away, open windows, attach webviews, ask for
 * device permissions, or make a network request; links go to the system browser as plain https and nothing else.
 */
function hardenWebContents(): void {
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (e) => e.preventDefault());
    contents.on("will-navigate", (e, url) => {
      if (!isAppPage(url, INDEX_HTML, DEV)) e.preventDefault();
    });
    contents.on("will-redirect", (e, url) => {
      if (!isAppPage(url, INDEX_HTML, DEV)) e.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
  });
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, done) => done(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  ses.webRequest.onBeforeRequest((details, done) => done({ cancel: !isAllowedWindowRequest(details.url, DEV) }));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win || win.isDestroyed()) win = createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  void app.whenReady().then(() => {
    hardenWebContents();
    const ctx = createApp(emit);
    appCtx = ctx;
    installAppMenu();
    registerIpc(ctx, () => win, app.getVersion(), (url) => isAppPage(url, INDEX_HTML, DEV));
    background = enableBackground(ctx, { getWindow: () => win });
    win = createWindow(process.argv.includes("--hidden") && ctx.getSettings().backgroundRoutines);
    ctx.log(`NONON ${app.getVersion()} started on ${process.platform}/${process.arch}`);

    // Local notifications only: nothing here ever sends anything off this computer.
    (ctx.svc.scheduler as SchedulerHandle).setNotify?.((n) => {
      if (!Notification.isSupported()) return;
      const note = new Notification({ title: n.title, body: n.body });
      note.on("click", () => {
        if (!win || win.isDestroyed()) win = createWindow();
        win.show();
        win.focus();
      });
      note.show();
    });

    try {
      ctx.svc.tasks.recoverInterrupted();
      ctx.svc.scheduler.start();
    } catch (e) {
      ctx.log(`startup services not ready: ${e instanceof Error ? e.message : String(e)}`);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) win = createWindow();
      else win?.show();
    });
    app.on("before-quit", () => {
      background?.prepareToQuit();
      ctx.svc.scheduler.stop();
      void Promise.resolve()
        .then(() => ctx.svc.runtime.stop())
        .catch(() => undefined);
    });
  });

  app.on("window-all-closed", () => {
    if (background ? background.shouldQuitWhenWindowsClosed() : process.platform !== "darwin") app.quit();
  });
}
