import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";

/**
 * The window frame is NONON's own, not Electron's default (no File / Edit / View / Window bar, no grey caption).
 * Windows paints only the three caption buttons, over a strip the page draws; the strip colour in the renderer
 * (`--chrome` in styles.css) MUST equal `color` here, and its height MUST equal `height`.
 */
export const WINDOW_CHROME = { color: "#fafafa", symbolColor: "#111111", height: 40 } as const;

export function windowFrameOptions(): Electron.BrowserWindowConstructorOptions {
  if (process.platform === "darwin") {
    return { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 13 } };
  }
  if (process.platform === "win32") {
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: { color: WINDOW_CHROME.color, symbolColor: WINDOW_CHROME.symbolColor, height: WINDOW_CHROME.height },
    };
  }
  return {};
}

/** No menu bar on Windows and Linux (text fields keep their own copy and paste); a small native menu on macOS, which needs one. */
export function installAppMenu(): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: "NONON",
      submenu: [{ role: "about", label: "About NONON" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit", label: "Quit NONON" }],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  app.setAboutPanelOptions({ applicationName: "NONON", applicationVersion: app.getVersion(), copyright: "Free to use. Built for the AppBuildersPH Hackathon." });
}

/** Keeps the Windows caption buttons in step if the strip colour ever changes at runtime. */
export function applyChrome(win: BrowserWindow): void {
  if (process.platform === "win32" && !win.isDestroyed()) {
    try {
      win.setTitleBarOverlay({ color: WINDOW_CHROME.color, symbolColor: WINDOW_CHROME.symbolColor, height: WINDOW_CHROME.height });
    } catch {
      /* the window can close between the check and the call */
    }
  }
}
