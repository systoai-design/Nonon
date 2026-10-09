// Bundles runtime-smoke.ts with the app's own esbuild and runs it under plain Node.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const outDir = process.env.NONON_SMOKE_OUT ?? "E:\\nonon-dev\\smoke";
const out = join(outDir, "runtime-smoke.mjs");
const esbuild = join(root, "app", "node_modules", "esbuild", "bin", "esbuild");

execFileSync(process.execPath, [esbuild, join(here, "runtime-smoke.ts"), "--bundle", "--platform=node", "--format=esm", "--target=node22", `--outfile=${out}`, "--log-level=warning"], { stdio: "inherit" });
execFileSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: "inherit" });
