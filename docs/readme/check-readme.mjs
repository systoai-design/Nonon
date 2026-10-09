// Checks README.md: relative links and images exist, in-page anchors resolve, images are light and
// have alt text, Mermaid blocks are present and balanced, and nothing personal or em-dash-like slipped in.
// Run from anywhere: node docs/readme/check-readme.mjs
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const MAX_BYTES = 400 * 1024;
const MAX_DISPLAY_WIDTH = 900;
const MAX_PIXEL_WIDTH = 1600;

const problems = [];
const fail = (msg) => problems.push(msg);

const fenceRe = /```[a-zA-Z]*\n[\s\S]*?```/g;
const mermaidBlocks = [...readme.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
const prose = readme.replace(fenceRe, "");

// GitHub-style heading anchors.
const slugs = new Map();
const anchors = new Set();
for (const line of prose.split("\n")) {
  const m = /^(#{1,6})\s+(.*)$/.exec(line);
  if (!m) continue;
  let text = m[2].replace(/<[^>]+>/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").trim();
  let slug = text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
  const n = slugs.get(slug) ?? 0;
  slugs.set(slug, n + 1);
  anchors.add(n === 0 ? slug : `${slug}-${n}`);
}

// Collect links and images.
const targets = [];
for (const m of prose.matchAll(/!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
  targets.push({ kind: m[0].startsWith("!") ? "md-image" : "md-link", alt: m[1], url: m[2] });
}
for (const m of prose.matchAll(/<img\b[^>]*>/g)) {
  const tag = m[0];
  const src = /src="([^"]*)"/.exec(tag)?.[1];
  const alt = /alt="([^"]*)"/.exec(tag)?.[1];
  const width = /width="(\d+)"/.exec(tag)?.[1];
  targets.push({ kind: "img", url: src, alt, width: width ? Number(width) : undefined, tag });
}
for (const m of prose.matchAll(/<a\b[^>]*href="([^"]*)"/g)) targets.push({ kind: "a", url: m[1] });

function pngWidth(file) {
  const b = readFileSync(file);
  if (b.length > 24 && b.toString("ascii", 1, 4) === "PNG") return b.readUInt32BE(16);
  return undefined;
}

let imageCount = 0;
const usedImages = new Set();
let relativeLinks = 0;
for (const t of targets) {
  if (!t.url) {
    fail(`${t.kind} without a target: ${t.tag ?? ""}`);
    continue;
  }
  const isImage = t.kind === "img" || t.kind === "md-image";
  if (isImage) {
    imageCount++;
    if (!t.alt || t.alt.trim().length < 15) fail(`image has missing or too-short alt text: ${t.url}`);
    if (t.kind === "img" && t.width !== undefined && t.width > MAX_DISPLAY_WIDTH) fail(`image displayed wider than ${MAX_DISPLAY_WIDTH}px: ${t.url}`);
    if (t.kind === "img" && t.width === undefined && !t.url.startsWith("https://img.shields.io/")) fail(`img without width attribute: ${t.url}`);
  }
  if (/^(https?:|mailto:)/i.test(t.url)) {
    if (isImage && !t.url.startsWith("https://img.shields.io/")) fail(`remote image other than a badge: ${t.url}`);
    continue;
  }
  if (t.url.startsWith("#")) {
    if (!anchors.has(t.url.slice(1))) fail(`anchor not found: ${t.url}`);
    continue;
  }
  relativeLinks++;
  const [pathPart, frag] = decodeURIComponent(t.url).split("#");
  const file = join(root, pathPart);
  if (!existsSync(file)) {
    fail(`missing target: ${t.url}`);
    continue;
  }
  if (frag && file.endsWith("README.md") && !anchors.has(frag)) fail(`anchor not found: ${t.url}`);
  if (isImage) {
    usedImages.add(pathPart);
    const size = statSync(file).size;
    if (size > MAX_BYTES) fail(`image over 400 KB (${Math.round(size / 1024)} KB): ${t.url}`);
    if (!pathPart.startsWith("docs/readme/")) fail(`image is not an optimised copy under docs/readme/: ${t.url}`);
    const w = pngWidth(file);
    if (w !== undefined && w > MAX_PIXEL_WIDTH) fail(`image wider than ${MAX_PIXEL_WIDTH}px (${w}): ${t.url}`);
  }
}

// Every image in docs/readme should be used.
for (const f of readdirSync(join(root, "docs", "readme"))) {
  if (/\.(png|webp|jpe?g|gif)$/i.test(f) && !usedImages.has(`docs/readme/${f}`)) fail(`unused image in docs/readme: ${f}`);
}

// Mermaid: cannot render here, so check the basics. Try the real parser when it is installed.
if (mermaidBlocks.length < 2) fail(`expected at least 2 mermaid blocks, found ${mermaidBlocks.length}`);
mermaidBlocks.forEach((b, i) => {
  if (!/^\s*(flowchart|graph|sequenceDiagram)\b/.test(b)) fail(`mermaid block ${i + 1} does not start with a diagram type`);
  const opens = (b.match(/\bsubgraph\b/g) ?? []).length;
  const ends = (b.match(/^\s*end\s*$/gm) ?? []).length;
  if (opens !== ends) fail(`mermaid block ${i + 1}: ${opens} subgraph vs ${ends} end`);
  for (const [a, z] of [["[", "]"], ["(", ")"], ["{", "}"]]) {
    if (b.split(a).length !== b.split(z).length) fail(`mermaid block ${i + 1}: unbalanced ${a}${z}`);
  }
  if ((b.match(/"/g) ?? []).length % 2) fail(`mermaid block ${i + 1}: odd number of quotes`);
});

// Text rules.
if (/\u2014/.test(readme)) fail("contains an em dash");
if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(readme)) fail("contains an email address");
if (/C:\\Users|\/Users\/[A-Za-z]|\/home\/[a-z]/.test(readme)) fail("contains a home path");
if (/(?=[A-Z0-9]{10})(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{10}/.test(readme)) fail("contains something that looks like an Apple team id");
for (const required of ["AppBuildersPH Hackathon", "716 passed, 33 skipped"]) {
  if (!readme.includes(required)) fail(`missing required text: ${required}`);
}

console.log(`README.md: ${readme.split("\n").length} lines, ${anchors.size} headings, ${imageCount} images, ${relativeLinks} relative targets, ${mermaidBlocks.length} mermaid blocks`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(" - " + p);
  process.exit(1);
}
console.log("All checks passed.");
