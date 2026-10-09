// Regenerates every raster asset from its source: favicons (from the brand pack's app icons), the
// 3D Non poses, the app screenshots (webp) and og.png. Run after changing images.config.mjs.
// The web font comes from build-font.mjs, the pages from build-pages.mjs.
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NON, SHOTS, siteRoot, shotsDir } from "./images.config.mjs";

const pub = (p) => join(siteRoot, "public", p);
const src = (p) => join(siteRoot, "brand-src", p);
const generated = {};

// ---- brand marks and favicons, copied unchanged from the pack ----
mkdirSync(pub("brand"), { recursive: true });
for (const f of ["nonon-mark-color.svg", "nonon-mark-white.svg", "nonon-logo-horizontal-color.svg", "nonon-logo-horizontal-white.svg"]) {
  copyFileSync(src(`logos/${f}`), pub(`brand/${f}`));
}
copyFileSync(src("app-icons/favicon.ico"), pub("favicon.ico"));
copyFileSync(src("app-icons/nonon-app-icon-standard.svg"), pub("favicon.svg"));
copyFileSync(src("app-icons/nonon-app-icon-32.png"), pub("favicon-32.png"));
copyFileSync(src("app-icons/nonon-app-icon-180.png"), pub("apple-touch-icon.png"));
copyFileSync(src("app-icons/nonon-app-icon-192.png"), pub("icon-192.png"));
copyFileSync(src("app-icons/nonon-app-icon-512.png"), pub("icon-512.png"));
copyFileSync(src("fonts/OFL.txt"), pub("fonts/NUNITO-OFL.txt"));

// ---- Non (3D poses): crop to the figure, 1x and 2x, avif + webp ----
mkdirSync(pub("img/non"), { recursive: true });
const keepNon = new Set();
for (const n of NON) {
  // The clean copies already have transparent edges, so the crop needs no alpha fix-up.
  const cropped = await sharp(join(siteRoot, n.src)).ensureAlpha().extract(n.box).raw().toBuffer({ resolveWithObject: true });
  const widths = n.widths ?? [n.box.width, n.box.width * 2];
  const files = { avif: [], webp: [] };
  for (const w of widths) {
    const img = sharp(cropped.data, { raw: cropped.info }).resize({ width: w, kernel: "lanczos3" });
    await img.clone().webp({ quality: 86, alphaQuality: 90, effort: 6 }).toFile(pub(`img/non/${n.name}-${w}.webp`));
    await img.clone().avif({ quality: 62, effort: 6 }).toFile(pub(`img/non/${n.name}-${w}.avif`));
    files.avif.push(`/img/non/${n.name}-${w}.avif ${w}w`);
    files.webp.push(`/img/non/${n.name}-${w}.webp ${w}w`);
    keepNon.add(`${n.name}-${w}.webp`).add(`${n.name}-${w}.avif`);
  }
  generated[n.name] = {
    ...n,
    width: n.box.width,
    height: n.box.height,
    src: `/img/non/${n.name}-${widths[0]}.webp`,
    sources: [
      { type: "image/avif", srcset: files.avif.join(", ") },
      { type: "image/webp", srcset: files.webp.join(", ") },
    ],
  };
}
for (const f of readdirSync(pub("img/non"))) {
  if (/\.(webp|avif|png)$/.test(f) && !keepNon.has(f)) rmSync(pub(`img/non/${f}`));
}

// ---- real app screenshots ----
mkdirSync(pub("img/app"), { recursive: true });
const stale = new Set();
for (const s of SHOTS) {
  const input = join(shotsDir, s.src);
  if (!existsSync(input)) throw new Error(`screenshot not found: ${input}`);
  const meta = await sharp(input).metadata();
  const srcset = [];
  for (const w of s.widths) {
    const out = `img/app/${s.name}-${w}.webp`;
    await sharp(input).resize({ width: Math.min(w, meta.width), kernel: "lanczos3" }).webp({ quality: 80, effort: 6 }).toFile(pub(out));
    srcset.push(`/${out} ${w}w`);
    stale.add(out);
  }
  const mid = s.widths[Math.floor(s.widths.length / 2)];
  generated[s.name] = {
    ...s,
    width: mid,
    height: Math.round((meta.height * mid) / meta.width),
    src: `/img/app/${s.name}-${mid}.webp`,
    sources: [{ type: "image/webp", srcset: srcset.join(", ") }],
    sourceFile: s.src,
  };
}
// Remove screenshot files from an older configuration so nothing stale ships.
for (const f of readdirSync(pub("img/app"))) {
  if (f.endsWith(".webp") && !stale.has(`img/app/${f}`)) rmSync(pub(`img/app/${f}`));
}

writeFileSync(join(siteRoot, "scripts", "images.generated.json"), JSON.stringify(generated, null, 2) + "\n");

// ---- og.png (1200x630): sharp + SVG shapes; text is Nunito set from static instances made by build-font.mjs ----
const ogFonts = process.env.NONON_FONT_SCRATCH ?? "E:/nonon-dev/og-fonts";
const fontBlack = join(ogFonts, "Nunito-Black.ttf");
const fontBold = join(ogFonts, "Nunito-Bold.ttf");
if (!existsSync(fontBlack) || !existsSync(fontBold)) throw new Error("Run `node scripts/build-font.mjs` first (og.png needs the static Nunito instances).");

async function text(markup, font, fontfile, width, dpi = 144) {
  return sharp({ text: { text: markup, font, fontfile, width, dpi, rgba: true, wrap: "word" } }).png().toBuffer();
}

const W = 1200;
const H = 630;
const nonOg = readFileSync(src("motion/non-idle.svg"), "utf8").replace(/<style>[\s\S]*?<\/style>/, "").replace(/<title>[\s\S]*?<\/title>/, "").replace(/<ellipse class="non-talk-mouth"[^>]*\/>/, "").replace(/<g class="non-thought-dots"[\s\S]*?<\/g>/, "");
const nonPng = await sharp(Buffer.from(nonOg), { density: 300 }).resize({ height: 340 }).png().toBuffer();
const nonMeta = await sharp(nonPng).metadata();
const logoPng = await sharp(src("logos/nonon-logo-horizontal-color.svg"), { density: 300 }).resize({ height: 56 }).png().toBuffer();
const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <circle cx="930" cy="318" r="262" fill="#FFF1E8"/>
  <circle cx="930" cy="318" r="262" fill="none" stroke="#F47B32" stroke-width="4" stroke-dasharray="3 14" stroke-linecap="round"/>
  <rect x="0" y="${H - 14}" width="${W}" height="14" fill="#111111"/>
  <rect x="0" y="${H - 14}" width="240" height="14" fill="#F47B32"/>
</svg>`);
const headline = await text('<span foreground="#111111" size="37pt" line_height="0.98">Finish everyday work with your own files.</span>', "Nunito Black", fontBlack, 620);
const subline = await text('<span foreground="#595959" size="15pt">The AI works on your computer, so it keeps working when the internet doesn&apos;t.</span>', "Nunito Bold", fontBold, 560);
const headMeta = await sharp(headline).metadata();
await sharp(bg)
  .composite([
    { input: logoPng, left: 72, top: 60 },
    { input: headline, left: 72, top: 176 },
    { input: subline, left: 72, top: 176 + headMeta.height + 36 },
    { input: nonPng, left: Math.round(930 - nonMeta.width / 2), top: Math.round(318 - nonMeta.height / 2) },
  ])
  .png({ compressionLevel: 9 })
  .toFile(pub("og.png"));

console.log("assets built:", Object.keys(generated).join(", "));
