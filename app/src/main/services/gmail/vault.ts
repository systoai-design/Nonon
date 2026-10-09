import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GmailError } from "./errors";

/** Same shape as Electron's safeStorage, so production passes it straight in and tests pass a fake. */
export interface SecretStore {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface StoredTokens {
  refreshToken: string;
  accessToken?: string;
  /** Epoch ms when accessToken stops being valid. */
  expiresAt?: number;
  scopes: string[];
  account?: string;
}

export const TOKEN_FILE = "gmail-token.bin";

export interface TokenVault {
  exists(): boolean;
  load(): StoredTokens | null;
  save(tokens: StoredTokens): void;
  clear(): void;
}

/** Refuses to write anything when the OS cannot encrypt it: a plaintext refresh token on disk is worse than no sign-in. */
export function createTokenVault(dataDir: string, secrets: SecretStore): TokenVault {
  const file = join(dataDir, TOKEN_FILE);
  return {
    exists: () => existsSync(file),
    load() {
      if (!existsSync(file)) return null;
      try {
        if (!secrets.isEncryptionAvailable()) return null;
        const parsed = JSON.parse(secrets.decryptString(readFileSync(file))) as StoredTokens;
        return typeof parsed.refreshToken === "string" && parsed.refreshToken ? parsed : null;
      } catch {
        return null;
      }
    },
    save(tokens) {
      if (!secrets.isEncryptionAvailable()) {
        throw new GmailError(
          "storage",
          "This computer cannot protect saved sign-ins, so NONON will not store your Gmail sign-in. Nothing was saved.",
        );
      }
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, secrets.encryptString(JSON.stringify(tokens)));
      renameSync(tmp, file);
    },
    clear() {
      rmSync(file, { force: true });
    },
  };
}
