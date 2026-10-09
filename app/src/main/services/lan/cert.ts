import { X509Certificate, createPrivateKey } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { generate } from "selfsigned";
import { sha256Hex } from "./tokens";

export interface HostIdentity {
  certPem: string;
  keyPem: string;
  /** SHA-256 of the DER certificate, lowercase hex. This is what pairing pins. */
  fingerprint: string;
}

export const CERT_FILE = "host-cert.pem";
export const KEY_FILE = "host-key.pem";

const TEN_YEARS_MS = 10 * 365 * 24 * 3600 * 1000;

export function fingerprintOfPem(certPem: string): string {
  return sha256Hex(new X509Certificate(certPem).raw);
}

export function localAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (!a.internal && a.family === "IPv4") out.push(a.address);
  }
  return out;
}

function readIdentity(dir: string): HostIdentity | null {
  const certFile = join(dir, CERT_FILE);
  const keyFile = join(dir, KEY_FILE);
  if (!existsSync(certFile) || !existsSync(keyFile)) return null;
  try {
    const certPem = readFileSync(certFile, "utf8");
    const keyPem = readFileSync(keyFile, "utf8");
    const cert = new X509Certificate(certPem);
    if (new Date(cert.validTo).getTime() < Date.now() + 30 * 24 * 3600 * 1000) return null;
    // The key must be the one this certificate was issued for, or TLS fails later with a confusing error.
    if (!cert.checkPrivateKey(createPrivateKey(keyPem))) return null;
    return { certPem, keyPem, fingerprint: sha256Hex(cert.raw) };
  } catch {
    return null;
  }
}

function writeSecret(file: string, text: string, mode: number): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { encoding: "utf8", mode });
  renameSync(tmp, file);
  try {
    chmodSync(file, mode);
  } catch {
    // Windows ignores POSIX modes. The file sits in the signed-in user's profile, which is user-only by default.
  }
}

/**
 * Loads the host's self-signed certificate, or makes one once and keeps it. The certificate never changes between runs,
 * so a pairing code made yesterday still pins the same host. The private key file is written 0600 where the OS honours it.
 */
export async function loadOrCreateIdentity(dir: string, extraAddresses: string[] = []): Promise<HostIdentity> {
  mkdirSync(dir, { recursive: true });
  const existing = readIdentity(dir);
  if (existing) return existing;

  const ips = [...new Set(["127.0.0.1", "::1", ...localAddresses(), ...extraAddresses])];
  const notBeforeDate = new Date(Date.now() - 24 * 3600 * 1000);
  const pems = await generate([{ name: "commonName", value: "NONON host" }], {
    keyType: "ec",
    curve: "P-256",
    algorithm: "sha256",
    notBeforeDate,
    notAfterDate: new Date(notBeforeDate.getTime() + TEN_YEARS_MS),
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        altNames: [{ type: 2, value: "localhost" }, ...ips.map((ip) => ({ type: 7 as const, ip }))],
      },
    ],
  });
  writeSecret(join(dir, KEY_FILE), pems.private, 0o600);
  writeSecret(join(dir, CERT_FILE), pems.cert, 0o644);
  return { certPem: pems.cert, keyPem: pems.private, fingerprint: fingerprintOfPem(pems.cert) };
}
