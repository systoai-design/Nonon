import { existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, extname, join, resolve } from "node:path";

export type BinName = "claude" | "codex" | "agy";

/** A launchable program plus any fixed leading arguments (for example `node codex.js`). */
export interface ResolvedBin {
  command: string;
  prefixArgs: string[];
  /** Extra env the launch needs (ELECTRON_RUN_AS_NODE when only Electron's own node is available). */
  env?: Record<string, string>;
  /** Short name shown in plain errors. */
  display: string;
}

interface ResolveOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

const isWin = (p: NodeJS.Platform) => p === "win32";

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Where each official installer puts its program, beyond PATH. A GUI app on macOS starts with a bare PATH. */
export function extraDirs(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string[] {
  if (isWin(platform)) {
    const appData = env.APPDATA ?? join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [join(appData, "npm"), join(local, "agy", "bin"), join(home, ".local", "bin"), join(local, "Programs", "claude")];
  }
  return [
    join(home, ".local", "bin"),
    join(home, ".claude", "local"),
    join(home, ".npm-global", "bin"),
    join(home, ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ];
}

function pathDirs(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string[] {
  const raw = env.PATH ?? env.Path ?? "";
  const sep = isWin(platform) ? ";" : ":";
  const fromPath = raw.split(sep).filter(Boolean);
  return [...fromPath, ...extraDirs(platform, env, home)];
}

/** PATH value for child processes: the parent's PATH plus the known install folders. */
export function childPath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of pathDirs(platform, env, home)) {
    const key = isWin(platform) ? d.toLowerCase() : d;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out.join(isWin(platform) ? ";" : delimiter);
}

function findOnPath(name: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string | null {
  const exts = isWin(platform) ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathDirs(platform, env, home)) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function findNode(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): ResolvedBin {
  const node = findOnPath("node", platform, env, home);
  if (node) return { command: node, prefixArgs: [], display: "node" };
  return { command: process.execPath, prefixArgs: [], env: { ELECTRON_RUN_AS_NODE: "1" }, display: "node" };
}

/** npm's Windows .cmd shims only forward to a real .exe or a node script. Resolve that target so no shell is needed. */
function parseCmdShim(file: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): ResolvedBin | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const base = dirname(file);
  const exe = /"%dp0%\\?([^"]+?\.exe)"/i.exec(text);
  if (exe?.[1]) {
    const target = resolve(base, exe[1].replace(/\\/g, "/"));
    if (existsSync(target)) return { command: target, prefixArgs: [], display: "" };
  }
  const js = /"%dp0%\\?([^"]+?\.m?js)"/i.exec(text);
  if (js?.[1]) {
    const script = resolve(base, js[1].replace(/\\/g, "/"));
    if (existsSync(script)) {
      const node = findNode(platform, env, home);
      return { ...node, prefixArgs: [script], display: "" };
    }
  }
  return null;
}

/** Finds an installed official CLI without a shell. Null when it is not installed. */
export function resolveBin(name: BinName, opts: ResolveOptions = {}): ResolvedBin | null {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const home = opts.home ?? env.USERPROFILE ?? env.HOME ?? "";
  const file = findOnPath(name, platform, env, home);
  if (!file) return null;
  if (isWin(platform)) {
    const ext = extname(file).toLowerCase();
    if (ext === ".cmd" || ext === ".bat") {
      const direct = parseCmdShim(file, platform, env, home);
      if (!direct) return null;
      return { ...direct, display: name };
    }
  }
  return { command: file, prefixArgs: [], display: name };
}

const BASE_KEYS_WIN = [
  "SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
  "PROGRAMDATA", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "CommonProgramFiles", "TEMP", "TMP", "USERNAME", "USERDOMAIN",
  "COMPUTERNAME", "OS", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "LANG",
];
const BASE_KEYS_POSIX = ["HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"];
const NETWORK_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"];

/**
 * An allowlist, not a blocklist: the host app may carry another tool's session tokens, API keys or plugin switches,
 * and none of those belong in a connected-AI child process. `keep` adds the one variable a given vendor tool reads
 * to find its own config folder.
 */
export function buildChildEnv(keep: string[] = [], opts: ResolveOptions = {}): NodeJS.ProcessEnv {
  const platform = opts.platform ?? process.platform;
  const source = opts.env ?? process.env;
  const home = opts.home ?? source.USERPROFILE ?? source.HOME ?? "";
  const out: NodeJS.ProcessEnv = {};
  const keys = [...(isWin(platform) ? BASE_KEYS_WIN : BASE_KEYS_POSIX), ...NETWORK_KEYS, ...keep];
  for (const k of keys) {
    const v = source[k];
    if (v !== undefined) out[k] = v;
  }
  out.PATH = childPath(platform, source, home);
  out.NO_COLOR = "1";
  return out;
}
