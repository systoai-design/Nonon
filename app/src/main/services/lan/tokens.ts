import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PairingError } from "./errors";

export const PAIRING_PREFIX = "nonon-pair-1.";
const MAX_PAIRING_CHARS = 1024;

/** 256-bit device token. Shape "<deviceId>.<secret>" so the host can look the device up without scanning. */
export function newDeviceToken(deviceId: string): string {
  return `${deviceId}.${randomBytes(32).toString("base64url")}`;
}

export function newDeviceId(): string {
  return `dev_${randomBytes(8).toString("hex")}`;
}

/** 192-bit one-time pairing secret (the brief asks for at least 128). */
export function newPairingSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Per-device salted SHA-256. The token already carries 256 random bits, so a slow KDF would add per-request cost
 * without adding strength; the salt only keeps two devices from sharing a stored value.
 */
export function hashToken(token: string, salt: string): string {
  return createHash("sha256").update(salt).update("\0").update(token).digest("hex");
}

/** Constant-time string compare: both sides are hashed first so length differences leak nothing. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function splitToken(token: string): { id: string; secret: string } | null {
  const dot = token.indexOf(".");
  if (dot < 1 || dot === token.length - 1) return null;
  const id = token.slice(0, dot);
  if (!/^dev_[0-9a-f]{16}$/.test(id)) return null;
  return { id, secret: token.slice(dot + 1) };
}

export function bearerOf(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer ([A-Za-z0-9._~-]{20,200})$/.exec(header);
  return m?.[1] ?? null;
}

// ---------------------------------------------------------------- pairing string

export interface PairingPayload {
  v: 1;
  /** Address the host was listening on when the code was made. */
  h: string;
  p: number;
  /** SHA-256 of the host certificate, lowercase hex. The client trusts exactly this certificate and nothing else. */
  f: string;
  /** One-time secret. */
  s: string;
  /** Host computer name, for display only. */
  n: string;
}

export function encodePairing(p: PairingPayload): string {
  return PAIRING_PREFIX + Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}

export function decodePairing(input: string): PairingPayload {
  const bad = () => new PairingError("That pairing code is not valid. Copy the whole code from the other computer and try again.");
  const text = input.trim();
  if (!text.startsWith(PAIRING_PREFIX) || text.length > MAX_PAIRING_CHARS) throw bad();
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(text.slice(PAIRING_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw bad();
  }
  if (typeof raw !== "object" || raw === null) throw bad();
  const o = raw as Record<string, unknown>;
  const ok =
    o.v === 1 &&
    typeof o.h === "string" &&
    /^[A-Za-z0-9.:_-]{1,253}$/.test(o.h) &&
    typeof o.p === "number" &&
    Number.isInteger(o.p) &&
    o.p > 0 &&
    o.p < 65536 &&
    typeof o.f === "string" &&
    /^[0-9a-f]{64}$/.test(o.f) &&
    typeof o.s === "string" &&
    o.s.length >= 22 &&
    o.s.length <= 128 &&
    typeof o.n === "string" &&
    o.n.length <= 80;
  if (!ok) throw bad();
  return o as unknown as PairingPayload;
}

/**
 * Six digits both computers can show, derived from the certificate and the secret. It lets a person check that the
 * code on the host and the code pasted on the client are the same one; it is not a credential.
 */
export function shortCodeFor(fingerprint: string, secret: string): string {
  const digest = createHash("sha256").update(`nonon-short|${fingerprint}|${secret}`).digest();
  const n = digest.readUInt32BE(0) % 1_000_000;
  const six = String(n).padStart(6, "0");
  return `${six.slice(0, 3)} ${six.slice(3)}`;
}

export function cleanDeviceName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 60) return null;
  return name;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
