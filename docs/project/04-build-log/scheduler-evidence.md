# Scheduler evidence (2026-10-09)

Owner: SCHEDULER workstream. Code: `app/src/main/services/scheduler/`, `app/src/main/background.ts`.

## Commands and results

All run from `app/`.

| Command | Result |
|---|---|
| `npx tsc -p tsconfig.node.json --noEmit` (filtered to scheduler/background) | 0 errors in scheduler files and `background.ts` |
| `npx vitest run src/main/services/scheduler` | 4 files, **89 tests passed** (87 unit + 2 real-model end-to-end); unit files stable over repeated runs |
| `npx vitest run src/main/services/scheduler/scheduler.e2e.test.ts` | 2 passed, ~15 s, real model |

Breakdown: `schedule-parse.test.ts` 28 (19 phrase table + DST/zone), `scheduler.test.ts` 47, `propose.test.ts` 12, `scheduler.e2e.test.ts` 2.

## What is real and what is mocked

Mocked (labelled): the TaskService (`FakeTasks` in `test-kit.ts`), the workspace/procedure/provider services, the clock and timers, the model in `propose.test.ts` (scripted JSON replies, so those tests prove validation, retry and fallback, not model quality). Real in unit tests: temp folders on disk (file listing, mtimes, SHA-256 fingerprints), croner, the persisted JSON round-trip.

Real end to end (`scheduler.e2e.test.ts`, only the clock is fake): real `createStore`, `createWorkspaceService`, `createProcedureRegistry`, `createChangeService`, `createTaskService` and the real `meeting-followup` procedure, with the real Qwen3.5 4B llama-server at `http://127.0.0.1:18088` (from `E:\nonon-dev\llm-url.txt`; the test skips if the server does not answer).
Flow checked: `propose()` on "Every weekday at 8 a.m., turn my newest meeting notes into a follow-up in my Meetings folder" gave procedure `meeting-followup`, cron `0 8 * * 1-5`, folder `Meetings`, no keyword-fallback note (the real model chose the task); `save()`; tick to 08:00 Manila; the real task ran on the local model and finished `complete` with `Meeting follow-up.docx` and `.md` in `NONON Output` ("Found 3 action items (1 missing an owner or a date, highlighted), 1 decision and 1 open question"); run status `succeeded`, task carries `routineRunId`; next weekday with the same file recorded "No new files since last run." and started no new task; run history persisted (2 runs).
Second real run: `propose()` on "Every weekday at 8 a.m., compare the newest two spreadsheets in my Statements folder" gave `spreadsheet-compare` with File A = second-newest (older, `skip:1`) and File B = newest; `runNow` ran the real procedure on two CSVs. It finished `waiting-for-input` with the procedure's own question ("Both files cover 1 Sep 2026 to 9 Sep 2026. Which dates should be compared?"), which proves the clarifying mapping against the real task service. Nothing was auto-answered and the originals were untouched. Consequence: a spreadsheet routine will park on that question until the user answers it once (the task service can remember answers); the scheduler does not invent answers.
Not run end to end: the Gmail brief (needs Google sign-in), a connected-AI routine against a real provider, and `background.ts`.

## Spec coverage (each item has a test unless marked)

- Cron in the routine's time zone, DST: New York spring-forward day keeps 08:00 local (13:00Z -> 12:00Z), a 02:30 job runs once on the day 02:30 does not exist and once on the repeated autumn hour, Asia/Manila never shifts; through the scheduler `nextDueAt`/`lastRunAt`/`lastRunStatus` are updated and `routine:updated` emitted.
- `propose`: ~19 phrases parse deterministically (weekday, weekend, daily, day lists, ranges, 8 a.m./8:30 pm/17:00/noon/midnight, every N hours, monthly, weekly default) and the same sentence always gives the same cron; card is not saved; model choice validated against the registry and the real workspace folder, retried once with the error, keyword fallback when invalid/unavailable, what could not be inferred goes in `description`; `allowedActions` default and `read-mail` only for gmail-brief; a sentence asking to send/delete does not widen permissions.
- `save` validation (cron, zone, workspace, folder, procedure, scope inside workspace, pick keys, required files), runtime guard rejecting any action outside read-files/write-outputs/read-mail (also re-checked when a run starts, tested by editing `routines.json`), local-only workspace rejects a cloud routine and a run never uses a provider if the workspace was switched to local-only later.
- Runner: newest-N by mtime (with `skip` for separate File A / File B slots: a rule with `skip:1` takes the second-newest) with extension and name filters, SHA-256 fingerprints recorded on the run, local client unless provider location + cloud-allowed + provider `ready` (otherwise local with the reason in the run detail).
- Status mapping: review -> needs-review (proposals preserved; test asserts the scheduler never calls `changes.apply`/`reject`), complete -> succeeded, clarifying -> waiting-for-input (frees the lease), waiting -> stays running and is resumed on later ticks (bounded; gives up with "Still waiting for X after N tries"), failed/needs-attention -> failed with the task's error or first failed check, no matching file -> failed "No new file matched ...", throwing `tasks.start` -> failed run.
- Idempotency: same path + SHA-256 as the last succeeded/needs-review run -> `succeeded`, "No new files since last run.", no task; changed content (even same name) or a new file -> new run. Manual run-now always runs.
- Missed runs: 5 missed daily runs -> exactly one `catch-up` run; `skip` policy -> one `skipped-missed` record and no run; a tick gap > 2x tick (sleep/wake) is treated as missed; an on-time tick is `due`.
- Overlap: second due or manual run while running -> `skipped-overlap`; one routine task at a time globally, FIFO; foreground (non-routine) task delays due routines up to 2 min, then they run; runs as soon as the foreground task ends.
- Crash recovery: a persisted `running` run is checked against its task at startup: review/complete/clarifying/failed adopt the task outcome, waiting resumes, anything else becomes `interrupted` and is never replayed.
- Run-now returns a `running` run immediately; `routine:run` emitted on every change; pause/re-enable (no replay of the paused period); remove (cancels queued runs, keeps history); restart persistence from the same store; history capped at 200 per routine; single 30 s interval for all routines; `notify` callback is local only and a throwing callback does not break a run.

## Not unit tested (by design or limitation)

- `app/src/main/background.ts` (tray, hide-on-close, login item, `powerMonitor` resume): needs a live Electron main process. Written, typechecked, not run. Check by hand: enable `backgroundRoutines`, close the window (app stays, tray shows "Open NONON / Routines are on / Quit"), Quit really exits. Login item registers only when packaged and only while the setting is on.
- Wake-from-sleep via the real `powerMonitor`: the gap detection it feeds is tested with a fake clock; the OS event wiring is not.
- A real routine that waits on a dependency (offline Gmail) is tested with fake tasks only.
