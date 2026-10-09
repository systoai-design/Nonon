// Makes the web font from the brand pack's Nunito-Variable.ttf, and two static instances for og.png.
// Needs fontTools + brotli in a venv outside the repo (see DEPLOY.md):
//   python -m venv E:\nonon-dev\venv-fonts ; E:\nonon-dev\venv-fonts\Scripts\pip install fonttools brotli
// The font is used unmodified apart from dropping glyphs the pages never use (a Latin subset, all
// weights kept), which the OFL allows. Output: public/fonts/nunito-var-latin.woff2 (the only file preloaded).
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const venv = process.env.NONON_FONT_VENV ?? "E:/nonon-dev/venv-fonts/Scripts";
const scratch = process.env.NONON_FONT_SCRATCH ?? "E:/nonon-dev/og-fonts";
const src = join(root, "brand-src/fonts/Nunito-Variable.ttf");
const run = (exe, args) => {
  const r = spawnSync(join(venv, exe), args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${exe} failed`);
};
if (!existsSync(join(venv, "pyftsubset.exe"))) throw new Error(`fontTools venv not found at ${venv}`);

mkdirSync(join(root, "public/fonts"), { recursive: true });
mkdirSync(scratch, { recursive: true });
run("pyftsubset.exe", [
  src,
  "--unicodes=U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2013-2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+2032-2033,U+2039-203A,U+20AC,U+20B1,U+2122,U+2190-2193,U+2212,U+2713",
  "--layout-features=*",
  "--flavor=woff2",
  `--output-file=${join(root, "public/fonts/nunito-var-latin.woff2")}`,
]);
for (const [name, wght] of [["Nunito-Black", 900], ["Nunito-Bold", 700]]) {
  run("fonttools.exe", ["varLib.instancer", src, `wght=${wght}`, "--update-name-table", "-o", join(scratch, `${name}.ttf`)]);
}
console.log("fonts built");
