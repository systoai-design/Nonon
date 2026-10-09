# Site rebrand and landing page: evidence

Date: 2026-10-09. Workstream: LANDING PAGE. Nothing was deployed, no DNS or R2 bucket created, no `wrangler login` run.
Everything below was run against `wrangler dev --port 8799` with the LOCAL simulated R2 (the real `NONON-0.1.0-win-x64.exe`, 106 MB, from `app/release/`; the Mac file was a 120 MB random-bytes STAND-IN, so the Mac size and checksum in the screenshots are not a real build).

## What changed
- New look: black and white, orange accents, Nunito (self-hosted latin variable woff2, 39 KB, preloaded, `font-display: swap`). All sage green, the pebble mascot and system-font stacks are gone.
- Home page rebuilt: header, hero (Non waving, platform-detected buttons, real screenshot), three jobs, "You stay in charge", 3 steps, who it is for plus "Not yet", 8 FAQ, final download call. `/download`, `/status`, `/privacy`, `/licenses` and 404 restyled on the same partials.
- Worker routes `/api/latest` and `/dl/*` and the security headers are unchanged. Only addition in `src/worker.ts`: cache lifetimes for `/fonts/`, `/brand/` and the new icon files.
- Build: `scripts/build-pages.mjs` (now also expands `{{icon:x}}`, `{{img:x}}`, `{{dlgroup}}`), `scripts/build-assets.mjs` (favicons, Non art, screenshots, `og.png`), `scripts/images.config.mjs` (which pictures show), `scripts/icons.mjs`, `scripts/contrast.mjs`. Removed: `scripts/og.html`, the concept images, `partials/pebble.html`.
- Dependencies added in `site/`: `@fontsource-variable/nunito` (the font file), `@fontsource/nunito` (dev only, for og.png text). Lighthouse and html-validate were installed OUTSIDE the repo, in `E:\nonon-dev\tools`.

## Screenshots used (all real, from `docs/project/screenshots/`)
| Slot | File | Where |
|---|---|---|
| Hero | `brand-12-success-results-panel.png` | under the hero |
| Step 1, Pick a folder | `brand-04-onboarding-folder.png` | How it works |
| Step 2, Tell Non | `brand-10-clarifying-question.png` | How it works |
| Step 3, Check and approve | `brand-13-review-panel.png` | How it works |

No concept PNG or mockup is used anywhere. WebP at 680/1020/1360 (hero) and 560/1120 (steps), `width` and `height` set, hero eager, steps lazy.

## Stand-ins (swap by file replacement)
Non art: `public/img/non/pip-{wave,rest,cele}.png`, copied byte for byte (SHA-256 in `PROVENANCE.md`), cropped and converted to AVIF and WebP at 1x/2x. Logo mark: `public/brand/non-face.svg`, drawn to match Pip's face; the official "B / Pip Face" file is NOT on this PC (`E:\New Claude\Nonon\brand\` did not exist). Favicons, `apple-touch-icon.png` and `og.png` are generated from that mark. The credit line "Non is the Pragma mascot Pip, used with permission of its owner." is in every footer and on `/licenses`.

## Contrast (WCAG 2.x, `node scripts/contrast.mjs`)
| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| Body text | #1c1917 | #ffffff | 17.49:1 | 4.5:1 | pass |
| Soft text on white | #44403c | #ffffff | 10.27:1 | 4.5:1 | pass |
| Faint text on white (footer legal, dates) | #57534e | #ffffff | 7.63:1 | 4.5:1 | pass |
| Soft text on warm section | #44403c | #faf7f4 | 9.62:1 | 4.5:1 | pass |
| Faint text on warm section | #57534e | #faf7f4 | 7.15:1 | 4.5:1 | pass |
| Links and eyebrow: deep orange on white | #c2410c | #ffffff | 5.18:1 | 4.5:1 | pass |
| Deep orange link on warm section | #c2410c | #faf7f4 | 4.85:1 | 4.5:1 | pass |
| Deep orange link on orange wash (note box) | #c2410c | #fff1e7 | 4.68:1 | 4.5:1 | pass |
| Dark orange text on white (eyebrow, tags) | #9a3412 | #ffffff | 7.31:1 | 4.5:1 | pass |
| Dark orange on orange wash ("Works, with limits" pill) | #9a3412 | #fff1e7 | 6.61:1 | 4.5:1 | pass |
| White text on black button | #ffffff | #111111 | 18.88:1 | 4.5:1 | pass |
| White text on button hover | #ffffff | #2a2623 | 15.00:1 | 4.5:1 | pass |
| White text on deep orange (if used as a button) | #ffffff | #c2410c | 5.18:1 | 4.5:1 | pass |
| Black text on outline button hover (orange wash) | #111111 | #fff1e7 | 17.07:1 | 4.5:1 | pass |
| Bright orange as text on white (NOT used for text) | #f47b32 | #ffffff | 2.72:1 | 4.5:1 | fail, so never used |
| Bright orange icon on white (decorative, beside text) | #f47b32 | #ffffff | 2.72:1 | 3:1 | below 3:1, see note |
| Bright orange arrow on black button | #f47b32 | #111111 | 6.95:1 | 3:1 | pass |
| Bright orange dot on black status pill | #f47b32 | #111111 | 6.95:1 | 3:1 | pass |
| Bright orange icon on warm section | #f47b32 | #faf7f4 | 2.55:1 | 3:1 | below 3:1, see note |
| Focus ring black on white | #111111 | #ffffff | 18.88:1 | 3:1 | pass |

Note: bright orange `#F47B32` is used only for icons and drawing that sit next to a text label, so they are decorative. It is never used for text or for a control. Anything read or pressed uses `#C2410C` or `#9A3412`; buttons are black with white text and an orange arrow.

## Verification
| Check | Command | Result |
|---|---|---|
| Pages build | `node scripts/build-pages.mjs` | 6 pages built, no unreplaced tokens |
| Types | `npx tsc --noEmit` | clean |
| Bundle | `npx wrangler deploy --dry-run --outdir dist` | OK, DOWNLOADS (R2) and ASSETS bindings |
| Download API | `node scripts/check-downloads.mjs http://127.0.0.1:8799` (local R2 seeded per DEPLOY.md) | 31 of 31 PASS, "ALL PASSED" |
| HTML | `html-validate`, recommended preset, all 6 built pages | 0 problems (it caught one empty heading, fixed) |
| Overflow | puppeteer-core full-page shots at 375, 768, 1440 on 5 pages | scrollWidth minus clientWidth = 0 on all 15 |
| Platform detection | Mac user agent and default | Mac button first on home; Mac card highlighted and scrolled to on `/download#mac`; links point at `/dl/...`; no console errors |
| Manifest missing | deleted local `latest.json` | home buttons fall back to `/download#...`; `/download` shows "Downloads open soon" |
| Phone user agent | built-in browser, mobile emulation | "NONON is for Windows and Mac computers..." note; no overflow at 375 |
| Reduced motion | screenshots with `prefers-reduced-motion: reduce` | all content visible; reveal is CSS only |
| Third-party requests | Lighthouse network list | own origin only; no cookies |
| Em dashes, non-ASCII in sources | node scan of pages, partials, assets, scripts, worker | none |

### Lighthouse 13.5 (Chrome, local wrangler dev). Scores are Performance / Accessibility / Best Practices / SEO
| Page | Mobile | Desktop | LCP mobile / desktop | CLS mobile / desktop |
|---|---|---|---|---|
| `/` | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | 1.5 s / 0.5 s | 0.018 / 0.013 |
| `/download` | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | 1.5 s / 0.3 s | 0.049 / 0 |
| `/status` | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | 1.3 s / 0.3 s | 0 / 0 |

Home transfer: 67 KB without the hero screenshot (HTML 7, font 39, CSS 6, JS 2, Non AVIF 10, logo 1, favicon 1, API 1), plus 28 KB (mobile) or 89 KB (desktop) for the hero screenshot. Lazy images below the fold add about 20 KB each when scrolled to.

A first Lighthouse run found layout shift on `/download` (0.22 desktop). Cause: the file list appeared after the fetch and the Windows and Mac cards swapped places. Fix: the cards and the check block are always in the page with fixed-height placeholders, the "matches this computer" badge is absolutely positioned, and on wide screens the matching card is highlighted instead of moved.

## Not done or not proven
- Not deployed. The real edge (compression, custom domain, www redirect) is untested.
- A real Mac installer and its notarization flag were not tested (stand-in file).
- The Windows installer is not signed; the SmartScreen note shows because the manifest has no `signed: true`.
- Final logo, Nunito files and icon set are stand-ins until the brand pack arrives.
- Safari and Firefox were not run. Scroll reveal uses `animation-timeline: view()` and simply does not animate where unsupported.
- Status page rows come from the build-log evidence; the Mac and 8/16 GB rows are conservative on purpose.
