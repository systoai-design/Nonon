// Minifies web/*.js into public/assets/ with esbuild. The sources are plain browser scripts (no imports),
// so there is nothing to bundle; this only shrinks them. boot.js stays hand-written in public/assets.
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entries = readdirSync(join(root, "web")).filter((f) => f.endsWith(".js")).map((f) => join(root, "web", f));
await build({ entryPoints: entries, outdir: join(root, "public/assets"), minify: true, target: "es2019", legalComments: "none", logLevel: "info" });
