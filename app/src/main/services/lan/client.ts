import type { InferenceClient, InferenceRequest, InferenceResult, Locations } from "../../../shared/contracts";
import { UserError } from "../core/errors";
import { HostUnavailableError, PairedAuthError, PairingError } from "./errors";
import { pinnedRequest, readJsonBody, type PinnedResponse, type PinnedTarget } from "./pinned";
import { MAX_BODY_BYTES, type ChatBody, type PairReply, type StatusBody, type StreamLine } from "./protocol";
import type { PairingPayload } from "./tokens";
import { cleanDeviceName } from "./tokens";
import type { ClientPairing } from "./vault";

export const PAIRED_LOCATION: Locations = { ai: "paired", files: "this-computer" };

const APPROVAL_WAIT_MS = 150_000;
const MAX_RETRY_AFTER_S = 30;

const targetOf = (p: Pick<ClientPairing, "host" | "port" | "fingerprint">): PinnedTarget => ({
  host: p.host,
  port: p.port,
  fingerprint: p.fingerprint,
});

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("This was stopped.", "AbortError");
}

// ---------------------------------------------------------------- pairing

/**
 * Sends the one-time secret to the host over a TLS connection pinned to the code's fingerprint, then waits for the
 * person on the host to answer "Allow <device>?". Resolves with the long-lived token only if they said yes.
 */
export async function requestPairing(payload: PairingPayload, deviceName: string, signal?: AbortSignal): Promise<ClientPairing> {
  const name = cleanDeviceName(deviceName);
  if (!name) throw new PairingError("Give this computer a name (up to 60 characters) so the other computer can show who is asking.");
  let res: PinnedResponse;
  try {
    res = await pinnedRequest(targetOf({ host: payload.h, port: payload.p, fingerprint: payload.f }), {
      method: "POST",
      path: "/v1/pair",
      body: JSON.stringify({ secret: payload.s, deviceName: name }),
      headersTimeoutMs: APPROVAL_WAIT_MS,
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    if (e instanceof HostUnavailableError && e.reason === "identity") {
      throw new PairingError("That computer did not prove it is the one that made this code, so NONON stopped. Nothing was shared. Make a new code and try again.");
    }
    if (e instanceof HostUnavailableError) {
      throw new PairingError("NONON could not reach that computer. Check that sharing is on there and that both computers are on the same network.");
    }
    throw e;
  }
  const body = await readJsonBody(res.body).catch(() => null);
  if (res.status === 200) {
    const r = body as Partial<PairReply> | null;
    if (r && typeof r.deviceId === "string" && typeof r.token === "string" && r.token.length >= 20) {
      return {
        host: payload.h,
        port: payload.p,
        fingerprint: payload.f,
        deviceId: r.deviceId,
        token: r.token,
        hostName: typeof r.hostName === "string" ? r.hostName.slice(0, 80) : payload.n,
        deviceName: name,
        pairedAt: new Date().toISOString(),
      };
    }
    throw new PairingError("The other computer sent a reply NONON could not use.");
  }
  const reason = (body as { error?: string } | null)?.error;
  if (res.status === 403 && reason === "denied") throw new PairingError("The other computer did not allow this one.");
  if (res.status === 429) throw new PairingError("Too many tries. Wait a minute, then make a new code on the other computer.");
  throw new PairingError("The other computer did not accept that code. It may have expired or already been used. Make a new one and try again.");
}

// ---------------------------------------------------------------- status check

export interface HostCheck {
  state: "connected" | "unreachable" | "unpaired";
  detail: string;
  status?: StatusBody;
}

export async function checkHost(p: ClientPairing, signal?: AbortSignal): Promise<HostCheck> {
  let res: PinnedResponse;
  try {
    res = await pinnedRequest(targetOf(p), {
      method: "GET",
      path: "/v1/status",
      headers: { authorization: `Bearer ${p.token}` },
      headersTimeoutMs: 5000,
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    if (e instanceof HostUnavailableError) return { state: "unreachable", detail: e.message };
    throw e;
  }
  if (res.status === 401) {
    res.destroy();
    return { state: "unpaired", detail: new PairedAuthError().message };
  }
  if (res.status === 200) {
    const status = (await readJsonBody(res.body).catch(() => null)) as StatusBody | null;
    if (status && typeof status.name === "string") {
      return {
        state: "connected",
        status,
        detail: status.busy ? "Connected. It is busy with its own work, so jobs may wait their turn." : "Connected.",
      };
    }
  }
  res.destroy();
  return { state: "unreachable", detail: "Your other computer did not answer the way NONON expected." };
}

// ---------------------------------------------------------------- inference

export interface PairedInferenceClient extends InferenceClient {
  /** Called when the host cannot be used (unreachable, dropped, revoked). Lets the task layer pause instead of continuing. */
  onHostLost(cb: (e: HostUnavailableError) => void): () => void;
}

export interface PairedClientDeps {
  pairing: () => ClientPairing | null;
  /** The host answered 401: its stored token for this computer is gone. */
  onUnpaired: () => void;
  /** Longest total wait while the host says it is busy. */
  busyWaitMs?: number;
}

function parseRetryAfter(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), MAX_RETRY_AFTER_S) : 5;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * An InferenceClient that runs on the paired computer. It never falls back to this computer's AI: any failure to reach
 * the host surfaces as HostUnavailableError so the caller can wait instead.
 */
export function createPairedClient(deps: PairedClientDeps): PairedInferenceClient {
  const listeners = new Set<(e: HostUnavailableError) => void>();
  const announce = <E extends HostUnavailableError>(e: E): E => {
    for (const cb of [...listeners]) cb(e);
    return e;
  };

  async function chat(req: InferenceRequest): Promise<InferenceResult> {
    const pairing = deps.pairing();
    if (!pairing) throw announce(new PairedAuthError("No other computer is paired. Pair one first."));

    const body: ChatBody = {
      messages: req.messages,
      ...(req.jsonSchema ? { jsonSchema: req.jsonSchema } : {}),
      ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };
    const json = JSON.stringify(body);
    if (Buffer.byteLength(json) > MAX_BODY_BYTES) {
      throw new UserError("That is too much text to send to your other computer at once. Try a smaller amount.");
    }
    const deadline = Date.now() + (deps.busyWaitMs ?? 120_000);

    for (;;) {
      let res: PinnedResponse;
      try {
        res = await pinnedRequest(targetOf(pairing), {
          method: "POST",
          path: "/v1/chat",
          headers: { authorization: `Bearer ${pairing.token}` },
          body: json,
          ...(req.signal ? { signal: req.signal } : {}),
        });
      } catch (e) {
        throw e instanceof HostUnavailableError ? announce(e) : e;
      }

      if (res.status === 401) {
        res.destroy();
        deps.onUnpaired();
        throw announce(new PairedAuthError());
      }
      if (res.status === 429) {
        const wait = parseRetryAfter(res.headers["retry-after"]);
        res.destroy();
        if (Date.now() + wait * 1000 > deadline) throw announce(new HostUnavailableError("busy"));
        await sleep(wait * 1000, req.signal);
        continue;
      }
      if (res.status === 400 || res.status === 413) {
        res.destroy();
        throw new UserError("Your other computer could not take that request. It may be too big. Try a smaller amount.");
      }
      if (res.status !== 200) {
        res.destroy();
        throw announce(new HostUnavailableError("unreachable", "Your other computer had a problem and could not answer. Please try again."));
      }
      return readStream(res, req, announce, deps.onUnpaired);
    }
  }

  return {
    location: PAIRED_LOCATION,
    chat,
    onHostLost(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}

async function readStream(
  res: PinnedResponse,
  req: InferenceRequest,
  announce: <E extends HostUnavailableError>(e: E) => E,
  onUnpaired: () => void,
): Promise<InferenceResult> {
  const onAbort = () => res.destroy();
  req.signal?.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder();
  let pending = "";
  let final: Extract<StreamLine, { t: "done" }> | null = null;

  const handle = (line: string): void => {
    if (!line) return;
    let msg: StreamLine;
    try {
      msg = JSON.parse(line) as StreamLine;
    } catch {
      return;
    }
    if (msg.t === "delta" && typeof msg.text === "string") req.onToken?.(msg.text);
    else if (msg.t === "done" && typeof msg.text === "string") final = msg;
    else if (msg.t === "error") {
      if (msg.code === "revoked") {
        onUnpaired();
        throw announce(new PairedAuthError());
      }
      if (msg.code === "stopped") throw announce(new HostUnavailableError("stopped"));
      if (msg.code === "timeout") throw announce(new HostUnavailableError("timeout"));
      throw new UserError(msg.message || "The AI on your other computer could not finish this.");
    }
  };

  try {
    try {
      for await (const chunk of res.body) {
        pending += decoder.decode(chunk as Buffer, { stream: true });
        let nl: number;
        while ((nl = pending.indexOf("\n")) >= 0) {
          handle(pending.slice(0, nl).trim());
          pending = pending.slice(nl + 1);
        }
      }
      handle(pending.trim());
    } catch (e) {
      if (req.signal?.aborted) throw abortError(req.signal);
      if (e instanceof UserError) throw e;
      throw announce(new HostUnavailableError("dropped"));
    }
    if (req.signal?.aborted) throw abortError(req.signal);
    const done = final as Extract<StreamLine, { t: "done" }> | null;
    if (!done) throw announce(new HostUnavailableError("dropped"));
    const result: InferenceResult = { text: done.text, location: PAIRED_LOCATION };
    if (done.promptTokens !== undefined) result.promptTokens = done.promptTokens;
    if (done.completionTokens !== undefined) result.completionTokens = done.completionTokens;
    if (done.tokensPerSecond !== undefined) result.tokensPerSecond = done.tokensPerSecond;
    return result;
  } finally {
    req.signal?.removeEventListener("abort", onAbort);
    res.destroy();
  }
}
