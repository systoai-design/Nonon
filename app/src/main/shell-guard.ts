import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import { UserError } from "./services/core/errors";
import { isReallyInside } from "./services/core/files";
import { isInside } from "./services/fs-util";

/**
 * What "Open document" may hand to the operating system. shell.openPath runs whatever the file type is bound to,
 * so a program, script or shortcut that happens to sit in a project folder must never be started from here.
 */
export const OPENABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".csv", ".xlsx", ".txt", ".md", ".markdown", ".json", ".docx", ".pdf", ".rtf", ".pptx", ".png", ".jpg", ".jpeg",
]);

interface WorkspaceFolders {
  list(): { folder: string | null }[];
}

const OUTSIDE = "That file is outside your project folders, so NONON will not open it.";

async function insideAWorkspace(workspaces: WorkspaceFolders, real: string): Promise<boolean> {
  for (const w of workspaces.list()) {
    if (!w.folder) continue;
    try {
      if (isInside(await realpath(w.folder), real)) return true;
    } catch {
      /* a project whose folder is gone approves nothing */
    }
  }
  return false;
}

/** Returns the real path to hand to the system, or throws a plain error. Symlinks and junctions are resolved first. */
export async function resolveOpenable(workspaces: WorkspaceFolders, path: string): Promise<string> {
  if (!isAbsolute(path)) throw new UserError(OUTSIDE);
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    throw new UserError("NONON could not find that file. It may have been moved or deleted.");
  }
  if (!(await insideAWorkspace(workspaces, real))) throw new UserError(OUTSIDE);
  const info = await stat(real);
  if (info.isDirectory()) return real;
  // Both names are checked: a link called report.txt that points at a program is still a program.
  for (const name of [path, real]) {
    if (!OPENABLE_EXTENSIONS.has(extname(name).toLowerCase())) {
      throw new UserError("NONON only opens documents it can read, such as spreadsheets, Word files, PDFs and text. It will not start other kinds of files.");
    }
  }
  return real;
}

/** "Show in folder" starts nothing, but it still only points at the person's project folders or NONON's own data. */
export function mayReveal(workspaces: WorkspaceFolders, dataDir: string, path: string): boolean {
  if (!isAbsolute(path)) return false;
  return workspaces.list().some((w) => w.folder !== null && isReallyInside(w.folder, path)) || isReallyInside(dataDir, path);
}
