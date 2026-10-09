// WCAG 2.x contrast for every colour pair the site uses. Run: node scripts/contrast.mjs
// Ratios come from the tokens in public/assets/base.css; the soft headline tone is the ink at 50% over the ground
// (mixed in sRGB here, which is within a point of the browser's oklab mix).
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (fg, bg, a) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, "0")).join("");
const soft = (bg) => mix("#111111", bg, 0.5);
const inkIn = mix("#111111", "#ffffff", 0.46);

// [what, foreground, background, needed]
const pairs = [
  ["Body text on white", "#111111", "#ffffff", 4.5],
  ["Body text on grey ground", "#111111", "#f4f4f4", 4.5],
  ["Secondary text (--text-2) on white", "#595959", "#ffffff", 4.5],
  ["Secondary text (--text-2) on grey ground", "#595959", "#f4f4f4", 4.5],
  ["Tertiary text (--text-3) on white", "#6b6b6b", "#ffffff", 4.5],
  ["Tertiary text (--text-3) on grey ground", "#6b6b6b", "#f4f4f4", 4.5],
  ["Soft headline half on white (large text)", soft("#ffffff"), "#ffffff", 3],
  ["Soft headline half on grey ground (large text)", soft("#f4f4f4"), "#f4f4f4", 3],
  ["Unread words in the inking statement (large text)", inkIn, "#ffffff", 3],
  ["Dark orange text (--orange-ink) on white", "#a84208", "#ffffff", 4.5],
  ["Dark orange text on grey ground", "#a84208", "#f4f4f4", 4.5],
  ["Dark orange text on orange wash (status pill, tag)", "#a84208", "#fff1e8", 4.5],
  ["White text on black button and card", "#ffffff", "#111111", 4.5],
  ["White text on button hover (#2B2B2B)", "#ffffff", "#2b2b2b", 4.5],
  ["Light grey sub-text on the filled download card", "#d2d2d2", "#111111", 4.5],
  ["Grey text on the filled card hover", "#d2d2d2", "#2b2b2b", 4.5],
  ["Bright orange arrow on black button (icon)", "#f47b32", "#111111", 3],
  ["Bright orange icon on the black job tile", "#f47b32", "#111111", 3],
  ["Bright orange on white: decorative dash, dot and ring only, carries no meaning (2.72 is below 3, so never text or an icon)", "#f47b32", "#ffffff", 1],
  ["Ink on orange wash highlight bar region", "#111111", "#fff1e8", 4.5],
  ["Offline section: body on black", "#f4f4f4", "#111111", 4.5],
  ["Offline section: secondary text on black", "#c9c9c9", "#111111", 4.5],
  ["Offline section: tertiary text on black", "#a6a6a6", "#111111", 4.5],
  ["Offline section: tertiary text on its card", "#a6a6a6", "#1b1b1b", 4.5],
  ["Offline section: green status on its card", "#4cc38a", "#1b1b1b", 4.5],
  ["Offline section: red status on its card", "#ff8f85", "#1b1b1b", 4.5],
  ["Online section: green status on white card", "#1f7a4d", "#ffffff", 4.5],
  ["Light orange link on black (Not yet box)", "#ffb88a", "#111111", 4.5],
  ["Status pill: Works", "#17603c", "#e7f4ec", 4.5],
  ["Status pill: Works, with limits", "#a84208", "#fff1e8", 4.5],
  ["Status pill: Built, not fully tested", "#595959", "#ffffff", 4.5],
  ["Focus ring (dark orange) on white", "#a84208", "#ffffff", 3],
  ["Focus ring on grey ground", "#a84208", "#f4f4f4", 3],
  ["Ground tone against white (section edge, informational)", "#f4f4f4", "#ffffff", 1],
];
console.log("| Pair | Foreground | Background | Ratio | Needs | Result |");
console.log("|---|---|---|---|---|---|");
let failed = 0;
for (const [what, fg, bg, need] of pairs) {
  const r = ratio(fg, bg);
  const ok = r >= need;
  if (!ok) failed++;
  console.log(`| ${what} | ${fg} | ${bg} | ${r.toFixed(2)}:1 | ${need}:1 | ${ok ? "pass" : "FAIL"} |`);
}
if (failed) process.exitCode = 1;
