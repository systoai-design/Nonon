import { UserError } from "../core/errors";

export type HostUnavailableReason = "unreachable" | "dropped" | "busy" | "timeout" | "identity" | "unpaired" | "stopped";

/**
 * The other computer cannot be used right now. The task layer treats this as "wait", never as "fall back to the
 * local AI": paired work stays paired, keeps its checkpoints and resumes when the computer is back.
 */
export class HostUnavailableError extends UserError {
  override name = "HostUnavailableError";
  readonly reason: HostUnavailableReason;
  constructor(reason: HostUnavailableReason, message?: string) {
    super(message ?? DEFAULT_MESSAGES[reason]);
    this.reason = reason;
  }
}

/** The host no longer accepts this computer's token (revoked or unpaired there). Pairing again is the only way forward. */
export class PairedAuthError extends HostUnavailableError {
  override name = "PairedAuthError";
  constructor(message?: string) {
    super("unpaired", message);
  }
}

/** A failure while setting up or approving a pairing, worded for the person doing it. */
export class PairingError extends UserError {
  override name = "PairingError";
}

const DEFAULT_MESSAGES: Record<HostUnavailableReason, string> = {
  unreachable: "NONON cannot reach your other computer. Check that it is on, awake and on the same network.",
  dropped: "The connection to your other computer was lost part of the way through. Please try again.",
  busy: "Your other computer is busy with its own work right now. Please try again in a moment.",
  timeout: "Your other computer took too long to answer. Please try again.",
  identity: "That does not look like the computer you paired with, so NONON did not send anything to it.",
  unpaired: "This computer was unpaired. Pair it again to use your other computer's AI.",
  stopped: "Your other computer stopped sharing its AI.",
};

export function isHostUnavailable(e: unknown): e is HostUnavailableError {
  return e instanceof HostUnavailableError;
}
