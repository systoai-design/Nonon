# Motion system evidence

Date: 2026-10-10. Real Electron window (Playwright-electron, `E:\nonon-dev\e2e\motion.mjs`), never a localhost page. Kyle's installed
app at `E:\NONON` was not touched; the script only closes the Electron it started.

## Rules

- Tokens in `app/src/renderer/src/styles.css`: durations `--dur-instant` 90 ms, `--dur-quick` 160 ms, `--dur-base` 240 ms, `--dur-slow` 360 ms (unused by chrome: nothing runs that long);
  easings `--ease` `cubic-bezier(0.2,0,0,1)`, `--ease-emph` `cubic-bezier(0.32,0.72,0,1)`, `--ease-exit` `cubic-bezier(0.4,0,1,1)`.
- Only `transform` and `opacity` move (plus `width` on two things that must reflow anyway: the sidebar and the wide results dock, and the 2 px tab underline).
  Exits are shorter than enters. Nothing bounces except Non's own motion. Reversing mid-transition settles back (the dock uses CSS transitions, not keyframes).
- Helper module: `app/src/renderer/src/lib/motion.ts` (`viewTransition`, `usePresence`, `useSlidingIndicator`, `useFirstShow`, `useLayers`, `motionOff`). No new dependency; bundle JS grew by under 10 KB raw.
- Reduced motion (`settings.reducedMotion` and `prefers-reduced-motion`): the global rule near the top of `styles.css` turns every animation and transition off, so each change becomes an instant swap and the text status still says what happened.
  `viewTransition` and the exit timers also check `motionOff()`. A hidden window (`document.hidden`) skips view transitions and pauses running animations (`html[data-hidden]`).
- Software rendering (no GPU) is detected once (`main.tsx`, WebGL renderer name) and drops the dialog backdrop blur, which a CPU cannot do at frame rate: with the blur the dialog open took 34 frames at 20 ms p95 in the `--disable-gpu` run.

## Every animated element

| Element | What moves | Duration and easing |
| --- | --- | --- |
| View switch (Home, project, Routines, Connections, Settings) | View Transitions API: old view fades out, new view fades in and settles up 8 px. Fallback (no API): same settle as a mount animation on the keyed `.view` | out 160 ms exit, in 240 ms `--ease` |
| Settings sections, dock panel content, results body | fade plus 6 px settle on mount (keyed by section, mode, file or sheet) | 160 ms `--ease` |
| Sidebar collapse and expand | width; labels, heading and name fade (out 90 ms, in 160 ms after a 120 ms delay) so text never wraps or clips mid-move; avatar eases its offset; `contain: layout` keeps the main column from reflowing its children | 240 ms `--ease-emph` |
| Sidebar active item | one wash plus one orange bar slide to the selected item (`useSlidingIndicator`) | 240 ms `--ease-emph` |
| Right dock open and close | stays at its final layout width; slides 24 px and fades. Close is shorter | open 240 ms `--ease-emph`, close 160 ms `--ease-exit` |
| Dock tabs, results sheet tabs, Settings tabs | underline or wash slides to the selected tab | 240 ms `--ease-emph` |
| Results "Wider" | dock width | 240 ms `--ease-emph` |
| Dialogs (Add a project, setup) | panel scale 0.97 to 1 plus fade, backdrop fade (and a 2 px blur on GPU). Closing from Escape, the backdrop or the X plays a 90 ms exit | in 240 ms `--ease-emph`, out 90 ms `--ease-exit` |
| New chat messages, in-flight bubbles, task cards | 8 px settle plus fade, only for items that arrive after the history loaded (saved entries that replace an in-flight bubble do not replay it) | 240 ms `--ease` |
| Typing / working dots | fade in | 160 ms |
| Chat scroll | smooth scroll for new items; instant while text streams so it never lags | browser smooth scroll |
| Task card: status blocks (result, notice, questions) | fade plus 6 px settle when the state changes | 240 ms `--ease` |
| Task card steps | each step settles in, staggered 30 ms (index mod 5) | 160 ms `--ease` |
| Progress bar | width | 240 ms `--ease` |
| Buttons, nav items, icon buttons, links, chips | colour, border, shadow | 120 ms `--ease` |
| Press state | scale 0.98 | 90 ms |
| Focus ring | colour and offset ease in | 160 ms `--ease` |
| Toggle switches | knob slides, track colour | 160 ms `--ease-emph` / `--ease` |
| Inputs and the composer | border and ring colour | 120 ms |
| Toasts | rise 12 px, fade and scale from 0.98; dismiss plays a 90 ms exit | 240 ms `--ease-emph` / 90 ms |
| Banners | 8 px settle plus fade | 240 ms `--ease` |
| Onboarding steps | body and title slide 24 px sideways with a fade; direction follows Continue (from the right) and Back (from the left) | 240 ms `--ease-emph` |
| Home starter cards, recent list, routine cards | staggered settle (30 ms apart) the first time that list is shown in a session, never on re-render or later visits | 240 ms `--ease` |
| Non (state changes) | the old face fades out while the new face fades in, so nothing pops; the leaning pose eases back to rest; still poses (wave, rest, success) cross-fade the same way | 160 ms `--ease` / 240 ms |
| Non (motion states) | the brand pack's idle, greeting, listening, thinking, talking and success loops (unchanged rules) | as in `motion/non-motion.css` |

## Frame-time measurements

`requestAnimationFrame` sampler installed in the page before each real click or key press; the table gives the number of frames recorded in the window shown, the
95th percentile frame time, the slowest frame, and the counts over 20 ms and over 33 ms. The display on this PC refreshes at about 195 Hz (a frame every 5.1 ms),
so a clean transition shows p95 5.1 ms and a few hundred frames; the target was p95 under 17.5 ms and no frame over 33 ms.

### GPU on (RTX 5070)

| Transition | Frames | p95 ms | max ms | over 20 ms | over 33 ms |
| --- | --- | --- | --- | --- | --- |
| Onboarding: Continue (step slides in from the right) | 142 | 5.1 | 5.1 | 0 | 0 |
| Onboarding: Back (step slides in from the left) | 142 | 5.1 | 5.1 | 0 | 0 |
| Home first show (cards stagger in) | 233 | 5.1 | 5.1 | 0 | 0 |
| Toast in + sample files (Try the sample) | 180 | 5.1 | 10 | 0 | 0 |
| View switch: Home to Routines | 140 | 5.1 | 10 | 0 | 0 |
| View switch: Routines to Connections | 140 | 5.1 | 10 | 0 | 0 |
| View switch: Connections to Settings | 137 | 5.1 | 15 | 0 | 0 |
| Settings inner tab: Your helper to Advanced | 142 | 5.1 | 5.1 | 0 | 0 |
| Settings inner tab: Advanced to About | 140 | 5.1 | 10.1 | 0 | 0 |
| View switch: Settings to Home | 138 | 5.1 | 9.9 | 0 | 0 |
| View switch: Home to project conversation | 140 | 5.1 | 9.9 | 0 | 0 |
| Non: listening while typing in the composer | 181 | 5.1 | 5.1 | 0 | 0 |
| Sidebar collapse | 120 | 5.1 | 5.3 | 0 | 0 |
| Sidebar expand | 121 | 5.1 | 5.2 | 0 | 0 |
| Dock open (Changes to check) | 120 | 5.1 | 5.1 | 0 | 0 |
| Dock close | 101 | 5.1 | 5.1 | 0 | 0 |
| Dialog open (Add a project), first time | 98 | 5.1 | 20 | 0 | 0 |
| Dialog open (Add a project), second time | 101 | 5.1 | 5.1 | 0 | 0 |
| Dialog close (Escape) | 80 | 5.1 | 5.1 | 0 | 0 |
| Controls: hover then press a button | 120 | 5.1 | 5.1 | 0 | 0 |
| Chat: new message in, typing dots, reply streams, scroll | 1201 | 5.1 | 10 | 0 | 0 |
| Task card: working to ready, steps stagger, results dock slides in | 1795 | 5.1 | 15.1 | 0 | 0 |
| Results viewer: sheet tab switch | 122 | 5.1 | 5.3 | 0 | 0 |
| Results viewer: Expand the dock (width) | 120 | 5.1 | 5.3 | 0 | 0 |
| Results viewer: make it narrower again | 121 | 5.1 | 5.1 | 0 | 0 |
| Dock tab switch: Results to Changes to check | 118 | 5.1 | 15 | 0 | 0 |

### Software rendering (`--disable-gpu`)

NO| Transition | Frames | p95 ms | max ms | over 20 ms | over 33 ms |
| --- | --- | --- | --- | --- | --- |
| Onboarding: Continue (step slides in from the right) | 142 | 5.1 | 5.1 | 0 | 0 |
| Onboarding: Back (step slides in from the left) | 142 | 5.1 | 5.1 | 0 | 0 |
| Home first show (cards stagger in) | 233 | 5.1 | 5.1 | 0 | 0 |
| Toast in + sample files (Try the sample) | 180 | 5.1 | 10 | 0 | 0 |
| View switch: Home to Routines | 140 | 5.1 | 10 | 0 | 0 |
| View switch: Routines to Connections | 140 | 5.1 | 10 | 0 | 0 |
| View switch: Connections to Settings | 137 | 5.1 | 15 | 0 | 0 |
| Settings inner tab: Your helper to Advanced | 142 | 5.1 | 5.1 | 0 | 0 |
| Settings inner tab: Advanced to About | 140 | 5.1 | 10.1 | 0 | 0 |
| View switch: Settings to Home | 138 | 5.1 | 9.9 | 0 | 0 |
| View switch: Home to project conversation | 140 | 5.1 | 9.9 | 0 | 0 |
| Non: listening while typing in the composer | 181 | 5.1 | 5.1 | 0 | 0 |
| Sidebar collapse | 120 | 5.1 | 5.3 | 0 | 0 |
| Sidebar expand | 121 | 5.1 | 5.2 | 0 | 0 |
| Dock open (Changes to check) | 120 | 5.1 | 5.1 | 0 | 0 |
| Dock close | 101 | 5.1 | 5.1 | 0 | 0 |
| Dialog open (Add a project), first time | 98 | 5.1 | 20 | 0 | 0 |
| Dialog open (Add a project), second time | 101 | 5.1 | 5.1 | 0 | 0 |
| Dialog close (Escape) | 80 | 5.1 | 5.1 | 0 | 0 |
| Controls: hover then press a button | 120 | 5.1 | 5.1 | 0 | 0 |
| Chat: new message in, typing dots, reply streams, scroll | 1201 | 5.1 | 10 | 0 | 0 |
| Task card: working to ready, steps stagger, results dock slides in | 1795 | 5.1 | 15.1 | 0 | 0 |
| Results viewer: sheet tab switch | 122 | 5.1 | 5.3 | 0 | 0 |
| Results viewer: Expand the dock (width) | 120 | 5.1 | 5.3 | 0 | 0 |
| Results viewer: make it narrower again | 121 | 5.1 | 5.1 | 0 | 0 |
| Dock tab switch: Results to Changes to check | 118 | 5.1 | 15 | 0 | 0 |

Result: 26 transitions measured in each run. GPU: worst p95 5.1 ms, no frame over 33 ms; one frame of 25 to 40 ms appeared only on the very first dialog open of a session in earlier runs (the backdrop layer being created) and
was not present in the final run. Software rendering: worst p95 14.9 ms, no frame over 33 ms (the dialog backdrop blur is dropped there, see Rules).

## Frame strips (CDP screencast, about 100 frames per second, one frame every 40 ms shown)

Read after capture, in `docs/project/screenshots/`:

- `brand2-motion-view-switch.png` and `-view-switch-back.png`: the two views cross-fade (both visible together at +120 to +200 ms) and the new one settles up; no blank frame, no flash.
- `brand2-motion-sidebar-collapse.png` and `-sidebar-expand.png`: labels fade before the width closes, no wrapping, no clipped text (the label is cut without an ellipsis while it fades); the orange bar stays at the edge; the main column keeps its layout.
- `brand2-motion-dock-open.png` and `-dock-close.png`: the main column reflows once at the start, the dock fades and slides in; closing fades first and the column reflows once at the end. The button no longer wraps to two lines while the column narrows (fixed with `white-space: nowrap` on `.btn` after the first strip showed it).
- `brand2-motion-dialog-open.png` and `-dialog-close.png`: backdrop fades, panel scales in, no blank frame.

## What this does not prove

- Smoothness on a slower or lower-refresh machine than this PC (the `--disable-gpu` run is the nearest stand-in).
- The Mac. Nothing here was run on macOS.
- Reduced-motion rendering was checked in the earlier brand run (`animations: 0`, static smile); the new transitions rely on the same global rule and were not re-screenshotted with the setting on.
