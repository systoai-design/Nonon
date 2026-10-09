import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelName, Channels, EventName, Events } from "../../../shared/ipc";
import { plainError } from "../lib/format";

/** Thin typed access to window.nonon. Kept local so these views do not depend on shell files. */
export function call<K extends ChannelName>(channel: K, arg: Channels[K]["arg"]): Promise<Channels[K]["res"]> {
  return window.nonon.call(channel, arg);
}

/** Everything shown to the user goes through plainError, so raw error text never reaches a screen. */
export function errMsg(e: unknown): string {
  return plainError(e);
}

export function useEvent<K extends EventName>(event: K, cb: (payload: Events[K]) => void): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => window.nonon.on(event, (p) => ref.current(p)), [event]);
}

export interface CallState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (updater: T | null | ((prev: T | null) => T | null)) => void;
}

/** Loads once per distinct arg; pass enabled=false to hold off. */
export function useCall<K extends ChannelName>(channel: K, arg: Channels[K]["arg"], enabled = true): CallState<Channels[K]["res"]> {
  type R = Channels[K]["res"];
  const [data, setData] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [nonce, setNonce] = useState(0);
  const argKey = JSON.stringify(arg ?? null);
  const argRef = useRef(arg);
  argRef.current = arg;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    call(channel, argRef.current)
      .then((r) => {
        if (!live) return;
        setData(r);
        setError(null);
      })
      .catch((e) => live && setError(errMsg(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [channel, argKey, enabled, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}

// ---------------------------------------------------------------- formatting

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export function formatTime(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(d);
}

/** "5 minutes ago", "in 2 hours": used where an exact clock time would be noise. */
export function relativeTime(iso: string | undefined | null, now = Date.now()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export function formatCents(cents: number, currency?: string): string {
  const value = cents / 100;
  try {
    if (currency) return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    // Unknown currency code: fall through to a plain number.
  }
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Opens only https links; anything else is ignored so a crafted mail link cannot launch other schemes. */
export function openHttps(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    window.open(u.toString(), "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}

/** Runs an async action and keeps its error message for display; returns undefined on failure. */
export function useAttempt() {
  const [error, setError] = useState<string | null>(null);
  const attempt = useCallback(async function <T>(fn: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errMsg(e));
      return undefined;
    }
  }, []);
  return { error, attempt, clearError: () => setError(null) };
}
