import type { Settings } from "../shared/contracts";

/** The old companion defaults: the four blob characters' names and the first-run placeholder. */
const OLD_NAMES = new Set(["Your companion", "Pebble", "Moss", "Ember", "Tide"]);

/**
 * NONON now ships one companion, Non. Settings saved by older builds carry a blob character and its default name;
 * both move to Non. A name the person typed themselves is left alone.
 */
export function migrateSettings(saved: Partial<Settings>): { settings: Partial<Settings>; changed: boolean } {
  const next = { ...saved };
  let changed = false;
  if (next.character !== undefined && next.character !== "non") {
    next.character = "non";
    changed = true;
  }
  if (next.companionName !== undefined && OLD_NAMES.has(next.companionName.trim())) {
    next.companionName = "Non";
    changed = true;
  }
  return { settings: next, changed };
}
