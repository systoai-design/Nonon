import { isIP } from "node:net";

/** Sliding-window counter of failures per key (an IP address). */
export class FailureLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max = 5,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  private prune(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length > 0) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  fail(key: string): void {
    const list = this.prune(key);
    list.push(this.now());
    this.hits.set(key, list);
    if (this.hits.size > 2000) {
      for (const k of this.hits.keys()) {
        this.prune(k);
        if (this.hits.size <= 1000) break;
      }
    }
  }

  /** Seconds until the key may try again, or 0 when it is not blocked. */
  blockedFor(key: string): number {
    const list = this.prune(key);
    if (list.length < this.max) return 0;
    const oldest = list[list.length - this.max] ?? list[0] ?? this.now();
    return Math.max(1, Math.ceil((oldest + this.windowMs - this.now()) / 1000));
  }
}

export function normalizeIp(ip: string | undefined): string {
  if (!ip) return "";
  const v4mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return (v4mapped?.[1] ?? ip).toLowerCase();
}

/**
 * True for addresses that only exist on a local network: loopback, private ranges, link-local and IPv6 unique-local.
 * The host refuses everything else so a forwarded port or a public IPv6 address cannot reach it by accident.
 */
export function isPrivateAddress(raw: string): boolean {
  const ip = normalizeIp(raw).split("%")[0] ?? "";
  const kind = isIP(ip);
  if (kind === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (kind === 6) {
    return ip === "::1" || /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
  }
  return false;
}
