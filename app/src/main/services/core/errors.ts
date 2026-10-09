/** An error whose message is already written for the user. Anything else is treated as unexpected. */
export class UserError extends Error {
  override name = "UserError";
}

const GENERIC = "Something went wrong while running this. Your original files were not changed.";

/** One short, stack-free line that is safe to show in the UI. */
export function plainMessage(e: unknown): string {
  if (e instanceof UserError) return e.message;
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const line = raw.split(/\r?\n/)[0]?.trim() ?? "";
  if (line === "" || /^\s*at\s/.test(line)) return GENERIC;
  return line.length > 240 ? `${line.slice(0, 237)}...` : line;
}

export function logError(log: (m: string) => void, context: string, e: unknown): void {
  const detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
  log(`${context}: ${detail}`);
}
