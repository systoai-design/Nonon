import type { ProviderId, ProviderStatus } from "../../../shared/contracts";

/** What an adapter reports while a turn runs. Plain, provider-neutral, safe to show. */
export type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "started" | "done" | "denied" }
  | { type: "note"; text: string };

export interface TurnInput {
  prompt: string;
  systemPrompt?: string;
  /** A throwaway staged directory. Never the user's original folder. */
  cwd: string;
  signal?: AbortSignal;
  onEvent?: (event: TurnEvent) => void;
  /** Hard stop for the whole turn. */
  timeoutMs?: number;
  /** Provider model id. Omit to use the provider's own default. */
  model?: string;
  /** True when the staged directory holds input files the provider should be able to read. */
  allowFileRead?: boolean;
}

export interface TurnResult {
  text: string;
  provider: ProviderId;
  sessionId?: string;
  model?: string;
  durationMs: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  costUsd?: number;
  /** Tool or approval requests that NONON refused during the turn. */
  denials: number;
  warnings: string[];
  /** The isolation the provider reported for this turn, kept as evidence. */
  effective: Record<string, string>;
}

export type ProviderErrorCode =
  | "not-ready"
  | "policy"
  | "auth"
  | "limit"
  | "timeout"
  | "aborted"
  | "spawn"
  | "protocol"
  | "incompatible"
  | "isolation"
  | "empty"
  | "failed";

/** Every provider failure carries the provider name so a paused task can say who stopped. */
export class ProviderError extends Error {
  readonly provider: ProviderId | "none";
  readonly code: ProviderErrorCode;
  constructor(provider: ProviderId | "none", code: ProviderErrorCode, message: string) {
    super(message);
    this.provider = provider;
    this.code = code;
    this.name = code === "aborted" ? "AbortError" : "ProviderError";
  }
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly label: string;
  /** Cheap and non-billing: never runs a model turn. */
  probe(): Promise<ProviderStatus>;
  runTurn(input: TurnInput): Promise<TurnResult>;
  /** The vendor's own sign-in command. Null when it cannot be launched from here. */
  signIn(): Promise<void>;
}

export const LABELS: Record<ProviderId, string> = {
  claude: "Claude",
  codex: "Codex",
  antigravity: "Antigravity",
};

export const DISCLOSURES: Record<ProviderId, string> = {
  claude:
    "Claude is an online AI from Anthropic. It gets your request and only the parts of your files that this job uses. " +
    "These are sent to Anthropic over the internet. " +
    "Claude works on a temporary copy on this computer, and it cannot change your own files. " +
    "You pay through your own Claude plan, and its limits apply. NONON does not provide free use.",
  codex:
    "Codex is an online AI from OpenAI. It gets your request and only the parts of your files that this job uses. " +
    "These are sent to OpenAI over the internet. " +
    "Codex works on a temporary copy on this computer that it can only read. " +
    "You pay through your own ChatGPT or OpenAI plan, and its limits apply. NONON does not provide free use.",
  antigravity:
    "Antigravity is an online AI from Google. It gets your request and only the parts of your files that this job uses. " +
    "These are sent to Google over the internet. " +
    "Antigravity works on a temporary copy on this computer. Any change it makes is only shown to you as a suggestion. " +
    "You pay through your own Google plan, and its limits apply. NONON does not provide free use.",
};
