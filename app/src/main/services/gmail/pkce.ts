import { createHash, randomBytes } from "node:crypto";

const b64url = (buf: Buffer): string => buf.toString("base64url");

/** RFC 7636: 32 random bytes give a 43-character verifier, the minimum length. */
export function newVerifier(): string {
  return b64url(randomBytes(32));
}

export function challengeFor(verifier: string): string {
  return b64url(createHash("sha256").update(verifier, "ascii").digest());
}

export function newState(): string {
  return b64url(randomBytes(24));
}
