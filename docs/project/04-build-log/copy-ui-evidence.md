# Renderer copy pass: evidence

Goal (Kyle): "remove jargon, simpler words and explanations." Text only in `app/src/renderer/src/**`. No layout, class, id, IPC or logic changes.

## Before / after (15 strings)

| # | Where | Before | After |
| --- | --- | --- | --- |
| 1 | Sidebar heading | Workspaces | Projects |
| 2 | Sidebar button, dialog | Add workspace | Add a project |
| 3 | Top bar, side panel tab, task card | Review changes | Changes to check |
| 4 | Starter card lead-in | **It can:** Give it two spreadsheets... | (label dropped; the sentences start with "Give it...") |
| 5 | Starter card info icon | What it cannot do (all limits) | Good to know (first two limits) |
| 6 | Task status chip | Needs your answer / Working / Not applied / Did not finish | Needs a quick answer from you / Working on it / You said no / Something went wrong |
| 7 | AI location hover (this computer) | The AI runs on this computer. Nothing is sent away. | The thinking happens on this computer. Nothing is sent to the internet. |
| 8 | AI location (online) | AI: Claude (cloud) | AI: Claude (online), hover: The parts of your files this task needs are sent to Claude. |
| 9 | Onboarding setup step | Your computer can run NONON's built-in AI. + model name "Qwen3.5 9B" + "Basic fit" + engineering caveat | Your computer is a good fit. NONON will download its built-in AI once (about 5.3 GB). After that it works without the internet. (limited machines: This computer may be slow with the built-in AI. You can still use it.) |
| 10 | Setup progress steps | Getting the AI engine / Getting the AI brain / Checking it | Getting the AI ready / Downloading the built-in AI / Checking the download |
| 11 | Change panel button | Apply change / Reject / Ask for a revision | Make the change / Say no / Ask for a different version |
| 12 | Change panel note | A recovery copy will be created before applying. | NONON saves a backup copy of your file first, so you can undo this. |
| 13 | Settings tab and section | Approvals: Review before applying / Auto-apply in selected workspaces | Changes and backups: Check with me first / Make changes without asking, in projects I choose |
| 14 | Connections | Connected AI (optional); Cloud AI sends the parts of your files...; Pair / Unpair / pairing code | Online AI (optional); Online AI sends the parts of your files a task needs...; Link / Unlink / link code |
| 15 | Error toasts (`plainError`) | Raw message after stripping the Electron prefix, e.g. `TypeError: Cannot read properties of undefined` | One calm sentence. Known file/network failures are explained; anything technical becomes "Something went wrong. Please try again. If it keeps happening, restart NONON." |

Also changed: Gmail card (one-time setup steps folded behind "Show the setup steps", "Connect Gmail", "Summarize my email"), routine words ("Run late, after the computer was off"), report class names ("Only in file A", "Listed twice", "Not sure which"), `views/lib.ts` `errMsg` now uses `plainError`, mock demo strings in `lib/mockBridge.ts`, `RolesPanel` steps renamed Plan / Write / Check (matches the team-draft steps), Settings > Advanced is the only place a model id (`qwen3.5-9b`) still shows.

## Verification (real Electron, 1360x860)

Script: `E:\nonon-dev\e2e\copy-ui.mjs` (Playwright-electron, `--user-data-dir=E:\nonon-dev\ud-copy`, `NONON_DATA_DIR=E:\nonon-dev\e2e-data-c`, `NONON_MODEL_DIR=E:\nonon-dev\install-test`; part A used an empty model dir to show the download offer and the "AI not ready" states). The native folder dialog was stubbed in the main process so the real onboarding buttons could finish. Real local AI ran the spreadsheet comparison end to end (about 40 s).

Screenshots in `docs/project/screenshots/copy-*.png`: a1-a8 (first run, download offer, AI not ready, starter form, waiting card, setup dialog), b1-b4 (onboarding with the AI installed), c1 Home with starter cards, c2 "Good to know", d1-d3 conversation / question / running card, e1 results panel, e2 changes to check, f-settings-* (four tabs), g1-g2 Connections, h1-h2 Routines.
Page text and titles were dumped to `E:\nonon-dev\e2e\copy-text-A.txt` / `-B.txt` and grepped for workspace, model, token, cloud, pair, proposal, apply, recover, runtime, schema: no hits in renderer text (only main-side strings such as "1 match(es)" and "matched pairs" remain).

Fixed after looking at the screenshots: waiting card read as a sentence fragment; duplicate "(optional)" in the starter form; Gmail setup block showed developer instructions; "Sign in" button did not match the "Choose Connect" help text from main; chip clutter in the setup block.

## Checks

- `npx tsc -p tsconfig.web.json --noEmit` and `tsconfig.node.json`: 0 errors.
- `npx vitest run`: 673 passed, 33 skipped (659 before plus 14 new renderer tests in `lib/format.test.ts` for `plainError`, status words and AI hints).
- Kyle's installed app at `E:\NONON` was not touched; only the Electron processes the script launched were used, and each closed itself.
