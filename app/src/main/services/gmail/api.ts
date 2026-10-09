import { GmailError } from "./errors";
import { isNetworkError, offlineError, withTimeout, type FetchLike } from "./net";

/** Minimal slice of the Gmail v1 `Message` resource that the parser reads. */
export interface RawPart {
  mimeType?: string;
  filename?: string;
  headers?: { name?: string; value?: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: RawPart[];
}

export interface RawMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  historyId?: string;
  payload?: RawPart;
}

export interface HistoryPage {
  added: string[];
  deleted: string[];
  historyId?: string;
  nextPageToken?: string;
}

export interface AccessTokens {
  token(signal?: AbortSignal): Promise<string>;
  /** Forces a new access token after a 401. */
  refresh(signal?: AbortSignal): Promise<string>;
}

export interface ApiOptions {
  apiBase: string;
  fetch: FetchLike;
  tokens: AccessTokens;
  sleep: (ms: number) => Promise<void>;
  maxRetries?: number;
  baseDelayMs?: number;
  log?: (line: string) => void;
}

const READ_PATH = /^\/gmail\/v1\/users\/me\/(?:profile|history|messages|messages\/[A-Za-z0-9_-]+)$/;
const NOT_A_MESSAGE_ID = new Set(["send", "import", "insert", "batchModify", "batchDelete", "trash", "untrash"]);
const MAX_RETRY_AFTER_MS = 10_000;

/**
 * The only door to Google's mail API. It refuses anything but GETs on messages, history and profile, so a bug
 * or a hostile email can never reach send, modify or delete: those endpoints are not callable from here.
 */
export function assertReadOnlyRequest(method: string, url: URL, apiBase: string): void {
  const base = new URL(apiBase);
  const ok =
    method === "GET" &&
    url.origin === base.origin &&
    READ_PATH.test(url.pathname) &&
    !NOT_A_MESSAGE_ID.has(url.pathname.split("/").pop() ?? "");
  if (!ok) throw new GmailError("api", "NONON blocked a request that could change your email. Nothing was changed.");
}

const retryable = (status: number, reason: string | undefined): boolean =>
  status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || (status === 403 && /ratelimit/i.test(reason ?? ""));

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  return undefined;
}

function apiFailure(status: number, reason: string | undefined): GmailError {
  if (status === 401) return new GmailError("needs-reconnect", "Google no longer accepts the saved sign-in. Connect Gmail again.", status);
  if (status === 403 && /accessnotconfigured|service_disabled/i.test(reason ?? "")) {
    return new GmailError("api", "Gmail is not turned on in your Google setup. See step 2 in docs/gmail-setup.md.", status);
  }
  if (status === 403) return new GmailError("api", "Google would not let NONON read this email. Connect Gmail again and allow reading email.", status);
  if (status === 429 || status >= 500) return new GmailError("api", "Google is busy right now. Try again in a few minutes.", status);
  return new GmailError("api", "Google could not finish the request. Please try again.", status);
}

export interface GmailApi {
  profile(signal?: AbortSignal): Promise<{ emailAddress: string; historyId: string }>;
  listMessages(
    query: { q: string; maxResults: number; pageToken?: string },
    signal?: AbortSignal,
  ): Promise<{ ids: string[]; nextPageToken?: string }>;
  /** Null when the message is gone (deleted between listing and fetching). */
  getMessage(id: string, signal?: AbortSignal): Promise<RawMessage | null>;
  /** Throws GmailError with status 404 when the start point has expired; the caller falls back to a full sync. */
  listHistory(startHistoryId: string, pageToken?: string, signal?: AbortSignal): Promise<HistoryPage>;
}

export function createGmailApi(opts: ApiOptions): GmailApi {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 500;

  async function get(path: string, params: Record<string, string | string[]>, signal?: AbortSignal): Promise<{ status: number; json: any }> {
    const url = new URL(opts.apiBase + path);
    for (const [key, value] of Object.entries(params)) {
      for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v);
    }
    assertReadOnlyRequest("GET", url, opts.apiBase);

    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const access = await opts.tokens.token(signal);
      let response: Response;
      try {
        response = await opts.fetch(url.toString(), {
          method: "GET",
          headers: { authorization: `Bearer ${access}`, accept: "application/json" },
          signal: withTimeout(signal),
        });
      } catch (e) {
        if (signal?.aborted) throw e;
        if (isNetworkError(e)) throw offlineError();
        throw e;
      }

      if (response.status === 401 && !refreshed) {
        refreshed = true;
        await opts.tokens.refresh(signal);
        attempt--;
        continue;
      }

      const body = await response.text().catch(() => "");
      let json: any = null;
      try {
        json = body ? JSON.parse(body) : null;
      } catch {
        /* an error page, not JSON */
      }
      if (response.ok) return { status: response.status, json };

      const reason: string | undefined = json?.error?.errors?.[0]?.reason ?? json?.error?.status;
      if (retryable(response.status, reason) && attempt < maxRetries) {
        const wait = parseRetryAfter(response.headers.get("retry-after")) ?? baseDelay * 2 ** attempt * (0.75 + Math.random() * 0.5);
        opts.log?.(`gmail: ${response.status} from Google, retrying in ${Math.round(wait)} ms`);
        await opts.sleep(wait);
        continue;
      }
      if (response.status === 404) return { status: 404, json };
      throw apiFailure(response.status, reason);
    }
  }

  return {
    async profile(signal) {
      const { json } = await get("/gmail/v1/users/me/profile", {}, signal);
      return { emailAddress: String(json?.emailAddress ?? ""), historyId: String(json?.historyId ?? "") };
    },

    async listMessages(query, signal) {
      const params: Record<string, string | string[]> = {
        labelIds: "INBOX",
        q: query.q,
        maxResults: String(query.maxResults),
        fields: "messages(id),nextPageToken",
      };
      if (query.pageToken) params.pageToken = query.pageToken;
      const { status, json } = await get("/gmail/v1/users/me/messages", params, signal);
      if (status === 404) throw new GmailError("api", "Google could not find your mailbox. Please try again.", 404);
      const ids = Array.isArray(json?.messages) ? json.messages.map((m: { id: string }) => m.id) : [];
      return { ids, nextPageToken: json?.nextPageToken };
    },

    async getMessage(id, signal) {
      const { status, json } = await get(`/gmail/v1/users/me/messages/${encodeURIComponent(id)}`, { format: "full" }, signal);
      if (status === 404) return null;
      return json as RawMessage;
    },

    async listHistory(startHistoryId, pageToken, signal) {
      const params: Record<string, string | string[]> = {
        startHistoryId,
        labelId: "INBOX",
        historyTypes: ["messageAdded", "messageDeleted"],
        maxResults: "100",
      };
      if (pageToken) params.pageToken = pageToken;
      const { status, json } = await get("/gmail/v1/users/me/history", params, signal);
      if (status === 404) throw new GmailError("api", "NONON's saved place in your mailbox is out of date.", 404);
      const added: string[] = [];
      const deleted: string[] = [];
      for (const record of Array.isArray(json?.history) ? json.history : []) {
        for (const m of record.messagesAdded ?? []) if (m?.message?.id) added.push(m.message.id);
        for (const m of record.messagesDeleted ?? []) if (m?.message?.id) deleted.push(m.message.id);
      }
      return { added, deleted, historyId: json?.historyId, nextPageToken: json?.nextPageToken };
    },
  };
}
