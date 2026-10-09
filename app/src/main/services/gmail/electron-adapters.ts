import { safeStorage, shell } from "electron";
import type { SecretStore } from "./vault";

/** The only file in this module that imports Electron. Tests import service.ts and inject fakes instead. */
export const electronOpenExternal = (url: string): Promise<void> => shell.openExternal(url);

export const electronSecretStore: SecretStore = {
  isEncryptionAvailable: () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  },
  encryptString: (plain) => safeStorage.encryptString(plain),
  decryptString: (encrypted) => safeStorage.decryptString(encrypted),
};
