# Website redesign evidence (trynonon.xyz, pass 3)

Date: 2026-10-10. Scope: everything under `site/`, plus `docs/project/reuse-inventory.md`. Nothing was deployed, committed, or
changed in Cloudflare, DNS or R2. All numbers below were measured against `wrangler dev` on `http://127.0.0.1:8801` (my own
process; it does not compress, so sizes were taken with `gzip -9`). Screenshots: `docs/project/screenshots/site3-*.png`.

## 1. What the reference is, and how it was measured

Reference: https://www.trypragma.xyz/ (live) and its source `E:\New Claude\pragma-mac-wt\site\` @ 7d506dd6. The live site runs the
same files as the source (same scripts, same CSS custom properties), so the source is ground truth and the live page was used to
confirm it: headless Chromium at 1440x900 and 390x844, computed styles, a type census, section rects, and
`ScrollTrigger.getAll()` (35+ triggers). Reference frames were read, then NOT copied into the site.

| Property | Pragma (measured at 1440) | NONON (measured at 1440) |
|---|---|---|
| Display font, weight | Inter Tight 800 | Nunito 900 (brand font) |
| Hero headline | 135px, line 116px, tracking -7.85px (-.058em) | 82px, line 79px, tracking -3.7px (-.045em); Nunito is wider, so smaller in size and looser in tracking |
| Section headline | 73px / 72px, -3.4px | 70.6px / 70.6px, -2.8px |
| Body | 17px / 27px, Inter 400 | 17.5px / 28px, Nunito 500 |
| Kicker | 12.8px, 600, +.04em, dash before | 12.8px, 800, +.07em, orange dash before |
| Section padding | 140 to 216px, uneven | 158.4px, identical on every home section (one token) |
| Grounds | #F4F4F6 / #FFFFFF alternating, no borders between sections | #F4F4F4 / #FFFFFF alternating, no borders between sections |
| Page gutter | clamp(20px, 4.4vw, 56px); max width 1240 | the same token and max width |
| Nav | fixed pill, 56px tall, 1180 max, blur surface after 16px scroll, sliding marker on the section in view | same: 1180 x 56, radius 999, blur at 16px, sliding marker |
| Primary button | 54px, pill, orange fill, inner highlight, sheen on hover, scale .955 on pointer-down | 56px, pill, black fill (brand), inner highlight, sheen on hover, scale .955 on pointer-down |
| Radii | 10 / 16 / 24 / 36 | 10 / 16 / 24 / 36 |
| Shadows | three, soft, tall blur | three, same structure, ink at 5 to 42 percent |
| Hero | pinned for 1.7 viewport heights, copy leaves, window rises in 3D, 3D team flies in | pinned for 1.5, copy leaves, window rises (rotationX 16 to 0, scale .92 to 1); Non fades out instead of flying (see limits) |
| Section order | hero, why (ink-in), smarter, compare, film, roster, features, engines marquee, local, faq, download | hero, statement (ink-in), jobs (list + profile), control (promises + live demo), where it runs (switch), how (pinned), who (marquee + not yet), faq, download |

Pragma elements deliberately NOT carried: its orange-on-cream palette, Inter, every mascot and screenshot, the 3D team (three.js),
Lenis smooth scroll, the film, the compare tabs, and all Pragma copy.

## 2. Animation inventory (GSAP 3.15.0 + ScrollTrigger, all inside `gsap.matchMedia()`)

| Where | What | Trigger | Properties | Notes |
|---|---|---|---|---|
| Hero headline | each word rises out of its own mask; highlighter bars draw under "your own files." | page load, CSS animation | transform | CSS, not GSAP, so the largest text paints without waiting for the script (LCP 0.18 s desktop) |
| Hero rest | news pill, lede, download options, facts rise and fade in, 80 ms stagger | load timeline | transform, opacity | `expo.out`, 1 s |
| Non (hero) | disc and ring scale in, Non rises, speech bubble pops, three file chips float in; Non greets for 2 s (brand `greeting` state), then idles (breath + blink, brand CSS) | load timeline | transform, opacity | "Hi, I'm Non." cycles three lines on click or tap, with a hop |
| Non (pointer) | Non leans toward the pointer, the chips drift the other way | pointermove (fine pointers only) | `quickTo` x, y | stage rectangle measured once per refresh, never in the handler |
| Chips | slow bob | after intro, paused when the hero is off screen | y | |
| Hero pin | copy leaves, Non leaves, app window rises with 3D tilt, caption fades in | scrub .8, pin 1.5 viewports, wide screens only | transform, opacity | below 1024px wide or 640px high: the window just fades in under the hero |
| Statement | every word inks from 46 percent to full as you read | scrub .6, `top 78%` to `bottom 52%` | opacity | floor kept at 3:1 so it is legible before it inks in |
| Headlines | words rise out of masks | once, `top 88%` | transform, opacity | `already past` guard shows them as done after a reload or #link |
| Reveals and stagger groups | rise and fade | once, `top 90%` / `86%` | transform, opacity | |
| Comparison numbers | 38 / 4 / 5 / 1 / 3 and the 2,565.60 gap count up from zero | once, when the jobs block is 75 percent up, and again when Compare is picked | text only | final numbers are in the HTML; they are the real run on test files |
| Job list | sliding marker follows the choice | change | x, y, width, height of an absolutely placed marker | radio inputs do the switching, so it works with no script |
| Nav | sliding marker on the section in view | IntersectionObserver | x, width | |
| How it works | window changes per step, step text highlights, 3 steps over 2.2 viewports | ScrollTrigger pin, progress thirds | opacity, translate, scale via CSS classes | click a step to scroll to it |
| Marquee | two rows drift apart; scroll speed pushes them (timeScale up to 6, decays) | scroll velocity | xPercent | paused when off screen; without motion it is a wrapped, readable list |
| Approval demo | 4 states (waiting, left alone, done, undone) with the three promises highlighting in step | click | opacity, translate | Non shows the brand `success` cue on "Done"; labelled as a demonstration |
| Internet switch | dark wipe opens from the switch, statuses change | click | `clip-path` (the one exception to transform and opacity; on click only, 0.95 s) | |
| Download panel | Non peeks over the panel edge, stands up and greets when you reach for a download option | pointerenter / focus | transform (CSS) | |
| Buttons | scale .955 on pointer-down, sheen on hover | pointer | scale, translate | the magnetic lean code exists but the three download cards no longer use it |
| Tiles | pointer lamp follows the cursor | pointermove, rAF throttled | one CSS variable pair | |

Reduced motion (`prefers-reduced-motion: reduce`): `boot.js` never adds `motion`; `matchMedia` removes it if the setting changes while open.
Measured: 0 elements hidden, 1 inline transform (the job list marker position, which is placement, not animation), CLS 0,
0 frames over 20 ms. Non is a static smiling face (brand rule) and the dashed ring and beacon stop. Frames:
`site3-reduced-motion-1440.png`. With scripts off: everything visible, and the job tabs, accordion and menu still work
(`site3-nojs-home-1440-full.png`; lower images are blank there only because the screenshot tool does not scroll lazy images in).
Animation proof frames: `site3-anim-hero-entrance-1440.png` (0.1 s to 2.6 s after load), `site3-anim-hero-pin-scrub-1440.png`
(six scroll positions through the pin), `site3-anim-scroll-moments-1440.png` (ink-in, job list, how-it-works steps).

## 3. Smoothness, layout shift, weight (measured)

Headless Chromium at 1440x900, 768x1024 and 375x812, a wheel scroll through the whole page (about 2000 frames), CPU throttled 4x on the
small viewports, frame times from `requestAnimationFrame`, layout shifts and long tasks from `PerformanceObserver`.

| Viewport | CPU | CLS | LCP | Frames over 20 ms | Frames over 50 ms | Worst frame | Long tasks (load + scroll) |
|---|---|---|---|---|---|---|---|
| 1440x900 | 1x | 0 | 0.18 s | 0 of 1998 | 0 | 16.8 ms | 1 (54 ms) |
| 1440x900 | 4x | 0 | 0.70 s | 0 of 1998 | 0 | 16.8 ms | 4 (558 ms total, almost all at load under a 4x throttle) |
| 768x1024 | 4x | 0 | 0.83 s | 0 | 0 | 16.8 ms | 3 (350 ms) |
| 375x812 | 4x | 0 | 0.88 s | 0 | 0 | 16.8 ms | 3 (411 ms) |
| 1440x900, reduced motion | 1x | 0 | n/a | 0 | 0 | n/a | n/a |

Bugs found by these checks and fixed: (a) `overflow: hidden` on the pinned steps container made Chrome report a layout shift of 1.0
at the start and end of the pin (isolated by toggling single rules; fixed by removing it); (b) the count-up changed the width of a
sentence (0.0001, fixed with a reserved width); (c) the download page's phone note and the "Matches this computer" tag added height
after the script ran (0.007, fixed: note appended to the reserved line, tag absolutely placed).
No `will-change` is set anywhere; GSAP promotes layers only while a tween runs. No layout is read inside a ticker or a pointermove
handler (the stage caches one rectangle on refresh). Headless frame times do not prove smoothness on a phone GPU, only that the main
thread is idle during scroll. Real-device scrolling was not tested.

JavaScript on the home page, gzip -9: gsap 28.3 KB + ScrollTrigger 18.0 KB + home.js 4.6 KB + site.js 1.1 KB + boot.js 0.4 KB = **52.4 KB**
(under the 60 KB budget, so no lazy loading of ScrollTrigger was needed). CSS gzip: base 5.8 KB, home 8.5 KB, inner 2.7 KB. Font: one
woff2, 38 KB, preloaded. No third-party request, no cookie, no inline script or style; the CSP is unchanged and the console is clean
(the only message on any page is the expected 404 for `/nothere`).

## 4. Lighthouse 13.5.0 (system Chrome, headless; mobile = default throttling, desktop = desktop preset)

| Page | Form | Performance | Accessibility | Best practices | SEO | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| / | mobile | 99 | 100 | 100 | 100 | 2.0 s | 20 ms | 0 |
| / | desktop | 100 | 100 | 100 | 100 | 0.5 s | 0 ms | 0 |
| /download | mobile | 100 | 100 | 100 | 100 | 1.5 s | 0 ms | 0 |
| /download | desktop | 100 | 100 | 100 | 100 | 0.4 s | 0 ms | 0 |
| /status | mobile | 100 | 100 | 100 | 100 | 1.5 s | 0 ms | 0 |
| /status | desktop | 100 | 100 | 100 | 100 | 0.4 s | 0 ms | 0 |

A first run scored Accessibility 96 on `/` because the unread words of the inking statement were at 16 percent opacity; the floor is now
46 percent (3.1:1 for large text). The scores come from the local server without edge compression, so a real deploy should do at least as well.
JSON: `E:\nonon-dev\lh\site3\`. (The /download mobile run was repeated after the last layout-shift fix; the others were taken one edit earlier,
which only touched the 404 page, the marquee fallback and the download page.)

## 5. Other checks

- `node scripts/build-font.mjs`, `build-assets.mjs`, `build-js.mjs`, `build-pages.mjs`: all run clean.
- `npx html-validate public/*.html`: no errors.
- `npx tsc --noEmit`: clean. `npx wrangler deploy --dry-run --outdir dist`: succeeds (55 asset files, bindings DOWNLOADS and ASSETS); `dist` removed after.
- `node scripts/check-downloads.mjs http://127.0.0.1:8801`: **31 passed, 0 failed** (the local simulated R2 holds version 0.1.0 with a Windows exe of
  101 MiB and a Mac dmg of 114 MiB; the live manifest in R2 was not touched).
- Worker: `/api/latest`, `/dl/*`, the security headers and the CSP are unchanged. One line added: `/vendor/` gets the 30-day cache like `/fonts/`.

### Equal gutters and a spacing scale (375 / 768 / 1440)

Measured in the browser for `/`, `/download`, `/status`, `/privacy`, `/licenses` at the three widths. Left gutter equals right gutter to 0.6px
everywhere, there is one gutter value per width on every page and every section (20px, 33.8px, 156px), and no page overflows horizontally.
Home sections all use `--section` (158.4px at 1440, 88px at 375 and 768); inner pages use `--section-sm`. One spacing scale is defined in
`base.css` (`--sp-1` to `--sp-9`) and used for gaps and card padding.

### Non placement

- Hero Non (animated brand SVG): measured centre of the figure against the centre of its disc: 0 px across, 4 to 9 px below at first (the ring base is
  heavy); moved up so it sits within 2 percent. Motion origin is the figure's own 75 percent line from the brand CSS; the hop and lean move the button,
  not the SVG internals, so the figure never shifts between states. `data-paused` stops the loop when it is off screen or the tab is hidden.
- 3D poses (404 page, licences credit): the FITTED set `non-*-fit.png` (one 325x461 frame, character centred, soft shadow fading before every edge).
  Containers centre the whole frame; the 404 page is centre-aligned. No clipped container or drop-shadow filter sits behind any Non.
  Checked in `site3-404-*.png` and `site3-licenses-*.png`.

### Three download options

Hero, final call to action, footer ("Get NONON") and /download all show exactly three options: Windows, Mac, "GitHub (public repository)" with
"Source code on GitHub. Read, build or fork NONON. Free and open source, Apache 2.0.", the link going to https://github.com/systoai-design/Nonon
in a new tab with `rel="noopener"`. The option for this computer is the filled card; GitHub is never the default. They stack to one column at
720px and below with equal 12px gaps (`site3-home-375-sheet.png`, `site3-download-375.png`). /download shows file name, size, version and SHA-256
for Windows and Mac (from the manifest) and the repo URL and licence for GitHub. Also added: nav link "GitHub", FAQ "Is it open source?", JSON-LD
`codeRepository` (type is now SoftwareApplication and SoftwareSourceCode), the licences, status and privacy pages.

## 6. Honest limits

- **The repository is private for now**, so the GitHub link may 404, and the lines saying the code is public (home FAQ, /status, /licenses, /download)
  are only true once Kyle makes it public. Do not publish the site before then.
- The hero does not fly Non into the window the way Pragma flies its 3D team into the sidebar: the real screenshot would be covered. Non leaves with
  the copy. Pragma's Lenis smooth scroll and three.js stage were not carried (weight; native scroll is also kinder to TBT).
- Real-device scrolling, Safari and Firefox were not tested (Chromium only). The internet switch uses `clip-path` and the nav arrow is a Unicode
  character; both fall back to a plain colour change and the system symbol font.
- Screenshots used are `brand2-*` (newer branding). The `visuals/` mockups from the brand pack are not used anywhere.
- `NOTICE` was not edited (another workstream owns it): the GSAP and Pragma-site reuse is logged in `docs/project/reuse-inventory.md` and on `/licenses`;
  the lead should mirror it in NOTICE.
- The status page facts are unchanged. Wording about the source code was added; no feature status was altered.

## 7. Contrast (`node scripts/contrast.mjs`, exit code 0)

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| Body text on white | #111111 | #ffffff | 18.88:1 | 4.5:1 | pass |
| Body text on grey ground | #111111 | #f4f4f4 | 17.17:1 | 4.5:1 | pass |
| Secondary text (--text-2) on white | #595959 | #ffffff | 7.00:1 | 4.5:1 | pass |
| Secondary text (--text-2) on grey ground | #595959 | #f4f4f4 | 6.37:1 | 4.5:1 | pass |
| Tertiary text (--text-3) on white | #6b6b6b | #ffffff | 5.33:1 | 4.5:1 | pass |
| Tertiary text (--text-3) on grey ground | #6b6b6b | #f4f4f4 | 4.85:1 | 4.5:1 | pass |
| Soft headline half on white (large text) | #888888 | #ffffff | 3.54:1 | 3:1 | pass |
| Soft headline half on grey ground (large text) | #838383 | #f4f4f4 | 3.45:1 | 3:1 | pass |
| Unread words in the inking statement (large text) | #929292 | #ffffff | 3.11:1 | 3:1 | pass |
| Dark orange text (--orange-ink) on white | #a84208 | #ffffff | 6.09:1 | 4.5:1 | pass |
| Dark orange text on grey ground | #a84208 | #f4f4f4 | 5.54:1 | 4.5:1 | pass |
| Dark orange text on orange wash (status pill, tag) | #a84208 | #fff1e8 | 5.51:1 | 4.5:1 | pass |
| White text on black button and card | #ffffff | #111111 | 18.88:1 | 4.5:1 | pass |
| White text on button hover (#2B2B2B) | #ffffff | #2b2b2b | 14.16:1 | 4.5:1 | pass |
| Light grey sub-text on the filled download card | #d2d2d2 | #111111 | 12.49:1 | 4.5:1 | pass |
| Grey text on the filled card hover | #d2d2d2 | #2b2b2b | 9.36:1 | 4.5:1 | pass |
| Bright orange arrow on black button (icon) | #f47b32 | #111111 | 6.95:1 | 3:1 | pass |
| Bright orange icon on the black job tile | #f47b32 | #111111 | 6.95:1 | 3:1 | pass |
| Bright orange on white: decorative dash, dot and ring only, carries no meaning (2.72 is below 3, so never text or an icon) | #f47b32 | #ffffff | 2.72:1 | 1:1 | pass |
| Ink on orange wash highlight bar region | #111111 | #fff1e8 | 17.08:1 | 4.5:1 | pass |
| Offline section: body on black | #f4f4f4 | #111111 | 17.17:1 | 4.5:1 | pass |
| Offline section: secondary text on black | #c9c9c9 | #111111 | 11.40:1 | 4.5:1 | pass |
| Offline section: tertiary text on black | #a6a6a6 | #111111 | 7.76:1 | 4.5:1 | pass |
| Offline section: tertiary text on its card | #a6a6a6 | #1b1b1b | 7.08:1 | 4.5:1 | pass |
| Offline section: green status on its card | #4cc38a | #1b1b1b | 7.78:1 | 4.5:1 | pass |
| Offline section: red status on its card | #ff8f85 | #1b1b1b | 7.81:1 | 4.5:1 | pass |
| Online section: green status on white card | #1f7a4d | #ffffff | 5.32:1 | 4.5:1 | pass |
| Light orange link on black (Not yet box) | #ffb88a | #111111 | 11.22:1 | 4.5:1 | pass |
| Status pill: Works | #17603c | #e7f4ec | 6.68:1 | 4.5:1 | pass |
| Status pill: Works, with limits | #a84208 | #fff1e8 | 5.51:1 | 4.5:1 | pass |
| Status pill: Built, not fully tested | #595959 | #ffffff | 7.00:1 | 4.5:1 | pass |
| Focus ring (dark orange) on white | #a84208 | #ffffff | 6.09:1 | 3:1 | pass |
| Focus ring on grey ground | #a84208 | #f4f4f4 | 5.54:1 | 3:1 | pass |
| Ground tone against white (section edge, informational) | #f4f4f4 | #ffffff | 1.10:1 | 1:1 | pass |
