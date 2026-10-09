import { rmSync } from "node:fs";
import type { JsonStore } from "../store";
import type { CachedMessage } from "./parse";

export const CACHE_FILE = "gmail-cache.json";
export const RETENTION_DAYS = 14;
export const MAX_CACHED = 200;

export interface CacheFile {
  version: 1;
  account?: string;
  /** ISO time of the last sync that finished. */
  lastSyncAt?: string;
  /** Gmail mailbox position for incremental sync. */
  historyId?: string;
  /** Days of inbox the last full sync covered. */
  coverageDays?: number;
  messages: CachedMessage[];
}

export const emptyCache = (): CacheFile => ({ version: 1, messages: [] });

/** Drops mail older than the retention window, then keeps the newest MAX_CACHED. */
export function applyRetention(messages: CachedMessage[], nowMs: number): CachedMessage[] {
  const cutoff = nowMs - RETENTION_DAYS * 86_400_000;
  return messages
    .filter((m) => Date.parse(m.receivedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
    .slice(0, MAX_CACHED);
}

export function loadCache(store: JsonStore): CacheFile {
  const raw = store.read<Partial<CacheFile>>(CACHE_FILE, {});
  if (raw.version !== 1 || !Array.isArray(raw.messages)) return emptyCache();
  return { ...raw, version: 1, messages: raw.messages };
}

export function saveCache(store: JsonStore, cache: CacheFile, nowMs: number): CacheFile {
  const next = { ...cache, messages: applyRetention(cache.messages, nowMs) };
  store.write(CACHE_FILE, next);
  return next;
}

export function deleteCache(store: JsonStore): void {
  rmSync(store.path(CACHE_FILE), { force: true });
}
