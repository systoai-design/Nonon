// One place that decides which pictures the site shows. build-assets.mjs makes the files,
// build-pages.mjs turns {{img:<name>}} in pages/ into <picture> markup using the entries below.
// Swap a screenshot or the Non art by editing this file, then run both scripts.

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const siteRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const shotsDir = join(siteRoot, "..", "docs", "project", "screenshots");

// Non as the static 3D render poses, from the FITTED set (brand/derived/non-*-fit.png): one shared
// 325x461 frame with the character centred horizontally, the feet on y=392, headroom above, and a soft
// ground shadow that fades to nothing before every edge (no visible box). The pack's own PNGs sit in the
// lower right of a padded square and carry faint shadow pixels out to the border. Never crop or offset these:
// centre the whole frame. The animated face on the pages is inline SVG, not these.
export const NON = [
  {
    name: "non-rest",
    src: "brand-src/mascots/non-rest-fit.png",
    box: { left: 0, top: 0, width: 325, height: 461 },
    widths: [325],
    alt: "Non, standing quietly.",
    class: "non-img",
    sizes: "200px",
    loading: "lazy",
  },
  {
    name: "non-wave",
    src: "brand-src/mascots/non-wave-fit.png",
    box: { left: 0, top: 0, width: 325, height: 461 },
    widths: [325],
    alt: "Non, a small round black character with an orange ring around its middle, waving hello.",
    class: "non-img",
    sizes: "200px",
    loading: "lazy",
  },
  {
    name: "non-success",
    src: "brand-src/mascots/non-success-fit.png",
    box: { left: 0, top: 0, width: 325, height: 461 },
    widths: [325],
    alt: "Non, jumping with both arms up and its eyes closed in a smile.",
    class: "non-img",
    sizes: "200px",
    loading: "lazy",
  },
];

// Real screenshots of the app only. Never a mockup or a concept image.
// Widths are CSS-pixel sources for srcset (the originals are 1360 wide, so 1360 is the 2x of 680).
export const SHOTS = [
  {
    name: "shot-hero",
    src: "brand2-12-success-results-panel.png",
    widths: [680, 1020, 1360],
    alt: "The NONON window after comparing two spreadsheets. The results panel says the two files differ by PHP 2,565.60, with 19 matched pairs, 4 rows only in the first file, 5 only in the second, 1 listed twice and 3 not sure.",
    class: "shot-img",
    sizes: "(min-width: 1200px) 1118px, 92vw",
    loading: "eager",
    fetchpriority: "auto",
  },
  {
    name: "shot-step1",
    src: "brand2-04-onboarding-folder.png",
    widths: [560, 1120],
    alt: "The NONON setup step Pick a folder to work in, with the choices Use my own folder and Try sample files.",
    class: "shot-img",
    sizes: "(min-width: 1024px) 700px, 92vw",
    loading: "lazy",
  },
  {
    name: "shot-step2",
    src: "brand2-10-clarifying-question.png",
    widths: [560, 1120],
    alt: "Non asks a few questions before comparing: whether to treat the amounts as the same, which dates to compare, and how far apart amounts and dates can be, each with a suggested answer.",
    class: "shot-img",
    sizes: "(min-width: 1024px) 700px, 92vw",
    loading: "lazy",
  },
  {
    name: "shot-step3",
    src: "brand2-13-review-panel.png",
    widths: [560, 1120],
    alt: "The Changes to check panel: one change is waiting for your OK, with a before and after view of the two columns it would add.",
    class: "shot-img",
    sizes: "(min-width: 1024px) 700px, 92vw",
    loading: "lazy",
  },
];
