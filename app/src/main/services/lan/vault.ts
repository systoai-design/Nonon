import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../core/errors";
import type { SecretStore } from "../gmail/vault";

export type { SecretStore };

/** Everything the client needs to reach its paired computer. The token is the secret; the rest is not, but travels with it. */
export interface ClientPairing {
  host: string;
  port: number;
  /** Lowercase hex SHA-256 of the host certificate. */
  fingerprint: string;
  deviceId: string;
  token: string;
  hostName: string;
  deviceName: string;
  pairedAt: string;
}

export const PAIRING_FILE = "client-pairing.bin";

export interface PairingVault {
  exists(): boolean;
  load(): ClientPairing | null;
  save(pairing: ClientPairing): void;
  clear(): void;
}

export const NO_PROTECTION_MESSAGE =
  "This computer cannot protect saved sign-ins, so NONON will not store the link to your other computer. Nothing was saved.";

/** Same rule as the Gmail vault: when the OS cannot encrypt, nothing is written. A plaintext token on disk is worse than no pairing. */
export function createPairingVault(dir: string, secrets: SecretStore): PairingVault {
  const file = join(dir, PAIRING_FILE);
  return {
    exists: () => existsSync(file),
    load() {
      if (!existsSync(file)) return null;
      try {
        if (!secrets.isEncryptionAvailable()) return null;
        const p = JSON.parse(secrets.decryptString(readFileSync(file))) as ClientPairing;
        return typeof p.token === "string" && p.token && typeof p.host === "string" && typeof p.fingerprint === "string" ? p : null;
      } catch {
        return null;
      }
    },
    save(pairing) {
      if (!secrets.isEncryptionAvailable()) throw new UserError(NO_PROTECTION_MESSAGE);
      mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, secrets.encryptString(JSON.stringify(pairing)));
      renameSync(tmp, file);
    },
    clear() {
      rmSync(file, { force: true });
    },
  };
}
