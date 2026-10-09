# In-app results: evidence

Requirement (Kyle): results show inside the app, with an option to open the document separately. Show in the app first.

## What was built

- Main: `app/src/main/services/outputs.ts` (no Electron import), IPC `output:preview` (`ipc.ts`, `shared/ipc.ts`, `shared/contracts.ts`: `OutputPreview`, `PreviewSheet`).
  - Path must be a real file inside an approved workspace folder (realpath on both sides, so links that leave the folder are refused). Anything else is rejected with a plain message.
  - `.md`/`.txt`/`.json` text (200 KB cap, cut at a line end, `truncated` flag, JSON pretty-printed), `.csv` (papaparse, quoted commas and line breaks), `.xlsx` (exceljs, values only, formulas as cached results, dates and Excel number formats applied, hidden sheets skipped, 200 data rows x 20 columns per sheet, real totals reported), `.docx` (mammoth HTML turned into markdown, so tables, bold, italics, highlights and headings survive), everything else `unsupported` with a reason. A file that only pretends to be a workbook returns a plain "could not show this one here, use Open document" result and never throws.
  - "Open document" and "Show in folder" reuse `shell:open` and `shell:reveal`.
- Renderer:
  - `lib/markdown.tsx` is now a safe renderer for headings, nested bullet and numbered lists, block quotes, tables, rules, bold, italic, bold italic, `==highlight==` and code. It still emits React nodes only (no `dangerouslySetInnerHTML`, no links, no HTML).
  - `results/ResultsPanel.tsx`: Results viewer in the right dock. Summary first (folds to a few lines with "Show more"), one tab per output, sheet tab strip with row counts, sticky-header compact tables with right-aligned numbers, "Showing the first N of M rows" note, Copy sheet / Copy text, Show in folder, Open document, loading and error states, wide toggle.
  - `App.tsx`: the dock now has two tabs, "Results" and "Review changes" (with the staged count). The Review panel is unchanged inside it.
  - `chat/TaskCard.tsx` + `results/InlinePreview.tsx`: inline preview of the main file in the card (12 rows or about 18 lines, fade-out, Expand), chips that open that file's tab, primary "View results" button, small "Open document".
  - `lib/bridge.ts`: `onResultsReady` fires once when a task the user started in this session (seen working, not a routine run) reaches review or complete with files. The shell opens the Results viewer then, without moving focus, and never replaces an open Review panel. Tasks restored from history never trigger it.
  - `components/HomeView.tsx`: "Results" button on recent tasks that have files.
  - `lib/mockBridge.ts`: demo handler for `output:preview` so `pnpm dev:web` compiles and runs.

## Verification

Unit tests (real generated files, no mocks): `npx vitest run src/main/services/outputs.test.ts src/renderer` passes (multi-sheet xlsx with formulas, dates, money, percent, rich text, hidden sheet and empty sheet; 450 x 30 sheet capped to 200 x 20 with real totals; broken xlsx; csv with quoted commas, quotes and line breaks; docx built with the `docx` package, with title, heading, bold, highlight, bullets and table; md, txt, json; 200 KB cap; binary and pdf; path outside the workspace, relative path, missing file, folder, `..` trick, symlink out, no approved folders; markdown renderer incl. no raw HTML). Whole suite: `npx vitest run` = 659 passed, 33 skipped. `npx tsc -p tsconfig.node.json --noEmit` and `npx tsc -p tsconfig.web.json --noEmit` are clean.

Real Electron window (Playwright `_electron`, built app via `pnpm build`, real local AI from `E:\nonon-dev\install-test`, `--user-data-dir=E:\nonon-dev\ud-results`, viewport 1360x860). Scripts: `E:\nonon-dev\e2e\results.mjs` (stages setup, compare, meeting, study, edge) and `flow-r.mjs` (the original apply and undo flow, copied).

- Compare: asked in chat "Compare expense-report-may-2026.csv with bank-export-may-2026.csv", accepted the suggested answers. Task reached review. The Results viewer opened by itself (`.results-dock` present); `document.activeElement` was BODY, not inside the dock (no focus steal). Card shows the inline preview of the totals table, six sheet tabs read `Summary 42 | Matched 19 | Only in A 4 | Only in B 5 | Listed twice 1 | Not sure 3`. Switching to the Review changes tab shows the one staged change; switching back works.
- Meeting follow-up (Bakery sample) and study packet (water cycle sample): both tasks completed with a .docx and a .md copy; docx shown as markdown (headings, table, bold, yellow highlights for "Missing: ...", quotes). Auto-open fired for both with focus not in the dock. Copy button shows "Copied". Those two were started with `task:start` through the same IPC the starter card uses, not by typing in the composer.
- Restored task from history (hand-written task file): no auto-open (`RESTORED TASK dock auto-opened? 0`); Home "Recent" shows a Results button that opens it. Its three files: 200 KB-capped huge text (note "This file is large, so only the first part is shown here"), a .pdf (unsupported, plain reason, Open document button), a fake .xlsx with a very long name (plain "could not show this one" state, name ellipsised).
- `output:preview` for `C:\Windows\win.ini` is refused with the plain "outside your project folders" message.
- Review flow regression (`flow-r.mjs`): original file hash unchanged while the panel is open, Apply changes the file as approved, Undo returns it byte-identical (`RECOVERED status: recovered sha now: 6bd9892a972e (byte-identical to original)`).
- Processes: each run's Electron was closed by the script; afterwards no `llama-server` and no Electron with `ud-results` remain (checked with `Get-CimInstance Win32_Process`). Nothing under `E:\NONON` was touched.

Screenshots (`docs/project/screenshots/`): `results-01..07` compare (auto-open, card inline preview, card top, summary sheet, each sheet, wide mode, review tab), `results-meeting-*` and `results-study-*` (docx as markdown, md copy), `results-08..11` (Home recent entry, huge text, pdf, broken workbook with long name), `results-flow-*` (apply and undo regression).

## Found and fixed while looking at the screenshots

- Tab strip scrolled sideways and clipped file names: now wraps. Sheet tabs wrap too.
- Summary plus buttons left too little room for the table: summary folds, single-output tab strip is hidden.
- Dock width jumped between Results and Review: same width for both.
- Docx title and Heading 1 came out the same size, and bold inside an italic quote showed stray asterisks: style map added (Title, Heading 1-3 map to one level down) and `***bold italic***` handled.
- Electron error prefix "UserError:" leaked into messages: `plainError` now strips it.

## Not verified

- macOS (Windows only here).
- Reduced-motion and keyboard-only paths were not walked through by hand; scroll panes are focusable (`tabIndex=0`) but that was not tested with a keyboard.
- "Open document" and "Show in folder" buttons were not clicked in the real window (they would launch Excel or Word on Kyle's desktop); they call the existing `shell:open` / `shell:reveal` channels.
- Narrow window overlay mode (under 1100 px) was not screenshotted.
- Meeting and study tasks were not typed into the composer; the compare task was.
