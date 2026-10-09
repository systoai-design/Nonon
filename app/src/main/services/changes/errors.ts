/** A problem with one edit that the user can understand. `unsupported` means the file holds something NONON must not rewrite. */
export class EditError extends Error {
  readonly suggestion: string | undefined;
  readonly unsupported: boolean;

  constructor(message: string, opts: { suggestion?: string; unsupported?: boolean } = {}) {
    super(message);
    this.name = "EditError";
    this.suggestion = opts.suggestion;
    this.unsupported = opts.unsupported ?? false;
  }

  /** Message plus suggestion as one plain-English sentence group. */
  get plain(): string {
    return this.suggestion ? `${this.message} ${this.suggestion}` : this.message;
  }
}

export const XLSX_SUGGESTION = "Save a copy as a .csv file, or as an Excel file with only plain values, then try again.";

export function errCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

/** Turns a Node filesystem error into a sentence a non-technical person can act on. */
export function plainFsError(e: unknown, path: string): string {
  if (e instanceof EditError) return e.plain;
  const code = errCode(e);
  switch (code) {
    case "ENOENT":
      return `${path} was not found.`;
    case "EBUSY":
    case "EPERM":
    case "EACCES":
      return `${path} is open in another program or is read-only. Close it and try again.`;
    case "ENOTDIR":
    case "EEXIST":
      return `A file is blocking the folder path ${path}.`;
    case "ENOSPC":
      return "The drive is full. Free up some space, then try again.";
    default:
      return `NONON could not use ${path}. Check that it is not open in another program, then try again.`;
  }
}
