import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The only mailbox permission NONON asks for. It cannot send, modify, label or delete anything. */
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const REQUESTED_SCOPES = [GMAIL_READONLY_SCOPE, "openid", "email"];

export const READ_ONLY_NOTE = "NONON can only read your email to make your summary. It cannot send, change or delete anything.";

export interface Endpoints {
  authorize: string;
  token: string;
  revoke: string;
  /** Gmail REST root, without a trailing slash. */
  api: string;
}

export const GOOGLE_ENDPOINTS: Endpoints = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  api: "https://gmail.googleapis.com",
};

export interface ClientConfig {
  clientId: string;
  clientSecret: string;
  source: "file" | "env";
}

export const CLIENT_FILE = "google-client.json";

export function clientFilePath(dataDir: string): string {
  return join(dataDir, CLIENT_FILE);
}

export function configHint(dataDir: string): string {
  return `Gmail is not set up yet. To sign in with Google, save the "Desktop app" file from Google as ${clientFilePath(dataDir)}. The steps are in docs/gmail-setup.md. (Developers can set NONON_GOOGLE_CLIENT_ID and NONON_GOOGLE_CLIENT_SECRET instead.)`;
}

/** Env wins over the file so a developer can override without touching the data folder. Never throws: a bad file means "not configured". */
export function loadClientConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): ClientConfig | null {
  const id = env.NONON_GOOGLE_CLIENT_ID?.trim();
  const secret = env.NONON_GOOGLE_CLIENT_SECRET?.trim();
  if (id && secret) return { clientId: id, clientSecret: secret, source: "env" };

  const file = clientFilePath(dataDir);
  if (!existsSync(file)) return null;
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as { installed?: { client_id?: unknown; client_secret?: unknown } };
    const clientId = json.installed?.client_id;
    const clientSecret = json.installed?.client_secret;
    if (typeof clientId === "string" && clientId && typeof clientSecret === "string" && clientSecret) {
      return { clientId, clientSecret, source: "file" };
    }
  } catch {
    /* unreadable file is reported as not configured */
  }
  return null;
}
