// Stitches pages/*.html and partials/*.html into public/*.html.
// Plain string replacement on purpose: the site has six pages and no framework.
// Tokens: {{headcommon}} {{header}} {{footer}} {{dlgroup}}  {{cur:<page>}}  {{icon:<name>}}  {{img:<name>}}
//         {{non}} or {{non:<extra class>}}  (the inline Non face, see brand-src/motion)
// Attribute: data-split="mask" | "ink" on h1/h2/h3/p wraps every word in a span at build time, so the
// browser never has to re-wrap text when the animation script starts (no layout shift).
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ICONS } from "./icons.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const partial = (name) => read(`partials/${name}.html`).trimEnd();

const imagesFile = join(root, "scripts", "images.generated.json");
if (!existsSync(imagesFile)) throw new Error("Run `node scripts/build-assets.mjs` first (images.generated.json is missing).");
const images = JSON.parse(readFileSync(imagesFile, "utf8"));
const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll('"', "&quot;");

function picture(name) {
  const img = images[name];
  if (!img) throw new Error(`Unknown image {{img:${name}}}`);
  const sources = img.sources.map((s) => `<source type="${s.type}" srcset="${s.srcset}" sizes="${esc(img.sizes)}">`).join("");
  const attrs = [
    img.class ? `class="${img.class}"` : "",
    `src="${img.src}"`,
    `width="${img.width}"`,
    `height="${img.height}"`,
    `alt="${esc(img.alt)}"`,
    `loading="${img.loading ?? "lazy"}"`,
    'decoding="async"',
    img.fetchpriority && img.fetchpriority !== "auto" ? `fetchpriority="${img.fetchpriority}"` : "",
  ].filter(Boolean);
  return `<picture>${sources}<img ${attrs.join(" ")}></picture>`;
}

// The brand's idle Non, minus its embedded <style> (the CSP blocks inline styles; the same rules live
// in base.css under .non) and minus width/height (CSS sizes it from the viewBox).
const nonSource = read("brand-src/motion/non-idle.svg");
const nonInner = nonSource.replace(/^<svg[^>]*>/, "").replace(/<style>[\s\S]*?<\/style>/, "").replace(/<title>[\s\S]*?<\/title>/, "").replace(/<\/svg>\s*$/, "");
const non = (extra = "") =>
  `<svg class="non${extra ? ` ${extra}` : ""}" viewBox="0 -8 256 272" data-state="idle" aria-hidden="true" focusable="false">${nonInner}</svg>`;

function splitWords(inner, mode) {
  let i = 0; // word index inside this element, for the CSS-only hero entrance delay
  return inner
    .split(/(<[^>]+>)/)
    .map((part) => {
      if (part.startsWith("<")) return part;
      return part
        .split(/(\s+)/)
        .map((tok) => {
          if (!tok.trim()) return tok.length ? " " : "";
          const n = i++;
          return mode === "mask" ? `<span class="w" data-i="${n}"><span class="wi">${tok}</span></span>` : `<span class="w">${tok}</span>`;
        })
        .join("");
    })
    .join("");
}

function applySplit(html) {
  return html.replace(/<(h1|h2|h3|p)([^>]*?)\sdata-split="(mask|ink)"([^>]*)>([\s\S]*?)<\/\1>/g, (_, tag, a, mode, b, inner) => {
    return `<${tag}${a}${b} data-split="${mode}">${splitWords(inner, mode)}</${tag}>`;
  });
}

for (const file of readdirSync(join(root, "pages")).filter((f) => f.endsWith(".html"))) {
  const page = file.replace(/\.html$/, "");
  let html = read(`pages/${file}`);
  for (const name of ["headcommon", "header", "footer", "dlgroup"]) html = html.replaceAll(`{{${name}}}`, partial(name));
  html = html.replace(/\{\{cur:(\w+)\}\}/g, (_, name) => (name === page ? ' aria-current="page"' : ""));
  html = html.replace(/\{\{icon:([\w-]+)\}\}/g, (_, name) => {
    if (!ICONS[name]) throw new Error(`Unknown icon {{icon:${name}}} in ${file}`);
    return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
  });
  html = html.replace(/\{\{img:([\w-]+)\}\}/g, (_, name) => picture(name));
  html = html.replace(/\{\{non(?::([\w -]+))?\}\}/g, (_, extra) => non(extra ?? ""));
  html = applySplit(html);
  const left = html.match(/\{\{[^}]+\}\}/);
  if (left) throw new Error(`Unreplaced token ${left[0]} in ${file}`);
  writeFileSync(join(root, "public", file), html);
  console.log("built", file);
}
