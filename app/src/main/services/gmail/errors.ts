export type GmailErrorCode =
  | "not-configured"
  | "not-connected"
  | "needs-reconnect"
  | "no-cache"
  | "offline"
  | "api"
  | "oauth"
  | "policy"
  | "storage";

/** Messages are written for the person reading them, so callers can show `message` as is. */
export class GmailError extends Error {
  constructor(
    readonly code: GmailErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GmailError";
  }
}

export const isGmailError = (e: unknown, code?: GmailErrorCode): e is GmailError =>
  e instanceof GmailError && (code === undefined || e.code === code);
