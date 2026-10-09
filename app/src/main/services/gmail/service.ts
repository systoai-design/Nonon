import type { BriefItem, EmailBrief, GmailStatus } from "../../../shared/contracts";
import type { AppCtx, GmailService } from "../types";
import { createGmailApi, type AccessTokens } from "./api";
import { analyseMessages, overviewLine, type Analysis } from "./analyze";
import { deleteCache, loadCache, saveCache, type CacheFile } from "./cache";
import {
  GOOGLE_ENDPOINTS,
  READ_ONLY_NOTE,
  configHint,
  loadClientConfig,
  type ClientConfig,
  type Endpoints,
} from "./config";
import { GmailError, isGmailError } from "./errors";
import type { FetchLike } from "./net";
import { authorizeWithBrowser, exchangeCode, refreshAccess, revokeToken } from "./oauth";
import type { CachedMessage } from "./parse";
import { DEFAULT_LOOKBACK_DAYS, MAX_BRIEF_MESSAGES, MAX_LOOKBACK_DAYS, syncMailbox } from "./sync";
import { createTokenVault, type SecretStore } from "./vault";

export interface GmailDeps {
  /** Opens the system browser. Production passes Electron's shell.openExternal. */
  openExternal: (url: string) => Promise<void>;
  /** Production passes Electron's safeStorage. */
  secrets: SecretStore;
  fetch?: FetchLike;
  endpoints?: Endpoints;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  authTimeoutMs?: number;
  /** Test hook: shortens the retry wait. */
  baseDelayMs?: number;
}

export const NO_SAVED_MAIL = "No saved email yet. Connect to the internet once so NONON can get your email.";

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const PRIORITY_RANK: Record<BriefItem["priority"], number> = { "needs-attention": 0, fyi: 1, low: 2 };

export const mailLink = (threadId: string): string => `https://mail.google.com/mail/u/0/#inbox/${threadId}`;

export function createGmailService(ctx: AppCtx, deps: GmailDeps): GmailService {
  const fetchFn: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const endpoints = deps.endpoints ?? GOOGLE_ENDPOINTS;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const dataDir = ctx.paths.dataDir;
  const vault = createTokenVault(dataDir, deps.secrets);

  let access: { token: string; expiresAt: number } | null = null;
  let lastError: string | undefined;
  let lastNote: string | undefined;
  let refreshing: Promise<string> | null = null;
  let connecting: Promise<GmailStatus> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const config = (): ClientConfig | null => loadClientConfig(dataDir, deps.env);

  function requireConfig(): ClientConfig {
    const cfg = config();
    if (!cfg) throw new GmailError("not-configured", configHint(dataDir));
    return cfg;
  }

  async function refreshAccessToken(signal?: AbortSignal): Promise<string> {
    const stored = vault.load();
    if (!stored) throw new GmailError("not-connected", "Gmail is not connected. Open the email settings in NONON and choose Connect Gmail.");
    try {
      const grant = await refreshAccess(fetchFn, requireConfig(), endpoints, stored.refreshToken, now(), signal);
      access = { token: grant.accessToken, expiresAt: grant.expiresAt };
      if (grant.refreshToken && grant.refreshToken !== stored.refreshToken) vault.save({ ...stored, refreshToken: grant.refreshToken });
      return grant.accessToken;
    } catch (e) {
      access = null;
      if (isGmailError(e, "needs-reconnect")) {
        vault.clear();
        lastError = e.message;
      }
      throw e;
    }
  }

  const tokens: AccessTokens = {
    async token(signal) {
      if (access && access.expiresAt > now()) return access.token;
      refreshing ??= refreshAccessToken(signal).finally(() => {
        refreshing = null;
      });
      return await refreshing;
    },
    async refresh(signal) {
      access = null;
      refreshing ??= refreshAccessToken(signal).finally(() => {
        refreshing = null;
      });
      return await refreshing;
    },
  };

  const api = () =>
    createGmailApi({
      apiBase: endpoints.api,
      fetch: fetchFn,
      tokens,
      sleep,
      baseDelayMs: deps.baseDelayMs,
      log: (line) => ctx.log(line),
    });

  function status(): GmailStatus {
    const cache = loadCache(ctx.store);
    const base = { cachedMessages: cache.messages.length, ...(cache.lastSyncAt ? { lastSyncAt: cache.lastSyncAt } : {}) };
    if (!config()) return { ...base, state: "not-configured", configHint: configHint(dataDir), scopes: [], detail: READ_ONLY_NOTE };

    const stored = vault.load();
    if (stored) {
      return {
        ...base,
        state: "connected",
        ...(cache.account || stored.account ? { account: cache.account ?? stored.account } : {}),
        scopes: stored.scopes,
        detail: lastNote ? `${READ_ONLY_NOTE} ${lastNote}` : READ_ONLY_NOTE,
      };
    }
    if (vault.exists()) {
      return { ...base, state: "error", scopes: [], detail: "NONON cannot read your saved Gmail sign-in on this computer. Connect Gmail again." };
    }
    if (lastError) return { ...base, state: "error", scopes: [], detail: lastError };
    return { ...base, state: "disconnected", scopes: [], detail: lastNote ? `${READ_ONLY_NOTE} ${lastNote}` : READ_ONLY_NOTE };
  }

  async function doConnect(): Promise<GmailStatus> {
    lastError = undefined;
    lastNote = undefined;
    try {
      const cfg = config();
      if (!cfg) return status();
      if (!deps.secrets.isEncryptionAvailable()) {
        throw new GmailError("storage", "This computer cannot protect saved sign-ins, so NONON did not connect Gmail. Nothing was saved.");
      }
      const auth = await authorizeWithBrowser({ config: cfg, endpoints, openExternal: deps.openExternal, timeoutMs: deps.authTimeoutMs });
      const grant = await exchangeCode(fetchFn, cfg, endpoints, auth, now());
      access = { token: grant.accessToken, expiresAt: grant.expiresAt };

      const profile = await api().profile();
      const cache = loadCache(ctx.store);
      // A different mailbox must never see the previous one's saved mail.
      if (cache.account && profile.emailAddress && cache.account !== profile.emailAddress) deleteCache(ctx.store);
      vault.save({ refreshToken: grant.refreshToken as string, scopes: grant.scopes, account: profile.emailAddress });
      const kept = loadCache(ctx.store);
      saveCache(ctx.store, { ...kept, account: profile.emailAddress }, now());
      ctx.log(`gmail: connected (${profile.emailAddress ? "account read" : "no account"})`);
    } catch (e) {
      access = null;
      lastError = isGmailError(e) ? e.message : "Gmail could not be connected. Nothing was changed. Please try again.";
      ctx.log(`gmail: connect failed (${isGmailError(e) ? e.code : "unexpected"})`);
    }
    return status();
  }

  async function disconnect(): Promise<GmailStatus> {
    const stored = vault.load();
    let revoked = true;
    if (stored) revoked = await revokeToken(fetchFn, endpoints, stored.refreshToken);
    vault.clear();
    deleteCache(ctx.store);
    access = null;
    lastError = undefined;
    lastNote = revoked
      ? "Gmail is disconnected. The saved email was removed from this computer."
      : "Gmail is disconnected and the saved email was removed. But NONON could not reach Google to cancel its permission. You can remove NONON yourself at myaccount.google.com/permissions.";
    ctx.log(`gmail: disconnected (revoked=${revoked})`);
    return status();
  }

  async function refreshCache(lookbackDays: number, signal?: AbortSignal): Promise<{ cache: CacheFile; notes: string[]; fresh: boolean }> {
    const cache = loadCache(ctx.store);
    const notes: string[] = [];
    requireConfig();
    if (!vault.load()) {
      throw new GmailError(
        vault.exists() ? "needs-reconnect" : "not-connected",
        vault.exists() ? "NONON cannot read your saved Gmail sign-in. Connect Gmail again." : "Gmail is not connected. Open the email settings in NONON and choose Connect Gmail.",
      );
    }
    try {
      const out = await syncMailbox({ api: api(), cache, nowMs: now(), lookbackDays, signal, log: (l) => ctx.log(l) });
      const saved = saveCache(ctx.store, out.cache, now());
      if (out.skipped > 0) notes.push(`${plural(out.skipped, "email")} could not be downloaded and ${out.skipped === 1 ? "was" : "were"} left out.`);
      if (out.truncated) notes.push(`More than ${MAX_BRIEF_MESSAGES} emails matched. This summary covers the newest ones.`);
      return { cache: saved, notes, fresh: true };
    } catch (e) {
      const recoverable = isGmailError(e, "offline") || (isGmailError(e, "api") && (e.status === undefined || e.status === 429 || e.status >= 500));
      if (!recoverable) throw e;
      if (!cache.lastSyncAt) throw new GmailError("no-cache", NO_SAVED_MAIL);
      notes.push(isGmailError(e, "offline") ? "NONON could not reach Google, so this uses email saved earlier." : "Google was busy, so this uses email saved earlier.");
      return { cache, notes, fresh: false };
    }
  }

  function windowOf(cache: CacheFile, fresh: boolean, lookbackDays: number): CachedMessage[] {
    const anchor = fresh || !cache.lastSyncAt ? now() : Date.parse(cache.lastSyncAt);
    const from = anchor - lookbackDays * 86_400_000;
    return cache.messages
      .filter((m) => Date.parse(m.receivedAt) >= from)
      .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
      .slice(0, MAX_BRIEF_MESSAGES);
  }

  function compose(
    messages: CachedMessage[],
    analyses: Analysis[],
    overview: string | undefined,
    cache: CacheFile,
    fresh: boolean,
    lookbackDays: number,
    notes: string[],
  ): EmailBrief {
    const items: BriefItem[] = messages.map((m, i) => {
      const a = analyses[i] as Analysis;
      const item: BriefItem = {
        messageId: m.id,
        threadId: m.threadId,
        from: m.from,
        subject: m.subject,
        receivedAt: m.receivedAt,
        link: mailLink(m.threadId),
        priority: a.priority,
        why: a.why,
      };
      if (a.deadline) item.deadline = a.deadline;
      if (a.draftReply) item.draftReply = a.draftReply;
      return item;
    });
    items.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || Date.parse(b.receivedAt) - Date.parse(a.receivedAt));

    const count = (p: BriefItem["priority"]) => items.filter((i) => i.priority === p).length;
    const span = lookbackDays === 1 ? "the last day" : `the last ${lookbackDays} days`;
    const unreadable = analyses.filter((a) => !a.analysed).length;
    if (unreadable > 0) notes.push(`${plural(unreadable, "email")} could not be read automatically. Open ${unreadable === 1 ? "it" : "them"} in Gmail to check.`);

    const lead =
      items.length === 0
        ? `No emails from ${span}.`
        : `${plural(items.length, "email")} from ${span}: ${count("needs-attention")} need attention, ${count("fyi")} good to know, ${count("low")} can wait.`;
    const where = fresh ? "Checked Gmail just now." : `Saved copy from ${formatWhen(cache.lastSyncAt as string)}. This is not a current check of your inbox.`;
    return {
      generatedAt: new Date(now()).toISOString(),
      freshness: fresh ? "fresh" : "cached",
      lastSyncAt: cache.lastSyncAt ?? null,
      items,
      summary: [where, lead, overview].filter(Boolean).join(" "),
      ...(notes.length > 0 ? { notes } : {}),
    };
  }

  async function brief(workspaceId: string, opts: Parameters<GmailService["brief"]>[1] = {}): Promise<EmailBrief> {
    const workspace = ctx.svc.workspaces.get(workspaceId);
    if (!workspace) throw new GmailError("policy", "That project could not be found.");
    const ai = opts.ai ?? ctx.svc.runtime.client();
    if (workspace.policy === "local-only" && ai.location.ai !== "local") {
      throw new GmailError("policy", "This project keeps everything on this computer, so your email cannot be sent to an online AI like Claude. Nothing was sent.");
    }
    const lookbackDays = Math.min(MAX_LOOKBACK_DAYS, Math.max(1, Math.floor(opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS)));

    let cache: CacheFile;
    let fresh: boolean;
    let notes: string[];
    if (opts.forceOffline) {
      cache = loadCache(ctx.store);
      if (!cache.lastSyncAt) throw new GmailError("no-cache", NO_SAVED_MAIL);
      fresh = false;
      notes = ["You asked to work without the internet, so this uses email saved earlier."];
    } else {
      ({ cache, fresh, notes } = await refreshCache(lookbackDays, opts.signal));
    }

    const messages = windowOf(cache, fresh, lookbackDays);
    const analyses = messages.length > 0 ? await analyseMessages(messages, ai, { signal: opts.signal }) : [];
    const overview =
      messages.length > 0
        ? await overviewLine(
            messages.map((m, i) => ({ subject: m.subject, priority: (analyses[i] as Analysis).priority, why: (analyses[i] as Analysis).why, flagged: (analyses[i] as Analysis).flagged })),
            ai,
            opts.signal,
          )
        : undefined;
    return compose(messages, analyses, overview, cache, fresh, lookbackDays, notes);
  }

  // Briefs share one cache file, so they run one at a time.
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    status,
    connect() {
      connecting ??= doConnect().finally(() => {
        connecting = null;
      });
      return connecting;
    },
    disconnect: () => serial(disconnect),
    brief: (workspaceId, opts) => serial(() => brief(workspaceId, opts)),
  };
}
