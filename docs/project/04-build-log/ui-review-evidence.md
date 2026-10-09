# Review, Routines, Connections and Settings views: evidence

Date: 2026-10-09. Workstream: review + settings UI.

## What was built
- `views/ReviewPanel.tsx` + `views/review/*`: proposal cards (preview tables with highlights, before/after text, checks, recovery line, Apply / Ask for a revision / Reject), status states (applied, stale, partial with per-edit results, failed, recovered, rejected), task results card (segmented bar and counts from a defensively parsed `report`, outputs as openable chips, task checks).
- `views/RoutinesView.tsx` + `views/routines/*`: list, enable switch, Run now, Remove with confirm, run history, "describe it" -> propose -> editable confirmation card -> save, background opt-in.
- `views/ConnectionsView.tsx` + `views/connections/*`: Gmail card and email brief (freshness banner, deadlines, https-only links, editable draft with Copy), optional AI cards with disclosure before sign-in, workspace policy switch with confirm, project roles.
- `views/SettingsView.tsx` + `views/settings/*`: Companion, Workspaces, Approvals (with per-workspace auto-apply and change history), Advanced AI (runtime, idle minutes, hardware, diagnostics with Copy), About.
- Shared helpers: `views/lib.ts`, `views/ui.tsx`. Dev harness: `views/__dev__/` (mock bridge with fixtures) and `app/src/renderer/dev-views.html`.

## Verification (how)
- `npx tsc -p tsconfig.web.json --noEmit` from `app/`: clean (0 errors).
- Real browser run of the Vite dev server (`pnpm dev:web`, port 5199) at `/dev-views.html`, headless Chromium via Playwright, against a MOCK bridge (fixtures, not real main process). Screenshots in `docs/project/screenshots/review-*.png`.
- Scripted interaction checks (all passed, no page errors): Apply disabled when a check fails; Apply by keyboard (Enter) shows "Applying" then "Change applied"; Undo with confirm gives "Change undone"; Ask for a revision sends text via `chat:send` and confirms; live `change:updated` push switches a card to the stale message; routine Run now shows "Running now" then live "Needs your review"; enable switch pauses; new-routine flow edits time/weekday and saves (card shows "Every Mon, Tue, Wed, Thu, Fri and Sat at 9:30 AM"); remove with confirm; background opt-in switch.

## Not verified against the real app
- All data is mocked. Not run inside Electron, not mounted by the shell's `App.tsx`, not tested against real IPC handlers.
- The spreadsheet `report` shape is a guess (see `views/review/report.ts` header). Unknown shapes fall back to summary, outputs and checks only.
- "Re-run setup" calls `settings:update {onboarded:false}`; the shell must react to that.
- `window.open` for Gmail links relies on the main process allowing it.
