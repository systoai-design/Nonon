# Brand pass evidence: NONON, Non, black, white and orange

Date: 2026-10-09. Workstream: app rebrand. I checked for `E:\New Claude\Nonon\brand\` at the start and again at the end. It does not exist yet, so everything below uses the stand-ins listed near the end.

## What changed

- Palette: green and sage are gone. Tokens live in `app/src/renderer/src/styles.css`.
  - Ink `#111111`, white, canvas `#FAFAFA`, sidebar `#F4F4F4`, borders `#E3E3E3` and `#D4D4D4`, muted text `#5C5C5C`.
  - `--brand` `#F47B32`: illustration, active-nav marker, count badge, working dot, send arrow. Never used for text (2.7:1 on white).
  - `--accent` `#C2410C` (5.18:1 on white): primary buttons with white text, orange text, links, selected borders, focus ring, progress bar. Hover `#9A3412`.
  - Attention surfaces: `#FFF3E8` tint with an icon and a text label. Red `#B42318` only for errors.
  - Done and ready chips are neutral grey with a black check icon. Status dots are black (ok), orange with a ring (cloud, attention) and grey (pending).
- Deviation from the brief: it said to keep the variable names and re-point the values. I renamed instead, because `--green` holding orange would mislead the next reader. `green`, `amber` and `blue` became `ok`/`accent`, `attn` and `info` in CSS variables and class names (`chip-ok`, `chip-attn`, `chip-info`, `notice-*`, `task-*`, `dot-*`). Every use was updated mechanically across the renderer; no component logic changed.
- Font: Nunito (variable, OFL) from `@fontsource-variable/nunito`, in `devDependencies` like every other renderer dependency, imported in `main.tsx`. Headings 700 to 800, body 450 to 650, mono unchanged. Checked in the running app: body, headings, buttons and the wordmark all compute to "Nunito Variable"; mono is `ui-monospace`.
- Non: one `Non` component (`components/Non.tsx`) replaces the four SVG blobs. Art is in `assets/non/`: originals byte-for-byte, prepared crops next to them, `PROVENANCE.md`, and one `index.ts` that names the files. The soft floor shadow is trimmed to the area under Non so it never reads as a grey box.
- Onboarding step 1 is "Meet Non": one honest, data-driven character (`components/companions.ts`) plus the line "Non is the only helper for now. More may come later." No fake catalogue and no disabled placeholder cards. Settings "Your helper" shows the same single character.
- Sidebar header: Non avatar, "NONON" wordmark (Nunito 800, letter-spacing 0.2em) and a live status line. The same wordmark is in the onboarding title.
- Defaults: `companionName` "Non", `character` "non". `CompanionCharacter` is widened additively. `main/settings-migrate.ts` moves saved `pebble|moss|ember|tide` to `non` on load, and the old default names ("Your companion", Pebble, Moss, Ember, Tide) to "Non". A name the person typed is kept. It is persisted on first load and unit tested.
- Streaming: `chat:delta` `{workspaceId, entryId, text}` (the new piece only) is emitted by the chat service through `InferenceClient.chat({onToken})`. The final `chat:entry` with the same id carries the whole reply and ends the stream. New `chat:stop` aborts routing or streaming and keeps what was written. The Send button becomes an accessible Stop button while a reply is in flight. Reasoning blocks are never streamed.
- Icon: `build/icon.svg` and `build/icon.png` (1024, transparent corners) use the ORIGINAL face art from `pip-rest.png` (cropped, not redrawn) on a white rounded tile with an orange disc. Sizes are in `build/icons/` (16, 32, 48, 180, 512) and `resources/tray/` (16, 32). The tray now loads the 16 px PNG plus the 32 px copy as the 2x image through `nativeImage` (it was a drawn sage disc). Scripts: `scripts/prepare-non-art.py`, `scripts/make-icon-svg.py`, `scripts/make-icon.cjs`, `scripts/make-icon-sizes.py`. `electron-builder.yml` is unchanged: `build/icon.png` still resolves and `resources/` already ships as extra resources.
- Fixed after reading the screenshots: disabled buttons have a grey fill with readable text (they were 50% opacity); the always-on "Keep backup copies" tick is a black tick instead of a faded native checkbox; the sidebar status line wraps instead of truncating; the `|` separator in the location line was 1.4:1 and is now muted text; your chat bubbles are ink with white text.

## Contrast (computed, WCAG 2.x)

Computed with a small script (relative luminance, `(L1+0.05)/(L2+0.05)`) for every text and background pair introduced, plus the non-text pairs that carry meaning. 0 failures. The "decorative / exempt" rows are listed for honesty: brand orange is only used where a label or shape carries the meaning.

| Pair | Foreground | Background | Ratio | Needs | Result |
| --- | --- | --- | --- | --- | --- |
| Body text on cards, dialogs, inputs | `#111111` | `#FFFFFF` | 18.88:1 | 4.5:1 | pass |
| Body text on page canvas | `#111111` | `#FAFAFA` | 18.09:1 | 4.5:1 | pass |
| Sidebar text and nav labels | `#111111` | `#F4F4F4` | 17.17:1 | 4.5:1 | pass |
| Muted text on cards | `#5C5C5C` | `#FFFFFF` | 6.69:1 | 4.5:1 | pass |
| Muted text on page canvas (helper lines, stamps) | `#5C5C5C` | `#FAFAFA` | 6.41:1 | 4.5:1 | pass |
| Muted text on sidebar (status line, Projects heading) | `#5C5C5C` | `#F4F4F4` | 6.08:1 | 4.5:1 | pass |
| Muted text on panels | `#5C5C5C` | `#F5F5F5` | 6.13:1 | 4.5:1 | pass |
| Muted text on orange tint | `#5C5C5C` | `#FFF3E8` | 6.13:1 | 4.5:1 | pass |
| Secondary text inside notices and chips | `#4D4D4D` | `#F5F5F5` | 7.75:1 | 4.5:1 | pass |
| Lead paragraph | `#333333` | `#FAFAFA` | 12.10:1 | 4.5:1 | pass |
| Orange text: links, selected labels, btn-link | `#C2410C` | `#FFFFFF` | 5.18:1 | 4.5:1 | pass |
| Orange text on page canvas | `#C2410C` | `#FAFAFA` | 4.96:1 | 4.5:1 | pass |
| Orange text/icons on orange tint (starter icons, Suggested tag) | `#C2410C` | `#FFF3E8` | 4.74:1 | 4.5:1 | pass |
| Orange text on sidebar grey (active nav icon area) | `#C2410C` | `#F4F4F4` | 4.71:1 | 4.5:1 | pass |
| Primary button: white on functional orange | `#FFFFFF` | `#C2410C` | 5.18:1 | 4.5:1 | pass |
| Primary button hover: white on dark orange | `#FFFFFF` | `#9A3412` | 7.31:1 | 4.5:1 | pass |
| Attention chip and banner text on orange tint | `#9A3412` | `#FFF3E8` | 6.69:1 | 4.5:1 | pass |
| Warn check icon and text on white | `#9A3412` | `#FFFFFF` | 7.31:1 | 4.5:1 | pass |
| Ink on orange tint (banner body, selected cards) | `#111111` | `#FFF3E8` | 17.30:1 | 4.5:1 | pass |
| Your message bubble: white on ink | `#FFFFFF` | `#111111` | 18.88:1 | 4.5:1 | pass |
| Send button arrow: brand orange on ink | `#F47B32` | `#111111` | 6.95:1 | 3:1 | pass |
| Count badge: ink on brand orange | `#111111` | `#F47B32` | 6.95:1 | 4.5:1 | pass |
| Done and ready chips: ink on light grey | `#111111` | `#ECECEC` | 15.98:1 | 4.5:1 | pass |
| Neutral chip: ink on light grey | `#111111` | `#F1F1F1` | 16.72:1 | 4.5:1 | pass |
| Disabled buttons: muted on grey (not required, kept readable) | `#5C5C5C` | `#EBEBEB` | 5.61:1 | 4.5:1 | pass |
| Disabled ghost button and disabled tab text on page | `#6E6E6E` | `#FAFAFA` | 4.89:1 | 4.5:1 | pass |
| Disabled send button icon on grey | `#5C5C5C` | `#EBEBEB` | 5.61:1 | 4.5:1 | pass |
| Error chip text on red tint | `#912018` | `#FDECEA` | 7.58:1 | 4.5:1 | pass |
| Error text and Stop icon on white | `#912018` | `#FFFFFF` | 8.66:1 | 4.5:1 | pass |
| Stop button text on red tint | `#912018` | `#FDECEA` | 7.58:1 | 4.5:1 | pass |
| Error toast: white on dark red | `#FFFFFF` | `#8E1F17` | 8.90:1 | 4.5:1 | pass |
| Toast: white on ink | `#FFFFFF` | `#111111` | 18.88:1 | 4.5:1 | pass |
| Starter card file icons: spreadsheet | `#C2410C` | `#FFFFFF` | 5.18:1 | 3:1 | pass |
| Starter card file icons: documents | `#3D3D3D` | `#FFFFFF` | 10.86:1 | 3:1 | pass |
| Starter card file icons: other files | `#6B6B6B` | `#FFFFFF` | 5.33:1 | 3:1 | pass |
| Sidebar nav icons | `#3D3D3D` | `#F4F4F4` | 9.88:1 | 3:1 | pass |
| Placeholder text in the composer | `#5C5C5C` | `#FFFFFF` | 6.69:1 | 4.5:1 | pass |
| Non-text: text field and composer border | `#8C8C8C` | `#FFFFFF` | 3.36:1 | 3:1 | pass |
| Non-text: switch track when off | `#8C8C8C` | `#FAFAFA` | 3.22:1 | 3:1 | pass |
| Non-text: selected card border | `#C2410C` | `#FFFFFF` | 5.18:1 | 3:1 | pass |
| Non-text: selected card border on tint | `#C2410C` | `#FFF3E8` | 4.74:1 | 3:1 | pass |
| Non-text: focus ring on page | `#C2410C` | `#FAFAFA` | 4.96:1 | 3:1 | pass |
| Non-text: focus ring on sidebar | `#C2410C` | `#F4F4F4` | 4.71:1 | 3:1 | pass |
| Non-text: progress bar fill on its track | `#C2410C` | `#E3E3E3` | 4.03:1 | 3:1 | pass |
| Non-text: pending status dot on page | `#9A9A9A` | `#FAFAFA` | 2.70:1 | n/a | decorative / exempt |
| Non-text: report bar, matched (ink) on track | `#111111` | `#F5F5F5` | 17.32:1 | 3:1 | pass |
| Non-text: report bar, only in A (brand) on track | `#F47B32` | `#F5F5F5` | 2.49:1 | n/a | decorative / exempt |
| Non-text: report bar, only in B on track | `#9A3412` | `#F5F5F5` | 6.70:1 | 3:1 | pass |
| Non-text: report bar, listed twice on track | `#8C8C8C` | `#F5F5F5` | 3.08:1 | n/a | decorative / exempt |
| Not used for text: brand orange on white (icons and illustration only) | `#F47B32` | `#FFFFFF` | 2.72:1 | n/a | decorative / exempt |
| Decorative: card border on white | `#E3E3E3` | `#FFFFFF` | 1.28:1 | n/a | decorative / exempt |
| Decorative: strong card border on white | `#D4D4D4` | `#FFFFFF` | 1.48:1 | n/a | decorative / exempt |

### Measured in the real app

`auditContrast` in `E:\nonon-dev\e2e\brand.mjs` walks every visible text node in the running Electron window, composites its colour over the real ancestor backgrounds, and applies 4.5:1 (3:1 for large text). Result of the last full run: 0 text elements below threshold on every screen.

| Screen | Text elements checked | Below threshold |
| --- | --- | --- |
| Onboarding step 1 | 9 | 0 |
| Onboarding step 2 | 14 | 0 |
| Onboarding step 4 | 16 | 0 |
| Home | 39 | 0 |
| Conversation with reply | 23 | 0 |
| Results panel and task card | 214 | 0 |
| Review panel | 220 | 0 |
| Settings: Your helper / Projects / Changes and backups / Advanced | 28 / 30 / 32 / 41 | 0 |
| Connections | 68 | 0 |
| Routines | 23 | 0 |

The first audit found one failure (the decorative `|` separator, 1.42:1). It was fixed and re-run. After that run I also darkened the disabled-control greys (`#767676` to `#6E6E6E`, disabled send icon to `#5C5C5C`); those states were not on screen during the audit, so their ratios are the computed ones above. The audit sees flat colours only (no gradients, no text inside images).

## Non: animation state to real event map

Implemented in `lib/companion.ts` (hook `useShellMood`, a store for composer typing, one-shot timers) and `styles.css` (keyframes only: no rAF, no library). The shell computes the mood once and shares it by context; the sidebar, Home and the empty conversation show it. Small avatars beside past messages are still (`still`). Priority when several apply: success, talking, thinking, listening, greeting, idle.

| State | Art | Real trigger | Ends when | Text next to the avatar |
| --- | --- | --- | --- | --- |
| idle | rest, slow bob and an occasional squash | nothing else applies | n/a | "Non is ready" |
| greeting | wave, one hop | first time a project is shown in a session; onboarding opens | 1.8 s timer, cleared on unmount | "Hi, I'm Non" |
| listening | rest, leans toward the input | Composer `onChange` with text while focused | 2.5 s without a key, blur, send or unmount | "Non is listening" |
| thinking | rest, slow tilt | any project has a task in `inspecting`, `running`, `validating` or `applying` (from `task:list` and `task:updated`) | no active task is left | "Non is working on it" |
| talking | rest, small rhythmic bounce | first `chat:delta` for a reply | final `chat:entry` with that id; or `chat:send` settles (any error); or `chat:stop` | "Non is writing a reply" |
| success | cele, one hop | `task:updated` from running, waiting or clarifying to `review` or `complete`; `change:updated` to `applied` | 2.2 s timer | "Done" |

Reduced motion (`settings.reducedMotion` adds `html.reduced-motion`; `prefers-reduced-motion` goes through the same rules): every animation and transition is off and the lean is removed. The art still swaps (wave, celebrate) and the text still changes. Hidden window: `App.tsx` sets `html[data-hidden]` from `visibilitychange`, and CSS pauses the Non loops, the spinner, the working dot, the typing dots and the bar. Listeners and timers: the composer typing timer, the one-shot timers and the task and change subscriptions are all cleared on unmount.

### Observed in the real Electron app with the real local model

State log from a MutationObserver on the sidebar avatar (milliseconds since page load), one session:

```
greeting "Hi, I'm Non"            13044   first project shown
idle                              13663
listening                         18683   typing in the composer
idle                              22769   2.5 s without a key
talking "Non is writing a reply"  27963   first chat:delta of a real model reply
idle                              28614   final chat:entry (the reply streamed for about 0.65 s)
thinking "Non is working on it"   42651   Compare two spreadsheets running
success "Done" (cele art)         45463   task reached review
idle                              47662
success "Done"                    52342   a change was applied
```

Also logged in the same run: reduced motion on gives `getAnimations().length === 0`, `animation-name: none`, `transform: none`. The simulated hidden window gives `html[data-hidden=true]` and `animation-play-state: paused`, and `running` again when visible.

## Verification run

- `npx vitest run` in `app/`: 40 files passed, 10 skipped; 684 tests passed, 33 skipped (673 before; new: settings migration 4, chat streaming and stop 5, statusFor 2).
- `npx tsc -p tsconfig.node.json --noEmit` and `npx tsc -p tsconfig.web.json --noEmit`: both clean.
- `pnpm build` from `app/` (ELECTRON_CACHE=E:\electron-cache): builds. The Nunito woff2 files and the three Non PNGs are emitted into `out/renderer/assets`. No installer was built.
- Real Electron app, not a localhost page: `E:\nonon-dev\e2e\brand.mjs` (Playwright-electron, args `[APP, --user-data-dir=E:\nonon-dev\ud-brand]`, `NONON_DATA_DIR=E:\nonon-dev\e2e-data-b`, `NONON_MODEL_DIR=E:\nonon-dev\install-test`), viewport 1360x860. Part A uses an empty model dir (download offer). Logs: `E:\nonon-dev\e2e\brand-log-A.txt` and `brand-log-B.txt`. Kyle's installed app at `E:\NONON` was never touched; the script only closes the Electron it launched (`app.close()`).
- Tray: loaded `resources/tray/tray-16.png` plus the 32 px copy as the 2x representation with `nativeImage` in Electron: not empty, 16x16 logical, scale factors 1 and 2. It was not looked at in the real system tray.

Screenshots (`docs/project/screenshots/brand-*.png`, each one read after capture): `01` onboarding welcome (wave) and `01b` idle, `02` purpose, `03` setup ready, `04` folder, `a1` to `a5` (empty model dir: welcome, download offer, Home with the AI not ready, waiting task, setup dialog), `05` Home with starter cards (and greeting), `05c` Good to know, `06` conversation, `07` listening, `08` talking while a real reply streams, `09` reply finished, `10` clarifying question, `11` thinking (task running), `12` success and results panel, `13` review panel, `13b` change applied, `14` Settings (five tabs), `15` Connections, `16` Routines and new routine, `17` reduced motion on, `18` and `18b` 1000 px wide, `19` 880 px (collapsed sidebar).

## Contract and dependency edits

- `shared/contracts.ts`: `CompanionCharacter` gains `"non"` (old values stay valid).
- `shared/ipc.ts`: new channel `chat:stop`, new event `chat:delta`, new exported type `ChatDelta`.
- `main/services/types.ts`: `ChatService.stop(workspaceId)`.
- Dependency: `@fontsource-variable/nunito` (devDependencies, OFL). `pnpm add` also pruned packages that nothing references from `node_modules`; tests, typecheck and build all pass after it.
- Docs: NOTICE (Non's origin, Nunito OFL) and `reuse-inventory.md` (art bullet) were appended to.

## What remains a stand-in

- Mascot art: the original Pragma Pip renders, shown as Non. Replace the four `non-*.png` files in `assets/non/` (same names, transparent background) when the pack arrives; nothing else names them. The three poses assume one shared crop box.
- Logo and app icon: the face is composited from the original `pip-rest.png` on a white tile with an orange disc. It is not Kyle's "B / Pip Face" SVG. The face is upscaled about 2.9x from a 560 px render, so the large icon is soft.
- Fonts: Nunito from npm. The pack's own font files, motion controller, icon set, five rebranded mockups, `NONON-BRAND-GUIDE.md` and `NONON-MOTION-INTEGRATION.md` were not read because the folder is missing.
- Icons in the UI are still lucide-react outlines.
- `site/` (trynonon.xyz) was not touched and may still carry the old look.

## Not verified, or only partly

- Talking was caught live with the real local model. The router sometimes turns a chat message into a job; the reply is then templated and does not stream, so the script retries with other messages.
- The Stop button is visible in screenshot 08. Clicking it in the real app was not tested (a reply finishes in under a second). Stop is covered by a service test with a fake streaming client (mocked).
- The hidden-window check drives the app's own `visibilitychange` handler by overriding `document.hidden`; minimising the window did not flip `document.hidden` in this harness.
- macOS was not run. The Windows high-contrast mode and 200% zoom were not checked.

---

# Official brand pack swap (2026-10-10)

Kyle's brand pack (`brand/NONON-brand-pack-v1/`) replaced every stand-in in the app. Site work was out of scope for this pass (another workstream owns `site/`; nothing under `site/` was edited by this workstream).

## What was replaced

| Stand-in | Now | Where |
| --- | --- | --- |
| Pragma Pip crops and `pip-*.png` | pack mascots (fitted copies, one shared 325 x 461 frame) for the still poses; the pack's native 2D SVG face with the pack's six states for the animated companion | `assets/non/`, `components/Non.tsx`, `lib/non-controller.ts` (port of `non-controller.js`), rules from `non-motion.css` in `styles.css` |
| Text wordmark and drawn sage disc | `logos/` SVGs: horizontal color in the title strip and onboarding, stacked color in About | `components/TitleStrip.tsx`, `onboarding/Onboarding.tsx`, `views/settings/AboutSection.tsx`, `assets/brand/` |
| Stand-in app icon | pack app icon: `build/icon.png` (1024), `build/icon.ico` (16/32/48/256), `build/icon.svg`, `build/icons/*` (16, 32, 48, 180, 512), tray `resources/tray/tray-16.png` and `tray-32.png`; the window icon still loads `build/icon.png`; `electron-builder.yml` Windows icon is now `build/icon.ico` (macOS builds its icns from the 1024 PNG) | `app/build`, `app/resources/tray` |
| `@fontsource-variable/nunito` | pack `Nunito-Variable.ttf` and italic converted to WOFF2 (fontTools + brotli in `E:\nonon-dev\venv-fonts`), self-hosted with `OFL.txt`; dependency removed with `pnpm remove` | `assets/fonts/`, `@font-face` in `styles.css`, `NOTICE` |
| lucide icons | brand set (33 glyphs inlined from `nonon-sprite.svg`, generated into `components/icons-data.ts`) wherever the catalog has an equivalent; `components/Icon.tsx` | all views |
| old green/orange token set | pack tokens verbatim as `--nonon-*`; every older variable is now an alias | `styles.css` |

Icons kept from lucide because the brand set has no equivalent: spinner, arrows (right, left), sparkles, briefcase, calculator, hourglass, clock, external link, copy, wider/narrower, share, cloud, refresh, power, stethoscope, history, flask, hard drive, memory, panel collapse/expand. Nothing new was drawn.
Not used from the pack: the white and black logo variants, the domain lockups, `nonon-wordmark-*` (no dark surface or marketing page in the app), `nonon-logo-animated.svg`, the six standalone `non-*.svg` files (their markup is identical apart from `data-state`, so one inline face serves all six states), `app-icons` PNG sizes other than the ones above, the maskable icons (no PWA), `icons/png-48` and `svg-accessible/` (same shapes; the accessible orange is applied through `--nonon-orange-ink`), `motion-preview.html`, the video previews, `references/`, `docs/`.

## Token map

Pack token, then the alias or use. `--nonon-ink #111111` = `--ink`, primary button fill; `--nonon-white` = `--bg`, `--card`; `--nonon-surface #FAFAFA` = `--sidebar`, title strip; `--nonon-muted #595959` = `--muted`;
`--nonon-border #DADADA` = `--line`, `--line-strong`; `--nonon-orange #F47B32` = `--brand` (logo, count badge, the sliding bar; never text); `--nonon-orange-ink #A84208` = `--accent`, `--accent-ink`, `--attn`, `--attn-ink` (links, selected labels, functional icons, focus ring);
`--nonon-orange-soft #FFF1E8` = `--accent-soft`, `--attn-soft` (selection wash); `--nonon-radius 12px` = `--radius-control`; cards 16 px (`--radius`), composer 20 px, per `nonon-tokens.json`.
Derived and not in the pack: `--tint #F5F5F5` (hover, bubbles, table heads, notices: the pack surface is too faint there), `--control-line #8C8C8C` (text field and composer edge, 3.36:1; the pack border is 1.4:1 and would fail 1.4.11), `--accent-line #F6C6A3`, red tokens for errors.
Type follows the guide: body 16 px weight 500, secondary 14 px, labels and buttons 700 to 800, page headings 900 at 30 to 32 px, section headings 22 px; tabular numbers in tables.
Buttons are black with white text; the send button is black with a white glyph; the logo orange is never used for white text.

## Contrast (computed, WCAG 2.x), pairs that changed

| Pair | Foreground | Background | Ratio | Needs | Result |
| --- | --- | --- | --- | --- | --- |
| Body text on canvas and cards | `#111111` | `#FFFFFF` | 18.88:1 | 4.5:1 | pass |
| Body text on sidebar and title strip (pack surface) | `#111111` | `#FAFAFA` | 18.09:1 | 4.5:1 | pass |
| Body text on neutral tint (bubbles, table heads, notices) | `#111111` | `#F5F5F5` | 17.32:1 | 4.5:1 | pass |
| Body text on orange wash (selected nav, chips, cards) | `#111111` | `#FFF1E8` | 17.08:1 | 4.5:1 | pass |
| Muted text on canvas and cards | `#595959` | `#FFFFFF` | 7.00:1 | 4.5:1 | pass |
| Muted text on sidebar (status line, Projects heading) | `#595959` | `#FAFAFA` | 6.71:1 | 4.5:1 | pass |
| Muted text on neutral tint | `#595959` | `#F5F5F5` | 6.42:1 | 4.5:1 | pass |
| Muted text on orange wash | `#595959` | `#FFF1E8` | 6.34:1 | 4.5:1 | pass |
| Orange text (links, selected labels, tags): pack orange-ink on white | `#A84208` | `#FFFFFF` | 6.09:1 | 4.5:1 | pass |
| Orange text on sidebar and strip | `#A84208` | `#FAFAFA` | 5.84:1 | 4.5:1 | pass |
| Orange text on orange wash | `#A84208` | `#FFF1E8` | 5.51:1 | 4.5:1 | pass |
| Orange text on neutral tint | `#A84208` | `#F5F5F5` | 5.59:1 | 4.5:1 | pass |
| Primary button: white on ink | `#FFFFFF` | `#111111` | 18.88:1 | 4.5:1 | pass |
| Primary button hover: white on #2B2B2B | `#FFFFFF` | `#2B2B2B` | 14.16:1 | 4.5:1 | pass |
| Send button glyph: white on ink | `#FFFFFF` | `#111111` | 18.88:1 | 3:1 | pass |
| Count badge: ink on logo orange | `#111111` | `#F47B32` | 6.95:1 | 4.5:1 | pass |
| Not used for text: logo orange on white (icons/illustration only) | `#F47B32` | `#FFFFFF` | 2.72:1 | n/a | decorative / exempt |
| Not used for text: logo orange on sidebar | `#F47B32` | `#FAFAFA` | 2.60:1 | n/a | decorative / exempt |
| Functional icons: orange-ink on white | `#A84208` | `#FFFFFF` | 6.09:1 | 3:1 | pass |
| Functional icons: orange-ink on orange wash (icon tiles, nav active) | `#A84208` | `#FFF1E8` | 5.51:1 | 3:1 | pass |
| Functional icons: orange-ink on sidebar | `#A84208` | `#FAFAFA` | 5.84:1 | 3:1 | pass |
| Selection outline and focus ring: orange-ink on canvas | `#A84208` | `#FFFFFF` | 6.09:1 | 3:1 | pass |
| Focus ring on sidebar | `#A84208` | `#FAFAFA` | 5.84:1 | 3:1 | pass |
| Text field and composer border: #8C8C8C on white (kept darker than the pack border) | `#8C8C8C` | `#FFFFFF` | 3.36:1 | 3:1 | pass |
| Pack border #DADADA on white (cards and dividers only, never a control edge) | `#DADADA` | `#FFFFFF` | 1.40:1 | n/a | decorative / exempt |
| Title strip symbols (Windows caption glyphs) #111 on strip #FAFAFA | `#111111` | `#FAFAFA` | 18.09:1 | 3:1 | pass |
| Logo mark: logo orange on strip (decorative, wordmark carries the name) | `#F47B32` | `#FAFAFA` | 2.60:1 | n/a | decorative / exempt |
| Dark-surface mark: logo orange on ink (toast border) | `#F47B32` | `#111111` | 6.95:1 | 3:1 | pass |
| Active nav label: ink on orange wash | `#111111` | `#FFF1E8` | 17.08:1 | 4.5:1 | pass |
| Thinking dots (inside Non): #A84208 on white | `#A84208` | `#FFFFFF` | 6.09:1 | 3:1 | pass |

FAILS: 0

Measured in the real app by `auditContrast` (every visible text node, composited over its real backgrounds) after the swap, same run as the screenshots (`E:\nonon-dev\e2e\brand2.mjs`):

| Screen | Text elements checked | Below threshold |
| --- | --- | --- |
| onboarding step 1 | 9 | 0 |
| onboarding step 2 | 14 | 0 |
| onboarding step 4 | 16 | 0 |
| home | 39 | 0 |
| conversation with reply | 23 | 0 |
| results panel and task card | 214 | 0 |
| review panel | 220 | 0 |
| settings Your helper | 34 | 0 |
| settings Projects | 29 | 0 |
| settings Changes and backups | 31 | 0 |
| settings Advanced | 40 | 0 |
| connections | 67 | 0 |
| routines | 22 | 0 |

## Non: where it sits (pixel analysis in the real window)

`E:\nonon-dev\e2e\non-center.mjs` isolates each Non (everything else hidden), crops it with 25% padding, finds the pixels that differ strongly from the background (the black body and the orange belt; the faint ground shadow is excluded) and compares the centre of that box with the centre of Non's container. Limits: 4% horizontally, 8% vertically.

| Place | Container (px) | Character bbox centre offset x | y | Result |
| --- | --- | --- | --- | --- |
| onboarding-hero-art | 250 x 355 | +2.8% | +7.1% | pass |
| onboarding-face | 88 x 88 | -0.6% | +0.0% | pass |
| onboarding-picker-tile | 88 x 88 | +0.6% | +0.0% | pass |
| sidebar-avatar | 44 x 44 | -1.1% | -1.1% | pass |
| home-hero | 96 x 96 | -0.5% | +0.0% | pass |
| conversation-empty | 104 x 104 | -0.5% | +0.0% | pass |
| chat-avatar-still | 40 x 40 | -1.2% | +0.0% | pass |
| settings-helper-tile | 72 x 72 | +1.4% | +0.7% | pass |
failures: 0

The still art uses the fitted frame (character centred at x 167 of 325, body y 171 to 387). The full variant is shifted up 4% so the resting body sits near the middle of the frame; the airborne success pose is intentionally higher. The small square-window variant is centred on the resting body. The animated SVG viewBox was moved from `0 -8 256 272` to `0 -14 256 272` so the face (sprout top to belt bottom) is centred vertically.
Screenshots read: `brand2-non-centered-onboarding.png`, `-home.png`, `-conversation-empty.png`, `-chat.png`, `-settings.png`, `-about.png`.

## Spacing and margins (measured, not by eye)

One scale (4, 8, 12, 16, 24, 32 px) as `--s-1` to `--s-6`; one page gutter `--gutter` (32 px, 24 px at 900 CSS px and below); one centred column (`.col`, `.col-fixed`, max `--col-max` 960 px) shared by the top bar, the pages, the conversation and the composer, so their edges line up at every size.
Findings fixed: every view had its own `max-w` and `mx-auto` column plus a second page title under the top bar (two h1 per screen); Home used the scroller as its own column; the review dock sat under the top bar so the top bar and the page centred on different widths; scroll areas shifted content by the scrollbar width; the sidebar's avatar, heading and nav icons started at three different x positions and the divider stopped short of the highlight box; the onboarding form hugged the left of its pane.
The empty column on the right came from those separate centred columns plus the scrollbar reservation, and from the dock being a sibling of the content row only. Now the dock is a sibling of the whole column (top bar included), scrollers reserve the scrollbar on both edges (`scrollbar-gutter: stable both-edges`, 12 px custom scrollbar) and fixed rows add the same width as padding.
`E:\nonon-dev\e2e\margins.mjs` asserts, for onboarding, Home, a conversation (with a 110-character unbroken file name in a message), the conversation with the review panel open, Routines, Connections and Settings, at 960x640, 1280x820 and 1920x1000 and at screen sizes 0.9 and 1.1, plus a collapsed sidebar:
(1) content column left gutter equals right gutter within 1 px, top bar edges equal page edges, composer edges equal message edges; (2) sidebar avatar, heading and nav icons share one left edge, highlight box and divider span the same inner width; (3) no element wider than the window (clipped scrollers excluded), nothing but the strip in the caption-button band, top bar actions clear the caption buttons; (4) every vertical gap between consecutive sections is on the scale, and the strip-to-title space is 24 px.
Result: **397 of 397 checks passed, 0 failed.** Full output: `docs/project/04-build-log/margins-output.md`. Screenshots (native window capture): `docs/project/screenshots/brand2-margins-*.png`, read after capture.
Title strip: `--chrome` is `env(titlebar-area-height, 40px)` (45 CSS px at screen size 0.9, which is 40 DIP, the overlay height); strip colour `#FAFAFA` equals `WINDOW_CHROME.color` in `main/window-chrome.ts` (changed from `#f4f4f4`, both sides). A desktop capture of the real window (`E:\nonon-dev\e2e\caption.mjs`, `brand2-caption-strip.png`) shows the three caption buttons inside the strip, same colour, no gap or lighter box.
Known behaviour: below 1100 CSS px the dock overlays the right of the window including the top bar's "Changes to check" button; the dock's own close button closes it.

## Layout compared with the five visuals

Brought in line: split onboarding (surface panel with logo, tagline and the still pose; form on the right), sidebar (companion row, orange wash behind the active item, Routines, Connections and Settings grouped under a divider), header (large page title, device and file icons for the two locations), buttons (black primary, 12 px radius, 44 px height), cards (16 px, hairline border, no shadow), composer (20 px radius, attachment icon, black send), file chips and result cards (white, orange icon tile), chat bubbles (light grey for both sides).
Still different: the visuals show a 3D-style Non in the sidebar and in chat, NONON uses the animated 2D face there because the six states need it; the visuals show light input borders, NONON keeps the darker control edge (accessibility); the visuals show a "1 of 3" step and a pack picker on the first screen, NONON keeps its own four steps and strings (behaviour and copy unchanged); the review screen is NONON's own review panel in the right dock, not the visual's two-card page; Connections keeps its own card layout (no A/C/triangle provider letters); the visuals' "Sample workspace" captions are not shown.

Extra screen sizes: the same assertions at screen size 0.8 and 1.25 (960x640 and 1280x820): 258 of 258 passed (`docs/project/04-build-log/margins-extreme-output.md`, screenshots `brand2-margins-*-s08.png` and `-s125.png`, read: the composer stays visible and long file names wrap inside the bubble at 1.25 on 960x640).

## Summary sheet readability (2026-10-10)

The 46-character row splitting is gone from the workbook writer (`summary-text.ts` no longer has `wrap` or `WRAP_WIDTH`; `workbook.ts` writes each sentence as ONE cell). The first column of the Summary and About sheets is 70 characters wide and the sentence cells have `wrapText` on, so Excel shows them whole. The test "writes every sentence as ONE cell in a wide column that wraps" in `summary.test.ts` replaces the old wrap test.
The Results viewer (`results/PreviewBody.tsx`) now wraps any text cell longer than 36 characters (no ellipsis, up to 360 px wide; numbers stay on one line, right-aligned, header still sticky) and draws the sheets named Summary and About this comparison as a page: title, sentences that wrap at about 62 characters, headings with a gap above, label and value pairs in two columns. Real-window screenshots read: `brand2-results-summary-1280x820.png`, `-960x640.png`, `brand2-results-about-1280x820.png`, `-960x640.png`, `brand2-results-matched-*.png`, and the task card preview `brand2-results-inline-card-1280x820.png` (script `E:\nonon-dev\e2e\summary-view.mjs`). The tab underline now follows the active tab when the sheet tabs wrap onto a second row (it had stuck to the bottom row).
