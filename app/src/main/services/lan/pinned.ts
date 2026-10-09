import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { HostUnavailableError } from "./errors";
import { sha256Hex } from "./tokens";

export interface PinnedTarget {
  host: string;
  port: number;
  /** Lowercase hex SHA-256 of the host certificate. */
  fingerprint: string;
}

export interface PinnedResponse {
  status: number;
  headers: IncomingMessage["headers"];
  body: IncomingMessage;
  /** Closes the connection; used to stop a stream. */
  destroy(): void;
  /** TLS version actually negotiated, for the evidence tests. */
  protocol: string | null;
}

const CONNECT_TIMEOUT_MS = 6000;

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("This was stopped.", "AbortError");
}

function samePin(actual: string, pinned: string): boolean {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(pinned.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Opens TLS to the host and proceeds only if the presented certificate hashes to the pinned fingerprint.
 * CA validation is deliberately off: the host's certificate is self-signed and the pin is the whole trust decision.
 * Nothing (no headers, no token) is written to the socket before the pin has been checked.
 */
export function connectPinned(target: PinnedTarget, signal?: AbortSignal): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    let settled = false;
    const socket = tlsConnect({
      host: target.host,
      port: target.port,
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
      ...(isIP(target.host) ? {} : { servername: target.host }),
      ALPNProtocols: ["http/1.1"],
    });
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      reject(err);
    };
    const onAbort = () => fail(abortError(signal!));
    const timer = setTimeout(() => fail(new HostUnavailableError("unreachable")), CONNECT_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("error", () => fail(new HostUnavailableError("unreachable")));
    socket.once("close", () => fail(new HostUnavailableError("unreachable")));
    socket.once("secureConnect", () => {
      const raw = socket.getPeerCertificate(false)?.raw;
      if (!raw || !samePin(sha256Hex(raw), target.fingerprint)) return fail(new HostUnavailableError("identity"));
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.removeAllListeners("error");
      socket.removeAllListeners("close");
      // The request attaches its own handlers; this one only guarantees a late error can never become an uncaught exception.
      socket.on("error", () => {});
      resolve(socket);
    });
  });
}

export interface PinnedRequest {
  method: "GET" | "POST";
  path: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** Time allowed for the response headers to arrive. The body is not time-limited here (it is a stream). */
  headersTimeoutMs?: number;
}

export async function pinnedRequest(target: PinnedTarget, req: PinnedRequest): Promise<PinnedResponse> {
  const socket = await connectPinned(target, req.signal);
  const protocol = socket.getProtocol();
  return new Promise<PinnedResponse>((resolve, reject) => {
    const payload = req.body === undefined ? undefined : Buffer.from(req.body, "utf8");
    // No `agent` here: with createConnection and no agent, Node uses the socket we already verified.
    const r = httpsRequest({
      createConnection: () => socket,
      host: target.host,
      port: target.port,
      method: req.method,
      path: req.path,
      headers: {
        ...(payload ? { "content-type": "application/json", "content-length": String(payload.length) } : {}),
        connection: "close",
        ...(req.headers ?? {}),
      },
    });
    const onAbort = () => {
      r.destroy();
      socket.destroy();
      reject(req.signal ? abortError(req.signal) : new Error("aborted"));
    };
    req.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      r.destroy();
      socket.destroy();
      reject(new HostUnavailableError("timeout"));
    }, req.headersTimeoutMs ?? 30_000);
    r.once("error", () => {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      reject(new HostUnavailableError("unreachable"));
    });
    r.once("response", (res) => {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onAbort);
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: res,
        protocol,
        destroy: () => {
          res.destroy();
          socket.destroy();
        },
      });
    });
    r.end(payload);
  });
}

/** Reads a small JSON body; anything bigger than `max` is refused so a bad host cannot make the app buffer without limit. */
export async function readJsonBody(res: IncomingMessage, max = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > max) {
      res.destroy();
      throw new HostUnavailableError("dropped", "Your other computer sent an unexpectedly large reply.");
    }
    chunks.push(buf);
  }
  if (size === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}
