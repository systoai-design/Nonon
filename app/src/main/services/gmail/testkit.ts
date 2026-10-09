/** Test helpers: a fake Google (OAuth + Gmail REST) on a local port, fixture loading, and a fake app context. MOCKED, not Google. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { Locations, InferenceClient, InferenceRequest, InferenceResult, Workspace } from "../../../shared/contracts";
import { createStore } from "../store";
import type { AppCtx } from "../types";
import type { RawMessage } from "./api";
import type { Endpoints } from "./config";
import type { SecretStore } from "./vault";

export interface FixtureEmail {
  key: string;
  from: string;
  subject: string;
  hoursAgo: number;
  body?: string;
  html?: string;
  expect: { priority: "needs-attention" | "fyi" | "low"; deadline: string | null; injection?: boolean };
}

export function loadFixtures(): FixtureEmail[] {
  const file = fileURLToPath(new URL("../../../../../fixtures/gmail/emails.json", import.meta.url));
  return (JSON.parse(readFileSync(file, "utf8")) as { emails: FixtureEmail[] }).emails;
}

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64url");

/** Builds the Gmail `format=full` shape: multipart/alternative for plain text, a single html part for html-only mail. */
export function toApiMessage(email: FixtureEmail, idx: number, nowMs: number): RawMessage {
  const internal = nowMs - email.hoursAgo * 3_600_000;
  const headers = [
    { name: "From", value: email.from },
    { name: "To", value: "kyle@example.test" },
    { name: "Subject", value: email.subject },
    { name: "Date", value: new Date(internal).toUTCString() },
  ];
  const payload = email.html
    ? { mimeType: "text/html", headers, body: { size: email.html.length, data: b64(email.html) } }
    : {
        mimeType: "multipart/alternative",
        headers,
        body: { size: 0 },
        parts: [
          { mimeType: "text/plain", headers: [{ name: "Content-Type", value: 'text/plain; charset="UTF-8"' }], body: { size: 1, data: b64(email.body ?? "") } },
          { mimeType: "text/html", body: { size: 1, data: b64(`<div>${(email.body ?? "").replace(/\n/g, "<br>")}</div>`) } },
        ],
      };
  return {
    id: `m${String(idx + 1).padStart(3, "0")}`,
    threadId: `t${String(idx + 1).padStart(3, "0")}`,
    labelIds: ["INBOX", "UNREAD"],
    snippet: (email.body ?? "").slice(0, 80),
    internalDate: String(internal),
    payload,
  };
}

export interface LoggedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body?: Record<string, string>;
  auth?: string;
}

interface Fault {
  match: RegExp;
  status: number;
  remaining: number;
  retryAfter?: string;
}

export interface FakeGoogle {
  endpoints: Endpoints;
  port: number;
  log: LoggedRequest[];
  messages: RawMessage[];
  faults: Fault[];
  authRequests: Record<string, string>[];
  refreshCount: number;
  revokedTokens: string[];
  expireHistory: boolean;
  accountEmail: string;
  /** Existing access tokens start answering 401. */
  invalidateAccess(): void;
  /** Google stops accepting every refresh token (user removed access, or it expired). */
  revokeRefreshTokens(): void;
  addMessage(msg: RawMessage): void;
  removeMessage(id: string): void;
  /** What a browser does after consent: validates the auth URL, then returns the redirect target. */
  consent(authUrl: string, overrides?: { state?: string }): string;
  close(): Promise<void>;
}

export async function startFakeGoogle(initial: RawMessage[] = []): Promise<FakeGoogle> {
  let epoch = 1;
  let historyCounter = 1000;
  const history: { id: number; added?: string; deleted?: string }[] = [];
  const codes = new Map<string, { challenge: string }>();
  const goodRefresh = new Set<string>();
  const sockets = new Set<import("node:net").Socket>();

  const fake: FakeGoogle = {
    endpoints: { authorize: "", token: "", revoke: "", api: "" },
    port: 0,
    log: [],
    messages: [...initial],
    faults: [],
    authRequests: [],
    refreshCount: 0,
    revokedTokens: [],
    expireHistory: false,
    accountEmail: "kyle@example.test",
    invalidateAccess() {
      epoch++;
    },
    revokeRefreshTokens() {
      goodRefresh.clear();
    },
    addMessage(msg) {
      fake.messages.push(msg);
      history.push({ id: ++historyCounter, added: msg.id });
    },
    removeMessage(id) {
      fake.messages = fake.messages.filter((m) => m.id !== id);
      history.push({ id: ++historyCounter, deleted: id });
    },
    consent(authUrl, overrides) {
      const url = new URL(authUrl);
      const q = Object.fromEntries(url.searchParams.entries());
      fake.authRequests.push(q);
      if (q.code_challenge_method !== "S256" || !q.code_challenge) throw new Error("fake google: PKCE S256 required");
      if (q.response_type !== "code") throw new Error("fake google: response_type must be code");
      const code = `code-${randomBytes(6).toString("hex")}`;
      codes.set(code, { challenge: q.code_challenge });
      const back = new URL(q.redirect_uri as string);
      back.searchParams.set("code", code);
      back.searchParams.set("state", overrides?.state ?? (q.state as string));
      return back.toString();
    },
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data));
    });

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const entry: LoggedRequest = {
      method: req.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      auth: req.headers.authorization,
    };
    const raw = req.method === "POST" ? await readBody(req) : "";
    if (raw) entry.body = Object.fromEntries(new URLSearchParams(raw).entries());
    fake.log.push(entry);

    if (url.pathname === "/token" && req.method === "POST") {
      const b = entry.body ?? {};
      if (b.grant_type === "authorization_code") {
        const issued = codes.get(b.code ?? "");
        const verifierOk = issued && createHash("sha256").update(b.code_verifier ?? "").digest("base64url") === issued.challenge;
        if (!issued || !verifierOk || b.client_id !== "test-client-id" || b.client_secret !== "test-client-secret") {
          return send(res, 400, { error: "invalid_grant" });
        }
        codes.delete(b.code as string);
        const refresh = `rt-${randomBytes(8).toString("hex")}`;
        goodRefresh.add(refresh);
        return send(res, 200, {
          access_token: `at-${epoch}`,
          expires_in: 3599,
          refresh_token: refresh,
          scope: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly",
          token_type: "Bearer",
        });
      }
      if (b.grant_type === "refresh_token") {
        fake.refreshCount++;
        if (!goodRefresh.has(b.refresh_token ?? "")) return send(res, 400, { error: "invalid_grant" });
        return send(res, 200, { access_token: `at-${epoch}`, expires_in: 3599, scope: "https://www.googleapis.com/auth/gmail.readonly", token_type: "Bearer" });
      }
      return send(res, 400, { error: "unsupported_grant_type" });
    }

    if (url.pathname === "/revoke" && req.method === "POST") {
      const token = entry.body?.token ?? "";
      fake.revokedTokens.push(token);
      goodRefresh.delete(token);
      return send(res, 200, {});
    }

    if (url.pathname.startsWith("/gmail/v1/users/me/")) {
      const fault = fake.faults.find((f) => f.remaining > 0 && f.match.test(url.pathname));
      if (fault) {
        fault.remaining--;
        return send(res, fault.status, { error: { code: fault.status, message: "injected" } }, fault.retryAfter ? { "retry-after": fault.retryAfter } : {});
      }
      if (req.headers.authorization !== `Bearer at-${epoch}`) return send(res, 401, { error: { code: 401, message: "Invalid Credentials" } });
      if (req.method !== "GET") return send(res, 405, { error: { code: 405, message: "fake google only serves GET" } });

      const rest = url.pathname.slice("/gmail/v1/users/me/".length);
      if (rest === "profile") return send(res, 200, { emailAddress: fake.accountEmail, historyId: String(historyCounter), messagesTotal: fake.messages.length });

      if (rest === "messages") {
        const days = Number(/newer_than:(\d+)d/.exec(url.searchParams.get("q") ?? "")?.[1] ?? 365);
        const cutoff = Date.now() - days * 86_400_000;
        const all = fake.messages
          .filter((m) => m.labelIds?.includes("INBOX") && Number(m.internalDate) >= cutoff)
          .sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
        const max = Number(url.searchParams.get("maxResults") ?? 100);
        const offset = Number(url.searchParams.get("pageToken") ?? 0);
        const page = all.slice(offset, offset + max);
        return send(res, 200, {
          messages: page.map((m) => ({ id: m.id, threadId: m.threadId })),
          ...(offset + max < all.length ? { nextPageToken: String(offset + max) } : {}),
        });
      }

      if (rest.startsWith("messages/")) {
        const msg = fake.messages.find((m) => m.id === rest.slice("messages/".length));
        return msg ? send(res, 200, msg) : send(res, 404, { error: { code: 404, message: "Not Found" } });
      }

      if (rest === "history") {
        const start = Number(url.searchParams.get("startHistoryId"));
        if (fake.expireHistory || start < 1000) return send(res, 404, { error: { code: 404, message: "Requested entity was not found." } });
        const records = history
          .filter((h) => h.id > start)
          .map((h) => ({
            id: String(h.id),
            ...(h.added ? { messagesAdded: [{ message: { id: h.added, threadId: `t-${h.added}` } }] } : {}),
            ...(h.deleted ? { messagesDeleted: [{ message: { id: h.deleted, threadId: `t-${h.deleted}` } }] } : {}),
          }));
        return send(res, 200, { ...(records.length ? { history: records } : {}), historyId: String(historyCounter) });
      }
    }
    return send(res, 404, { error: "not found" });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  fake.port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${fake.port}`;
  fake.endpoints = { authorize: `${base}/authorize`, token: `${base}/token`, revoke: `${base}/revoke`, api: base };
  return fake;
}

/** AES-GCM stand-in for Electron's safeStorage. */
export function fakeSecrets(available = true): SecretStore {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => available,
    encryptString(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    decryptString(buf) {
      const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
    },
  };
}

export const LOCAL: Locations = { ai: "local", files: "this-computer" };
export const CLOUD: Locations = { ai: "claude", files: "this-computer" };

export function workspace(policy: Workspace["policy"] = "local-only"): Workspace {
  return { id: "ws1", name: "Test", folder: null, pack: "business", policy, autoApply: false, createdAt: new Date(0).toISOString() };
}

export interface TestCtx {
  ctx: AppCtx;
  logs: string[];
  runtimeCalls: InferenceRequest[];
}

/** Only what the Gmail service reads from AppCtx. */
export function makeCtx(dir: string, ws: Workspace = workspace(), ai?: InferenceClient): TestCtx {
  const logs: string[] = [];
  const runtimeCalls: InferenceRequest[] = [];
  const runtimeClient: InferenceClient = ai ?? {
    location: LOCAL,
    async chat(req) {
      runtimeCalls.push(req);
      throw new Error("no model configured for this test");
    },
  };
  const ctx = {
    paths: { dataDir: dir, modelDir: dir, resourcesDir: dir, logFile: `${dir}/log.txt` },
    store: createStore(dir),
    log: (m: string) => logs.push(m),
    svc: { workspaces: { get: (id: string) => (id === ws.id ? ws : undefined) }, runtime: { client: () => runtimeClient } },
  } as unknown as AppCtx;
  return { ctx, logs, runtimeCalls };
}

export const clientJson = (id = "test-client-id", secret = "test-client-secret"): string =>
  JSON.stringify({ installed: { client_id: id, client_secret: secret, auth_uri: "x", token_uri: "y" } });

/**
 * A scripted stand-in for the model. MOCKED: it reads the fixture's known answer for each email, so tests
 * exercise the plumbing (batching, validation, deadline checks), not model quality.
 */
export function scriptedModel(
  fixtures: FixtureEmail[],
  tweak: (key: string, answer: Record<string, unknown>) => Record<string, unknown> = (_k, a) => a,
  location: Locations = LOCAL,
): InferenceClient & { calls: InferenceRequest[] } {
  const calls: InferenceRequest[] = [];
  return {
    location,
    calls,
    async chat(req: InferenceRequest): Promise<InferenceResult> {
      calls.push(req);
      const text = req.messages.map((m) => m.content).join("\n");
      if (req.jsonSchema && "overview" in ((req.jsonSchema.properties as object) ?? {})) {
        return { text: JSON.stringify({ overview: "Reply to Maria and Daniel first." }), location };
      }
      const results = [...text.matchAll(/<<<EMAIL (\d+)>>>\nFrom: .*\nSubject: (.*)\n/g)].map((m) => {
        const email = fixtures.find((f) => f.subject === m[2]);
        const base = {
          n: Number(m[1]),
          priority: email?.expect.priority ?? "fyi",
          why: `Scripted answer for ${email?.key ?? "unknown"}.`,
          deadlinePhrase: email?.expect.deadline ?? null,
          draftReply: email?.expect.priority === "needs-attention" ? "Thanks for your note. I will get back to you shortly." : null,
        };
        return tweak(email?.key ?? "", base);
      });
      return { text: JSON.stringify({ results }), location };
    },
  };
}
