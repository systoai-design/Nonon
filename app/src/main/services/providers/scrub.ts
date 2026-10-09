import type { ProviderId } from "../../../shared/contracts";
import { LABELS } from "./types";

const RULES: [RegExp, string][] = [
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "[secret]"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "[secret]"],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, "[secret]"],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "[secret]"],
  [/\bya29\.[0-9A-Za-z_-]{16,}/g, "[secret]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[secret]"],
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, "[secret]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{10,}/gi, "$1 [secret]"],
  // key=value, "key": "value", header: value
  [/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|secret|password|passwd|authorization|credential)s?["']?\s*[:=]\s*["']?)[^\s"',;&]{6,}/gi, "$1[secret]"],
  // secrets pasted into a URL query
  [/([?&](?:key|token|api_key|access_token|code)=)[^&\s]{6,}/gi, "$1[secret]"],
];

/** Removes anything that looks like a credential. Applied to every string that leaves this module as an error or log. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const [re, sub] of RULES) out = out.replace(re, sub);
  return out;
}

const AUTH = /not logged in|not signed in|please run \/login|run \/login|sign in|log ?in required|login required|authentication[_ ]failed|failed to authenticate|oauth session expired|unauthorized|\b401\b|invalid api key|missing bearer|no credentials|not authenticated/i;
const LIMIT = /rate.?limit|usage limit|quota|\b429\b|too many requests|out of credits|insufficient credits|limit reached|capacity|overloaded/i;
const NETWORK = /enotfound|econnrefused|econnreset|etimedout|network|getaddrinfo|could not resolve|certificate|offline|unable to connect/i;

export function looksLikeAuthProblem(text: string): boolean {
  return AUTH.test(text);
}

export function looksLikeLimit(text: string): boolean {
  return LIMIT.test(text);
}

/** Keeps the tail of a noisy stderr dump, with secrets removed, for use in a plain-language message. */
export function tidyTail(raw: string, max = 280): string {
  const clean = scrubSecrets(raw)
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `...${clean.slice(-max)}` : clean;
}

/** One sentence a person can act on. Never contains a raw stack, argv or secret. */
export function plainReason(provider: ProviderId, raw: string): { code: "auth" | "limit" | "failed"; message: string } {
  const name = LABELS[provider];
  const tail = tidyTail(raw);
  if (AUTH.test(raw)) return { code: "auth", message: `${name} needs you to sign in again. Open Connected AI in settings and choose Sign in.` };
  if (LIMIT.test(raw)) return { code: "limit", message: `${name} says you reached your plan limit, or it is busy. Try again later, or use the AI on this computer.` };
  if (NETWORK.test(raw)) return { code: "failed", message: `${name} could not reach the internet. Check your connection and try again.` };
  return { code: "failed", message: tail ? `${name} stopped because of a problem: ${tail}` : `${name} stopped without saying why.` };
}
