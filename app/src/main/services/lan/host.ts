import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { InferenceClient, LanHostState, PairRequest, PairedDevice, PairingCodeInfo } from "../../../shared/contracts";
import { UserError, plainMessage } from "../core/errors";
import { loadOrCreateIdentity, localAddresses, type HostIdentity } from "./cert";
import { FailureLimiter, isPrivateAddress, normalizeIp } from "./limits";
import {
  DEFAULT_LIMITS,
  DEFAULT_PORT,
  type ChatBody,
  type HostLimits,
  type PairReply,
  type StatusBody,
  type StreamLine,
} from "./protocol";
import {
  bearerOf,
  cleanDeviceName,
  encodePairing,
  hashToken,
  newDeviceId,
  newDeviceToken,
  newPairingSecret,
  newSalt,
  safeEqual,
  shortCodeFor,
  splitToken,
} from "./tokens";

export interface StoredDevice {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt?: string;
  salt: string;
  /** Salted hash of the device token. The token itself is only ever held by the device. */
  hash: string;
}

export interface DeviceStorage {
  load(): StoredDevice[];
  save(devices: StoredDevice[]): void;
}

export interface HostDeps {
  /** Folder for host-cert.pem and host-key.pem. */
  certDir: string;
  storage: DeviceStorage;
  /** The only thing the host can do for a paired computer: run chat on this. Looked up per request. */
  chatClient: () => InferenceClient;
  hostName: string;
  port?: number;
  /** Interface to listen on. Default: all interfaces, with a private-address check on every connection. */
  bindHost?: string;
  /** Address written into pairing codes. Default: this computer's first private IPv4 address. */
  advertiseHost?: () => string | null;
  /** Reports whether the local AI is ready, for /v1/status. */
  ready?: () => boolean;
  /** True while this computer is doing its own AI work; paired requests then wait so local work keeps priority. */
  localBusy?: () => boolean;
  limits?: Partial<HostLimits>;
  now?: () => number;
  log?: (message: string) => void;
  /** Called whenever host state changes (devices, pending, code, running, busy). */
  onChange: () => void;
  onPairRequest: (request: PairRequest) => void;
}

export interface LanHost {
  start(): Promise<void>;
  stop(): Promise<void>;
  running(): boolean;
  /** Actual listening port (differs from the configured one when 0 was requested). */
  port(): number;
  fingerprint(): string | null;
  createPairingCode(): PairingCodeInfo;
  approve(requestId: string): void;
  deny(requestId: string): void;
  revoke(deviceId: string): void;
  devices(): PairedDevice[];
  state(): LanHostState;
  /** Counters the evidence tests read; never exposed over the network. */
  stats(): { tlsErrors: number; rejectedPublic: number };
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`http ${status}`);
  }
}

interface ActiveCode {
  secret: string;
  pairing: string;
  shortCode: string;
  expiresAt: number;
  wrong: number;
  timer: NodeJS.Timeout;
}

interface PendingPair {
  id: string;
  request: PairRequest;
  deviceName: string;
  closed: boolean;
  decided: boolean;
  issued?: PairReply;
  settle: (decision: "approved" | "denied") => void;
  timer: NodeJS.Timeout;
}

interface ActiveChat {
  deviceId: string;
  controller: AbortController;
  /** Ends the stream with an error line and aborts the AI call. No-op once the chat has already ended. */
  end: (code: "revoked" | "stopped" | "timeout", message: string) => void;
}

const DUMMY_SALT = newSalt();
const DUMMY_HASH = hashToken("dummy", DUMMY_SALT);
const BODY_TIMEOUT_MS = 30_000;
const LAST_SEEN_PERSIST_MS = 60_000;
/** An oversized upload is read and discarded up to this many times the cap, then the connection is dropped. */
const DRAIN_FACTOR = 8;

export function createLanHost(deps: HostDeps): LanHost {
  const limits: HostLimits = { ...DEFAULT_LIMITS, ...deps.limits };
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const failures = new FailureLimiter(limits.failMax, limits.failWindowMs, now);

  let devices = deps.storage.load();
  let server: Server | null = null;
  let identity: HostIdentity | null = null;
  let listenPort = deps.port ?? DEFAULT_PORT;
  let lastError: string | undefined;
  let code: ActiveCode | null = null;
  let active: ActiveChat | null = null;
  const pending = new Map<string, PendingPair>();
  const lastPersisted = new Map<string, number>();
  const counters = { tlsErrors: 0, rejectedPublic: 0 };

  const changed = () => deps.onChange();
  const persist = () => deps.storage.save(devices);

  function defaultAdvertise(): string | null {
    const all = localAddresses();
    return all.find((a) => isPrivateAddress(a) && !a.startsWith("169.254.")) ?? all[0] ?? null;
  }

  // ---------------------------------------------------------------- http helpers

  function reply(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string | number> = {}): void {
    if (res.headersSent || res.destroyed) return;
    const text = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(status, {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(text ? { "content-type": "application/json" } : {}),
      "content-length": Buffer.byteLength(text),
      ...headers,
    });
    res.end(text);
  }

  /**
   * Reads a capped body. When the cap is exceeded the promise rejects at once with 413, but the rest of the upload is still
   * read and thrown away (up to a bound): answering and hanging up while the client is mid-upload resets the connection,
   * and the client would then see a network error instead of the 413.
   */
  function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > max) {
      discard(req);
      return Promise.reject(new HttpError(413));
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let over = false;
      const timer = setTimeout(() => {
        req.destroy();
        reject(new HttpError(400));
      }, BODY_TIMEOUT_MS);
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (over) {
          if (size > max * DRAIN_FACTOR) req.destroy();
          return;
        }
        if (size > max) {
          over = true;
          chunks.length = 0;
          reject(new HttpError(413));
          return;
        }
        chunks.push(chunk);
      });
      req.once("end", () => {
        clearTimeout(timer);
        if (!over) resolve(Buffer.concat(chunks));
      });
      req.once("error", () => {
        clearTimeout(timer);
        reject(new HttpError(400));
      });
      req.once("close", () => clearTimeout(timer));
    });
  }

  function discard(req: IncomingMessage): void {
    let n = 0;
    const timer = setTimeout(() => req.destroy(), BODY_TIMEOUT_MS);
    timer.unref?.();
    req.on("data", (chunk: Buffer) => {
      n += chunk.length;
      if (n > limits.maxBodyBytes * DRAIN_FACTOR) req.destroy();
    });
    req.once("close", () => clearTimeout(timer));
  }

  function jsonOf(buf: Buffer): Record<string, unknown> | null {
    try {
      const v = JSON.parse(buf.toString("utf8")) as unknown;
      return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- auth

  function authenticate(req: IncomingMessage): StoredDevice | null {
    const token = bearerOf(req.headers.authorization);
    const parts = token ? splitToken(token) : null;
    const device = parts ? devices.find((d) => d.id === parts.id) : undefined;
    // Always hash and compare, even for an unknown id, so timing does not reveal which ids exist.
    const got = Buffer.from(hashToken(token ?? "", device?.salt ?? DUMMY_SALT));
    const want = Buffer.from(device?.hash ?? DUMMY_HASH);
    const equal = got.length === want.length && timingSafeEqual(got, want);
    return equal && device && token ? device : null;
  }

  function touch(device: StoredDevice): void {
    const t = now();
    device.lastSeenAt = new Date(t).toISOString();
    if (t - (lastPersisted.get(device.id) ?? 0) >= LAST_SEEN_PERSIST_MS) {
      lastPersisted.set(device.id, t);
      persist();
    }
  }

  // ---------------------------------------------------------------- pairing

  function clearCode(): void {
    if (code) clearTimeout(code.timer);
    code = null;
  }

  function codeInfo(): PairingCodeInfo | null {
    if (!code) return null;
    if (code.expiresAt <= now()) {
      clearCode();
      return null;
    }
    return { pairing: code.pairing, shortCode: code.shortCode, expiresAt: new Date(code.expiresAt).toISOString() };
  }

  async function handlePair(req: IncomingMessage, res: ServerResponse, ip: string): Promise<void> {
    let body: Record<string, unknown> | null;
    try {
      body = jsonOf(await readBody(req, 4096));
    } catch (e) {
      failures.fail(ip);
      return reply(res, e instanceof HttpError ? e.status : 400);
    }
    const secret = typeof body?.secret === "string" && body.secret.length <= 128 ? body.secret : null;
    const name = cleanDeviceName(body?.deviceName);
    if (secret === null || name === null) {
      failures.fail(ip);
      return reply(res, 400);
    }

    const current = codeInfo();
    if (!current || !code) {
      failures.fail(ip);
      return reply(res, 403, { error: "refused" });
    }
    if (!safeEqual(secret, code.secret)) {
      failures.fail(ip);
      code.wrong += 1;
      if (code.wrong >= limits.maxWrongSecrets) {
        log("pairing code locked after too many wrong secrets");
        clearCode();
      }
      changed();
      return reply(res, 403, { error: "refused" });
    }
    if (pending.size >= limits.maxPending) return reply(res, 429, { error: "busy" }, { "retry-after": limits.retryAfterSeconds });

    // Spent on the first correct secret, whatever the person answers: a denied code cannot be tried again.
    const fingerprintForCode = identity?.fingerprint ?? "";
    const short = shortCodeFor(fingerprintForCode, secret);
    clearCode();

    const id = `pr_${newDeviceId().slice(4)}`;
    const request: PairRequest = { id, deviceName: name, address: ip, at: new Date(now()).toISOString(), shortCode: short };
    const decision = await new Promise<"approved" | "denied">((resolve) => {
      const entry: PendingPair = {
        id,
        request,
        deviceName: name,
        closed: false,
        decided: false,
        settle: (d) => {
          entry.decided = true;
          resolve(d);
        },
        timer: setTimeout(() => resolve("denied"), limits.approvalTimeoutMs),
      };
      entry.timer.unref?.();
      res.once("close", () => {
        entry.closed = true;
        resolve("denied");
      });
      pending.set(id, entry);
      changed();
      deps.onPairRequest(request);
    });
    const entry = pending.get(id);
    pending.delete(id);
    if (entry) clearTimeout(entry.timer);
    changed();
    if (decision === "approved" && entry?.issued) return reply(res, 200, entry.issued);
    reply(res, 403, { error: "denied" });
  }

  // ---------------------------------------------------------------- chat

  function parseChat(buf: Buffer): ChatBody | string {
    const o = jsonOf(buf);
    if (!o) return "The request was not valid.";
    const rawMessages = o.messages;
    if (!Array.isArray(rawMessages) || rawMessages.length < 1 || rawMessages.length > limits.maxMessages) {
      return `Send between 1 and ${limits.maxMessages} messages.`;
    }
    const messages: ChatBody["messages"] = [];
    for (const m of rawMessages as unknown[]) {
      const r = (m ?? {}) as Record<string, unknown>;
      if ((r.role !== "system" && r.role !== "user" && r.role !== "assistant") || typeof r.content !== "string") {
        return "Each message needs a role and text.";
      }
      messages.push({ role: r.role, content: r.content });
    }
    let maxTokens = limits.maxTokens;
    if (o.maxTokens !== undefined) {
      if (typeof o.maxTokens !== "number" || !Number.isInteger(o.maxTokens) || o.maxTokens < 1) return "maxTokens must be a whole number.";
      if (o.maxTokens > limits.maxTokens) return `maxTokens is above the limit of ${limits.maxTokens}.`;
      maxTokens = o.maxTokens;
    }
    const out: ChatBody = { messages, maxTokens };
    if (o.temperature !== undefined) {
      if (typeof o.temperature !== "number" || !(o.temperature >= 0 && o.temperature <= 2)) return "temperature must be between 0 and 2.";
      out.temperature = o.temperature;
    }
    if (o.jsonSchema !== undefined) {
      if (typeof o.jsonSchema !== "object" || o.jsonSchema === null || Array.isArray(o.jsonSchema)) return "jsonSchema must be an object.";
      out.jsonSchema = o.jsonSchema as Record<string, unknown>;
    }
    return out;
  }

  async function handleChat(req: IncomingMessage, res: ServerResponse, device: StoredDevice): Promise<void> {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limits.maxBodyBytes) {
      discard(req);
      return reply(res, 413, { error: "too large" });
    }
    // The slot is taken before the body is read, so two requests cannot both pass the check while uploading.
    if (active || deps.localBusy?.()) {
      return reply(res, 429, { error: "busy" }, { "retry-after": limits.retryAfterSeconds });
    }
    const controller = new AbortController();
    let ended = false;
    const mine: ActiveChat = {
      deviceId: device.id,
      controller,
      end(codeName, message) {
        if (ended) return;
        ended = true;
        write({ t: "error", code: codeName, message });
        controller.abort();
        if (!res.headersSent) reply(res, 401);
        else if (!res.writableEnded) res.end();
      },
    };
    const write = (line: StreamLine) => {
      if (!res.writableEnded && !res.destroyed && res.headersSent) res.write(`${JSON.stringify(line)}\n`);
    };
    active = mine;
    changed();
    let heartbeat: NodeJS.Timeout | undefined;
    let timeout: NodeJS.Timeout | undefined;
    try {
      let parsed: ChatBody | string;
      try {
        parsed = parseChat(await readBody(req, limits.maxBodyBytes));
      } catch (e) {
        return reply(res, e instanceof HttpError ? e.status : 400, { error: "bad request" });
      }
      if (typeof parsed === "string") return reply(res, 400, { error: parsed });

      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.flushHeaders();
      res.once("close", () => {
        if (!ended) controller.abort();
      });
      heartbeat = setInterval(() => write({ t: "ping" }), limits.heartbeatMs);
      timeout = setTimeout(() => mine.end("timeout", "The AI on that computer took too long."), limits.requestTimeoutMs);

      try {
        const result = await deps.chatClient().chat({
          messages: parsed.messages,
          ...(parsed.jsonSchema ? { jsonSchema: parsed.jsonSchema } : {}),
          ...(parsed.maxTokens !== undefined ? { maxTokens: parsed.maxTokens } : {}),
          ...(parsed.temperature !== undefined ? { temperature: parsed.temperature } : {}),
          signal: controller.signal,
          onToken: (text) => write({ t: "delta", text }),
        });
        if (!ended) {
          ended = true;
          write({
            t: "done",
            text: result.text,
            ...(result.promptTokens !== undefined ? { promptTokens: result.promptTokens } : {}),
            ...(result.completionTokens !== undefined ? { completionTokens: result.completionTokens } : {}),
            ...(result.tokensPerSecond !== undefined ? { tokensPerSecond: result.tokensPerSecond } : {}),
          });
        }
      } catch (e) {
        if (!ended) {
          ended = true;
          log(`paired chat from ${device.name} failed: ${plainMessage(e)}`);
          write({ t: "error", code: "failed", message: "The AI on that computer could not finish this." });
        }
      }
      if (!res.writableEnded) res.end();
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      if (active === mine) active = null;
      changed();
    }
  }

  // ---------------------------------------------------------------- routing

  async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = normalizeIp(req.socket.remoteAddress);
    if (!isPrivateAddress(ip)) {
      counters.rejectedPublic += 1;
      req.socket.destroy();
      return;
    }
    const wait = failures.blockedFor(ip);
    if (wait > 0) return reply(res, 429, undefined, { "retry-after": wait });

    const path = (req.url ?? "").split("?")[0];
    if (req.method === "POST" && path === "/v1/pair") return handlePair(req, res, ip);

    const device = authenticate(req);
    if (!device) {
      failures.fail(ip);
      return reply(res, 401);
    }
    touch(device);

    if (req.method === "GET" && path === "/v1/status") {
      const status: StatusBody = {
        name: deps.hostName,
        ready: deps.ready?.() ?? true,
        busy: active !== null || (deps.localBusy?.() ?? false),
        limits: { maxTokens: limits.maxTokens, maxBodyBytes: limits.maxBodyBytes },
      };
      return reply(res, 200, status);
    }
    if (req.method === "POST" && path === "/v1/chat") return handleChat(req, res, device);
    return reply(res, 404);
  }

  // ---------------------------------------------------------------- lifecycle

  const svc: LanHost = {
    async start() {
      if (server) return;
      lastError = undefined;
      try {
        identity = await loadOrCreateIdentity(deps.certDir);
        const srv = createServer(
          { key: identity.keyPem, cert: identity.certPem, minVersion: "TLSv1.2", ALPNProtocols: ["http/1.1"] },
          (req, res) => {
            onRequest(req, res).catch((e) => {
              log(`lan request failed: ${plainMessage(e)}`);
              if (!res.headersSent) reply(res, 500);
              else res.destroy();
            });
          },
        );
        srv.maxConnections = 32;
        srv.headersTimeout = 10_000;
        srv.requestTimeout = 60_000;
        srv.keepAliveTimeout = 2_000;
        srv.maxHeadersCount = 50;
        // Plain HTTP or garbage on the TLS port: drop it without an HTTP answer.
        srv.on("tlsClientError", (_err, socket) => {
          counters.tlsErrors += 1;
          socket.destroy();
        });
        srv.on("clientError", (_err, socket) => socket.destroy());
        await new Promise<void>((resolve, reject) => {
          srv.once("error", reject);
          srv.listen(deps.port ?? DEFAULT_PORT, deps.bindHost ?? "0.0.0.0", () => {
            srv.off("error", reject);
            resolve();
          });
        });
        listenPort = (srv.address() as AddressInfo).port;
        srv.on("error", (e) => log(`lan server error: ${plainMessage(e)}`));
        server = srv;
        log(`lan host listening on ${deps.bindHost ?? "0.0.0.0"}:${listenPort}`);
      } catch (e) {
        identity = null;
        const inUse = (e as NodeJS.ErrnoException)?.code === "EADDRINUSE";
        lastError = inUse
          ? `Another program on this computer is already using port ${deps.port ?? DEFAULT_PORT}, so sharing could not start. Close that program and try again.`
          : "Sharing could not start on this computer. Please try again.";
        changed();
        throw new UserError(lastError);
      }
      changed();
    },

    async stop() {
      const srv = server;
      server = null;
      clearCode();
      for (const p of [...pending.values()]) {
        clearTimeout(p.timer);
        p.settle("denied");
      }
      active?.end("stopped", "That computer stopped sharing.");
      if (srv) {
        await new Promise<void>((resolve) => {
          srv.close(() => resolve());
          srv.closeAllConnections();
        });
      }
      identity = null;
      changed();
    },

    running: () => server !== null,
    port: () => listenPort,
    fingerprint: () => identity?.fingerprint ?? null,

    createPairingCode() {
      if (!server || !identity) throw new UserError("Turn on sharing first, then make a pairing code.");
      const address = deps.advertiseHost ? deps.advertiseHost() : defaultAdvertise();
      if (!address) throw new UserError("This computer does not seem to be connected to a network, so another computer cannot find it.");
      clearCode();
      const secret = newPairingSecret();
      const expiresAt = now() + limits.codeTtlMs;
      const timer = setTimeout(() => {
        if (code?.secret === secret) {
          clearCode();
          changed();
        }
      }, limits.codeTtlMs);
      timer.unref?.();
      code = {
        secret,
        expiresAt,
        wrong: 0,
        timer,
        shortCode: shortCodeFor(identity.fingerprint, secret),
        pairing: encodePairing({ v: 1, h: address, p: listenPort, f: identity.fingerprint, s: secret, n: deps.hostName }),
      };
      changed();
      return codeInfo()!;
    },

    approve(requestId) {
      const entry = pending.get(requestId);
      if (!entry || entry.decided) throw new UserError("That request is no longer waiting.");
      if (entry.closed) throw new UserError("That computer stopped waiting. Ask it to try again.");
      const id = newDeviceId();
      const token = newDeviceToken(id);
      const salt = newSalt();
      devices = [...devices, { id, name: entry.deviceName, createdAt: new Date(now()).toISOString(), salt, hash: hashToken(token, salt) }];
      persist();
      entry.issued = { deviceId: id, token, hostName: deps.hostName };
      entry.settle("approved");
      changed();
    },

    deny(requestId) {
      const entry = pending.get(requestId);
      if (!entry || entry.decided) throw new UserError("That request is no longer waiting.");
      entry.settle("denied");
    },

    revoke(deviceId) {
      if (!devices.some((d) => d.id === deviceId)) throw new UserError("That computer is not on the list.");
      devices = devices.filter((d) => d.id !== deviceId);
      lastPersisted.delete(deviceId);
      persist();
      if (active?.deviceId === deviceId) active.end("revoked", "This computer was unpaired.");
      changed();
    },

    devices: () => devices.map(({ id, name, createdAt, lastSeenAt }) => ({ id, name, createdAt, ...(lastSeenAt ? { lastSeenAt } : {}) })),

    state() {
      return {
        running: server !== null,
        port: listenPort,
        address: deps.advertiseHost ? deps.advertiseHost() : defaultAdvertise(),
        devices: svc.devices(),
        pending: [...pending.values()].map((p) => p.request),
        code: codeInfo(),
        busy: active !== null,
        ...(lastError ? { error: lastError } : {}),
      };
    },

    stats: () => ({ ...counters }),
  };
  return svc;
}
