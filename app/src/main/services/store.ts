import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Atomic JSON files under the data dir. Small data only: tasks, settings, routines, change records. */
export interface JsonStore {
  dir: string;
  read<T>(name: string, fallback: T): T;
  write(name: string, data: unknown): void;
  path(name: string): string;
}

export function createStore(dir: string): JsonStore {
  mkdirSync(dir, { recursive: true });
  const path = (name: string) => join(dir, name);
  return {
    dir,
    path,
    read<T>(name: string, fallback: T): T {
      const file = path(name);
      if (!existsSync(file)) return fallback;
      try {
        return JSON.parse(readFileSync(file, "utf8")) as T;
      } catch {
        // A torn or hand-edited file must not brick the app: keep it aside and start clean.
        try {
          renameSync(file, `${file}.corrupt-${Date.now()}`);
        } catch {
          /* nothing else to do */
        }
        return fallback;
      }
    },
    write(name: string, data: unknown): void {
      const file = path(name);
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
      renameSync(tmp, file);
    },
  };
}
