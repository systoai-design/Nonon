---
type: build-log
client: Kyle (internal)
project: nonon
workstream: ui-shell
date: 2026-10-09
---

# UI shell evidence (onboarding, app layout, conversation, companion)

All screenshots are real captures of the running renderer (`pnpm dev:web`, port 5199, Chromium via Playwright, 1440x900 unless noted). They run against the **demo bridge** (`app/src/renderer/src/lib/mockBridge.ts`): made-up data, labelled "Demo data" in the UI. Nothing here is real model output and no backend was exercised. The same components run unchanged in Electron, where `window.nonon` exists and the demo bridge chunk is never loaded.

Files are in `docs/project/screenshots/` (`ui-*.png`).

## What was verified, with the screenshot that shows it

| Area | Result | Screenshot |
|---|---|---|
| Onboarding 1: companion (4 characters) and name | works; name follows the character until edited | ui-01 |
| Onboarding 2: pack cards from `PACKS` | works | ui-02 |
| Onboarding 3: hardware result, recommendation `why`/`caveat`, download size, single "Set up" | works | ui-03 |
| Download progress in beginner phases ("Getting the AI engine", "Getting the AI brain", "Checking it", "Ready"), Cancel | works | ui-04 |
| Download error with retry (`?fail=1`), then success | works | ui-05, ui-06 |
| Unsupported computer message, "Skip for now" | works (`?unsupported=1`) | ui-09 |
| Onboarding 4: folder pick, samples explanation, "NONON Output" location, finish into app | works end to end | ui-07, ui-08 |
| Home: greeting, starter cards from `procedure:list` (summary, "It can", limits tooltip), recent tasks | works | ui-10, ui-32 |
| "Try the sample" card on a workspace with no tasks; sample files auto-assigned to the starter form | works | ui-27, ui-28 |
| Conversation history, user and companion bubbles, attachment chips | works | ui-11 |
| Task inspecting, header Stop button, sidebar "working" dot | works | ui-12 |
| Clarifying questions: preselected suggested answers, one-click Continue, "Remember this for next time" | works | ui-13 |
| Task running with live steps and spinner | works | ui-14 |
| Task in review: markdown summary (paragraph, bullets, bold), output file chips (long names truncate with ellipsis), checks pass/warn, "Review changes (1)" | works | ui-15 |
| Review panel docks on the right and the header count matches the staged proposals | works (panel content is the other workstream's) | ui-16 |
| Routine proposal card: schedule, time zone, folder, output location, allowed actions, where AI runs, missed-run behaviour; Edit; Confirm saves via `routine:save` | works | ui-17, ui-18, ui-19 |
| `needs-attention` message in plain words, Retry (`task:resume`), companion looks concerned | works | ui-20 |
| Composer attach (`workspace:pick-files`) | works | ui-21 |
| Drag and drop overlay; dropped file becomes a chip via `pathForFile` | works (synthetic DragEvent; real OS drag is untested) | ui-21b |
| "AI setup not finished" banner when the runtime is not ready; AI dot greys with "(setting up)" | works (`?runtime=missing`) | ui-22 |
| `waiting` task banner; Finish setup modal with live progress; the waiting task resumes by itself when ready | works | ui-23, ui-24, ui-25, ui-26 |
| Stop button stops, shows "Stopped" with Resume; button disappears | works | ui-31 |
| Collapsible sidebar (manual) and auto-collapse under 900px width | works | ui-29, ui-30 |
| Keyboard: Enter sends, Shift+Enter inserts a newline | verified by script | none |
| `reducedMotion` setting: root gets `reduced-motion`, mascot has no animation classes | verified by script (spinner keeps a slow rotation as progress feedback) | none |

Console errors during all scripted runs: none.

## Companion
SVG blob with face, four characters (pebble, moss, ember, tide) and four expressions: idle, thinking (a task is running or the download is in progress), happy (task just reached review or complete, or setup is ready), concerned (needs-attention, failed, or the download failed). Animation is CSS keyframes only (bob, sway, hop, blink): no JS timers or requestAnimationFrame. `html[data-hidden="true"]` pauses every animation while the window is hidden. Small avatars inside the conversation are static.

## Accessibility
- Visible focus ring on every control (`:focus-visible`); the composer shows a ring on its container.
- Roles and labels: radio groups for character, pack and answers; dialog role with Escape to close; progress bar with `aria-valuenow`; toasts use `role="alert"` or `status`; icon buttons have labels.
- Contrast computed from the actual token values (script, WCAG formula). Text pairs used in the UI are all at least 4.5:1 (lowest: muted text on the green-soft tint, 4.67). Two changes were needed: `--muted` was darkened from `#6b6f68` to `#646860` (it measured 4.37 on the chat bubble colour), and new ink shades `--amber-ink` and `--red-ink` were added for text on tinted amber and red surfaces (the old `--amber` measured about 3.2 there).

## Not verified / limits
- Everything runs on demo data. The real IPC handlers (chat routing, task events, runtime install) are not exercised by this workstream. `ChatEntry.routine` is a contract addition (see report); the real chat service must populate it for the routine card to appear.
- Electron window (frame, title bar, real file dialogs, real drag-drop paths) was not opened.
- macOS rendering untested.
- Review panel content (`views/ReviewPanel.tsx`) renders task summaries without the markdown helper, so `**bold**` shows as raw asterisks inside it. It can import `Markdown` from `lib/markdown.tsx`.
