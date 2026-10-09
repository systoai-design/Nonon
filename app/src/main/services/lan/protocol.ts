import type { ChatMessage } from "../../../shared/contracts";

export const DEFAULT_PORT = 18765;

/** Both sides use the same body cap so the client can refuse an oversized request before sending anything. */
export const MAX_BODY_BYTES = 512 * 1024;
export const MAX_TOKENS_CAP = 4096;
export const MAX_MESSAGES = 64;

export interface HostLimits {
  maxBodyBytes: number;
  maxTokens: number;
  maxMessages: number;
  /** Whole-request ceiling for one paired chat. */
  requestTimeoutMs: number;
  /** How long a person has to answer "Allow <device>?". */
  approvalTimeoutMs: number;
  codeTtlMs: number;
  maxWrongSecrets: number;
  failMax: number;
  failWindowMs: number;
  heartbeatMs: number;
  retryAfterSeconds: number;
  maxPending: number;
}

export const DEFAULT_LIMITS: HostLimits = {
  maxBodyBytes: MAX_BODY_BYTES,
  maxTokens: MAX_TOKENS_CAP,
  maxMessages: MAX_MESSAGES,
  requestTimeoutMs: 5 * 60_000,
  approvalTimeoutMs: 2 * 60_000,
  codeTtlMs: 5 * 60_000,
  maxWrongSecrets: 3,
  failMax: 5,
  failWindowMs: 60_000,
  heartbeatMs: 10_000,
  retryAfterSeconds: 5,
  maxPending: 3,
};

/** POST /v1/chat body. A strict subset of InferenceRequest: no signal, no callbacks. */
export interface ChatBody {
  messages: ChatMessage[];
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}

/** One JSON object per line in the /v1/chat response. */
export type StreamLine =
  | { t: "ping" }
  | { t: "delta"; text: string }
  | { t: "done"; text: string; promptTokens?: number; completionTokens?: number; tokensPerSecond?: number }
  | { t: "error"; code: "revoked" | "stopped" | "timeout" | "failed"; message: string };

export interface StatusBody {
  name: string;
  ready: boolean;
  busy: boolean;
  limits: { maxTokens: number; maxBodyBytes: number };
}

export interface PairReply {
  deviceId: string;
  token: string;
  hostName: string;
}
