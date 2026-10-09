import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * Pure decisions about which pages and addresses the window may touch. Kept free of Electron imports so tests can
 * run them; `index.ts` wires them into the real window and session.
 */

const winLike = process.platform === "win32" || process.platform === "darwin";
const norm = (s: string): string => (winLike ? s.toLowerCase() : s);

/** Origin of the dev server when running `electron-vite dev`; undefined in a real install. */
export function devOrigin(rendererUrl: string | undefined): string | undefined {
  if (!rendererUrl) return undefined;
  try {
    const u = new URL(rendererUrl);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1") ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

/** True only for the app's own page: the bundled index.html (any hash or query) or the dev server's origin. */
export function isAppPage(url: string, indexHtmlPath: string, dev: string | undefined): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (dev && u.origin === dev) return true;
  if (u.protocol !== "file:") return false;
  try {
    return norm(resolve(fileURLToPath(u))) === norm(resolve(indexHtmlPath));
  } catch {
    return false;
  }
}

/** Requests the window itself may make. Everything that leaves the computer is refused; the app talks to main over IPC. */
export function isAllowedWindowRequest(url: string, dev: string | undefined): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  switch (u.protocol) {
    case "file:":
    case "data:":
    case "blob:":
    case "devtools:":
      return true;
    case "http:":
    case "ws:":
      return dev !== undefined && u.host === new URL(dev).host;
    default:
      return false;
  }
}

/** Links the window may hand to the system browser: plain https, no embedded sign-in, sensible length. */
export function isSafeExternalUrl(url: string): boolean {
  if (url.length > 2048) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.username === "" && u.password === "" && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Permissions the window may use. Writing to the clipboard on a click is the only one it needs. */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(["clipboard-sanitized-write"]);

/**
 * Chromium switches set before the app is ready. A measured run showed Chromium, with nothing asked of it, looking for a
 * proxy script on start-up: a DHCP query, a name lookup for "wpad" on the local network, and an IPv6 route probe, repeated
 * every few seconds. The window makes no network requests, so it needs no proxy and no name resolution beyond this computer.
 * Downloads, Gmail and the paired computer use the main process, which these switches do not touch.
 */
export const PRIVACY_SWITCHES: ReadonlyArray<readonly [string, string?]> = [
  ["no-proxy-server"],
  ["disable-background-networking"],
  ["disable-component-update"],
  ["disable-domain-reliability"],
  ["no-pings"],
  ["host-resolver-rules", "MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1"],
];
