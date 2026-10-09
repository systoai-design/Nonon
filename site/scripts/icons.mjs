// Inner markup of the official NONON icons (brand-src/icons, copied from the brand pack).
// The pack's files carry an inline style attribute and a title; the site's CSP forbids inline
// styles and the icons are decorative, so both are dropped and CSS sets the colour.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "brand-src", "icons");

export const ICONS = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith(".svg"))) {
  const svg = readFileSync(join(dir, file), "utf8");
  ICONS[file.replace(/\.svg$/, "")] = svg
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/, "");
}

// Names the pages use, mapped to the closest official glyph.
const ALIAS = {
  compare: "spreadsheet",
  meeting: "calendar",
  study: "school",
  draft: "edit",
  clock: "routines",
  eye: "review",
  backup: "file",
  undo: "restore",
  laptop: "device",
  cloud: "upload",
  wifi: "link",
  down: "download",
  next: "chevron-right",
};
for (const [alias, real] of Object.entries(ALIAS)) {
  if (!ICONS[real]) throw new Error(`icon ${real} missing for alias ${alias}`);
  ICONS[alias] = ICONS[real];
}
