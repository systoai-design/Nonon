// Bundles and minifies web/*.js into public/assets/ with esbuild. Each entry is a plain browser script;
// home.js imports web/lib/ (springs, the 3D stage), which is bundled in. three.js stays a separate,
// lazily imported vendor file (public/vendor/three.min.js). boot.js stays hand-written in public/assets.
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entries = readdirSync(join(root, "web")).filter((f) => f.endsWith(".js")).map((f) => join(root, "web", f));
await build({
  entryPoints: entries,
  outdir: join(root, "public/assets"),
  bundle: true,
  format: "iife",
  external: ["/vendor/*"],
  minify: true,
  target: "es2020",
  legalComments: "none",
  logLevel: "info",
});
