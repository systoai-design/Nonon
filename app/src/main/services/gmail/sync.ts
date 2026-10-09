import type { GmailApi } from "./api";
import type { CacheFile } from "./cache";
import { isGmailError } from "./errors";
import { parseMessage, type CachedMessage } from "./parse";

export const DEFAULT_LOOKBACK_DAYS = 2;
export const MAX_LOOKBACK_DAYS = 14;
export const MAX_BRIEF_MESSAGES = 50;
const FETCH_CONCURRENCY = 5;
const MAX_INCREMENTAL_FETCH = 100;
/** Gmail keeps history for about a week; past this age a full sync is cheaper than a probable 404. */
const MAX_HISTORY_AGE_MS = 5 * 86_400_000;

export interface SyncOutcome {
  cache: CacheFile;
  mode: "full" | "incremental";
  added: number;
  skipped: number;
  /** More mail matched than one sync will fetch. */
  truncated: boolean;
}

export interface SyncInput {
  api: GmailApi;
  cache: CacheFile;
  nowMs: number;
  lookbackDays: number;
  signal?: AbortSignal;
  log?: (line: string) => void;
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

/** An offline or sign-in failure must abort the whole sync; a single odd message must not. */
async function fetchMessages(api: GmailApi, ids: string[], signal: AbortSignal | undefined): Promise<{ messages: CachedMessage[]; skipped: number }> {
  let skipped = 0;
  const fetched = await pool(ids, FETCH_CONCURRENCY, async (id) => {
    try {
      const raw = await api.getMessage(id, signal);
      return raw ? parseMessage(raw) : null;
    } catch (e) {
      if (isGmailError(e, "offline") || isGmailError(e, "needs-reconnect") || signal?.aborted) throw e;
      skipped++;
      return null;
    }
  });
  return { messages: fetched.filter((m): m is CachedMessage => m !== null), skipped };
}

async function fullSync(input: SyncInput): Promise<SyncOutcome> {
  const { api, cache, signal } = input;
  const profile = await api.profile(signal);
  const q = `newer_than:${input.lookbackDays}d`;

  const ids: string[] = [];
  let pageToken: string | undefined;
  let truncated = false;
  do {
    const page = await api.listMessages({ q, maxResults: MAX_BRIEF_MESSAGES - ids.length, pageToken }, signal);
    ids.push(...page.ids);
    pageToken = page.nextPageToken;
    if (ids.length >= MAX_BRIEF_MESSAGES) {
      truncated = Boolean(pageToken);
      break;
    }
  } while (pageToken);

  const known = new Map(cache.messages.map((m) => [m.id, m]));
  const toFetch = ids.filter((id) => !known.has(id));
  const { messages: fresh, skipped } = await fetchMessages(api, toFetch, signal);
  const freshById = new Map(fresh.map((m) => [m.id, m]));
  const messages = ids.map((id) => known.get(id) ?? freshById.get(id)).filter((m): m is CachedMessage => Boolean(m));

  return {
    cache: {
      ...cache,
      account: profile.emailAddress || cache.account,
      historyId: profile.historyId,
      coverageDays: input.lookbackDays,
      lastSyncAt: new Date(input.nowMs).toISOString(),
      messages,
    },
    mode: "full",
    added: fresh.length,
    skipped,
    truncated,
  };
}

async function incrementalSync(input: SyncInput): Promise<SyncOutcome> {
  const { api, cache, signal } = input;
  const added = new Set<string>();
  const deleted = new Set<string>();
  let historyId = cache.historyId as string;
  let pageToken: string | undefined;
  do {
    const page = await api.listHistory(cache.historyId as string, pageToken, signal);
    page.added.forEach((id) => added.add(id));
    page.deleted.forEach((id) => deleted.add(id));
    if (page.historyId) historyId = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);

  const known = new Set(cache.messages.map((m) => m.id));
  const wanted = [...added].filter((id) => !known.has(id) && !deleted.has(id));
  const truncated = wanted.length > MAX_INCREMENTAL_FETCH;
  const { messages: fresh, skipped } = await fetchMessages(api, wanted.slice(0, MAX_INCREMENTAL_FETCH), signal);

  const kept = cache.messages.filter((m) => !deleted.has(m.id));
  return {
    cache: { ...cache, historyId, lastSyncAt: new Date(input.nowMs).toISOString(), messages: [...kept, ...fresh] },
    mode: "incremental",
    added: fresh.length,
    skipped,
    truncated,
  };
}

export async function syncMailbox(input: SyncInput): Promise<SyncOutcome> {
  const { cache } = input;
  const age = cache.lastSyncAt ? input.nowMs - Date.parse(cache.lastSyncAt) : Infinity;
  const canResume = Boolean(cache.historyId) && age < MAX_HISTORY_AGE_MS && (cache.coverageDays ?? 0) >= input.lookbackDays;
  if (canResume) {
    try {
      return await incrementalSync(input);
    } catch (e) {
      if (!isGmailError(e) || e.status !== 404) throw e;
      input.log?.("gmail: saved mailbox position expired, doing a full sync");
    }
  }
  return await fullSync(input);
}
