import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { GMAIL_READONLY_SCOPE, REQUESTED_SCOPES, type ClientConfig, type Endpoints } from "./config";
import { GmailError } from "./errors";
import { postForm, type FetchLike } from "./net";
import { challengeFor, newState, newVerifier } from "./pkce";

export const AUTH_TIMEOUT_MS = 2 * 60 * 1000;

export interface AuthorizeOptions {
  config: ClientConfig;
  endpoints: Endpoints;
  /** Opens the system browser. Injected so tests and non-Electron callers need no GUI. */
  openExternal: (url: string) => Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AuthCode {
  code: string;
  verifier: string;
  redirectUri: string;
}

const page = (title: string, body: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:20vh auto;padding:0 1rem;color:#2b3a33"><h2>${title}</h2><p>${body}</p></body>`;

export function buildAuthUrl(config: ClientConfig, endpoints: Endpoints, redirectUri: string, challenge: string, state: string): string {
  const url = new URL(endpoints.authorize);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: REQUESTED_SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return url.toString();
}

const sameState = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Authorization-code + PKCE with a one-shot loopback listener. The listener closes after the first /callback hit, success or not. */
export async function authorizeWithBrowser(opts: AuthorizeOptions): Promise<AuthCode> {
  const verifier = newVerifier();
  const state = newState();
  const challenge = challengeFor(verifier);

  return await new Promise<AuthCode>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const finish = (status: number, title: string, body: string, outcome: () => void) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8", connection: "close" });
        res.end(page(title, body), () => {
          shutdown();
          outcome();
        });
      };
      const gotState = url.searchParams.get("state") ?? "";
      if (!sameState(gotState, state)) {
        finish(400, "Sign-in could not be checked", "This page did not come from the sign-in NONON started. You can close this tab.", () =>
          fail(new GmailError("oauth", "Sign-in was stopped because the reply could not be verified. Nothing was connected. Please try again.")),
        );
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        finish(200, "Gmail was not connected", "You can close this tab and go back to NONON.", () =>
          fail(
            new GmailError(
              "oauth",
              error === "access_denied" ? "Gmail was not connected because access was not allowed." : "Google did not finish the sign-in. Nothing was connected. Please try again.",
            ),
          ),
        );
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        finish(400, "Sign-in incomplete", "Google did not finish signing you in. You can close this tab.", () =>
          fail(new GmailError("oauth", "Google did not finish the sign-in. Nothing was connected. Please try again.")),
        );
        return;
      }
      finish(200, "Gmail is connected", "You can close this tab and go back to NONON.", () => {
        if (settled) return;
        settled = true;
        resolve({ code, verifier, redirectUri });
      });
    });

    let redirectUri = "";
    const shutdown = () => {
      if (timer) clearTimeout(timer);
      server.close();
      server.closeAllConnections();
    };
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      shutdown();
      reject(e);
    };

    opts.signal?.addEventListener("abort", () => fail(new GmailError("oauth", "Sign-in was cancelled. Nothing was connected.")), { once: true });
    server.on("error", (e) => fail(new GmailError("oauth", "NONON could not get ready for sign-in on this computer. Nothing was connected. Please try again.")));
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      timer = setTimeout(
        () => fail(new GmailError("oauth", "Sign-in took too long and was stopped. Nothing was connected. Please try again.")),
        opts.timeoutMs ?? AUTH_TIMEOUT_MS,
      );
      opts.openExternal(buildAuthUrl(opts.config, opts.endpoints, redirectUri, challenge, state)).catch(() =>
        fail(new GmailError("oauth", "NONON could not open your web browser for sign-in. Nothing was connected. Check that this computer has a web browser, then try again.")),
      );
    });
  });
}

export interface TokenGrant {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  scopes: string[];
}

function grantFrom(json: Record<string, unknown>, now: number): TokenGrant {
  const accessToken = json.access_token;
  if (typeof accessToken !== "string" || !accessToken) throw new GmailError("oauth", "Google did not finish the sign-in. Nothing was connected. Please try again.");
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  const grant: TokenGrant = {
    accessToken,
    // Renew a minute early so a request never starts with a token about to lapse.
    expiresAt: now + Math.max(60, expiresIn - 60) * 1000,
    scopes: typeof json.scope === "string" ? json.scope.split(/\s+/).filter(Boolean) : [],
  };
  if (typeof json.refresh_token === "string" && json.refresh_token) grant.refreshToken = json.refresh_token;
  return grant;
}

function tokenFailure(status: number, json: Record<string, unknown>): GmailError {
  if (status === 400 && json.error === "invalid_grant") {
    return new GmailError("needs-reconnect", "Google no longer accepts the saved sign-in. Connect Gmail again.", status);
  }
  if (status === 401 || json.error === "invalid_client") {
    return new GmailError("oauth", "Google did not accept the setup file for NONON. Check the file google-client.json. The steps are in docs/gmail-setup.md.", status);
  }
  if (status === 429 || status >= 500) return new GmailError("api", "Google is busy right now. Try again in a few minutes.", status);
  return new GmailError("oauth", "Google could not finish the sign-in. Nothing was connected. Please try again.", status);
}

export async function exchangeCode(
  fetchFn: FetchLike,
  config: ClientConfig,
  endpoints: Endpoints,
  auth: AuthCode,
  now: number,
  signal?: AbortSignal,
): Promise<TokenGrant> {
  const { status, json } = await postForm(
    fetchFn,
    endpoints.token,
    {
      grant_type: "authorization_code",
      code: auth.code,
      redirect_uri: auth.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: auth.verifier,
    },
    signal,
  );
  if (status !== 200) throw tokenFailure(status, json);
  const grant = grantFrom(json, now);
  if (!grant.scopes.includes(GMAIL_READONLY_SCOPE)) {
    throw new GmailError("oauth", "Gmail access was not allowed on the Google screen, so nothing was connected. Tick the Gmail box and try again.");
  }
  if (!grant.refreshToken) throw new GmailError("oauth", "Google did not let NONON stay signed in. Remove NONON at myaccount.google.com/permissions, then connect Gmail again.");
  return grant;
}

export async function refreshAccess(
  fetchFn: FetchLike,
  config: ClientConfig,
  endpoints: Endpoints,
  refreshToken: string,
  now: number,
  signal?: AbortSignal,
): Promise<TokenGrant> {
  const { status, json } = await postForm(
    fetchFn,
    endpoints.token,
    { grant_type: "refresh_token", refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret },
    signal,
  );
  if (status !== 200) throw tokenFailure(status, json);
  return grantFrom(json, now);
}

/** Returns true when Google confirmed the revoke (an already-revoked token counts). Network failure returns false. */
export async function revokeToken(fetchFn: FetchLike, endpoints: Endpoints, token: string): Promise<boolean> {
  try {
    const { status, json } = await postForm(fetchFn, endpoints.revoke, { token });
    return status === 200 || (status === 400 && json.error === "invalid_token");
  } catch {
    return false;
  }
}
