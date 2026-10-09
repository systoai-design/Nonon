import { GmailError } from "./errors";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const REQUEST_TIMEOUT_MS = 20_000;

/** Node's fetch reports a missing network as TypeError("fetch failed") with the socket error in `cause`; a timeout is a TimeoutError. */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof GmailError) return false;
  if (!(e instanceof Error)) return false;
  if (e.name === "AbortError") return false;
  return e.name === "TimeoutError" || e instanceof TypeError || "cause" in e;
}

export function withTimeout(signal: AbortSignal | undefined, ms = REQUEST_TIMEOUT_MS): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export const offlineError = (): GmailError =>
  new GmailError("offline", "NONON could not reach Google. Check the internet connection and try again.");

/** Form-encoded POST used only for the token and revoke endpoints. Secrets travel in the body, never the URL. */
export async function postForm(
  fetchFn: FetchLike,
  url: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ status: number; json: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: withTimeout(signal),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    if (isNetworkError(e)) throw offlineError();
    throw e;
  }
  const text = await response.text().catch(() => "");
  let json: Record<string, unknown> = {};
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === "object") json = parsed as Record<string, unknown>;
  } catch {
    /* non-JSON body: status alone decides */
  }
  return { status: response.status, json };
}
