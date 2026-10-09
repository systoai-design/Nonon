/**
 * Reads a pasted pairing code only to show the person what they are about to trust. Pure and dependency-free so the
 * main process tests can check its short code against the one the host computes. It grants nothing: pairing itself
 * is done in the main process, which pins the certificate named in the code.
 */

const PREFIX = "nonon-pair-1.";

export interface PairingPreview {
  hostName: string;
  address: string;
  port: number;
  /** Same six digits the host shows next to its code. */
  shortCode: string;
}

function decodeBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function shortCodeOf(fingerprint: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(`nonon-short|${fingerprint}|${secret}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const n = ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
  const six = String(n % 1_000_000).padStart(6, "0");
  return `${six.slice(0, 3)} ${six.slice(3)}`;
}

export async function previewPairing(input: string): Promise<PairingPreview | null> {
  const text = input.trim();
  if (!text.startsWith(PREFIX) || text.length > 1024) return null;
  try {
    const o = JSON.parse(decodeBase64Url(text.slice(PREFIX.length))) as Record<string, unknown>;
    if (o.v !== 1 || typeof o.h !== "string" || typeof o.p !== "number" || typeof o.f !== "string" || typeof o.s !== "string") return null;
    return {
      hostName: typeof o.n === "string" && o.n ? o.n.slice(0, 80) : "another computer",
      address: o.h,
      port: o.p,
      shortCode: await shortCodeOf(o.f, o.s),
    };
  } catch {
    return null;
  }
}

/** "4:32" until `expiresAt`, or null once it has passed. */
export function countdown(expiresAt: string, now = Date.now()): string | null {
  const left = Math.floor((new Date(expiresAt).getTime() - now) / 1000);
  if (!Number.isFinite(left) || left <= 0) return null;
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}
