# Project roles: evidence log

Workstream: PROJECT ROLES. Date: 2026-10-09, Windows 11, this PC. Code: `app/src/main/services/procedures/team-draft/`.
"Real" means the real dev model (Qwen3.5 4B Q4_K_M on `127.0.0.1:18088`) or the real Codex program. "Mocked" means scripted stage replies (`testkit.ts`) or a fake adapter.

## What was built

Procedure `team-draft` (pack `general`, revision 1), "Draft a document with your AI team". Input: a .md/.txt/.docx file or pasted text, plus a goal. It runs the workspace's roles through the existing `runStages`:

1. Design (source + goal) makes a plan: audience, purpose, sections, key points, constraints, each with source line numbers.
2. Implement (plan + source) writes the draft.
3. Review (plan + draft + source) lists problems with source line references and marks unsupported claims.

A stage with no role runs on `local` (the on-device AI), so the whole feature works with no account and no internet. A cloud role plugs into the same stage when the user chose it and the workspace policy is `cloud-allowed`. Outputs: `Team draft.docx`, `Team draft.md` (draft plus "Review notes"), `Team draft - spec and review.md` (the three artifacts and a provenance table). `proposals: []`.

Code checks (the model explains, code decides): cited lines exist (and the quoted text shown for a cited line is read from the file by code); the reviewer's source quotes are verified with the shared `verifyQuote`; sentences the reviewer calls unsupported are located and highlighted in the draft; if the doubted sentence is found word for word in the source, code overrules the reviewer and says so; numbers in the draft that are not in the source or goal are highlighted by code regardless of the reviewer; every stage artifact has provider, input hash and time.

Every model reply is validated with zod, retried once with the error, then the step pauses instead of inventing. Line numbers not in the source are removed, the step is retried once, and the removal is reported as a warning. A draft missing a section of the plan is sent back once.

## Edits outside the procedure folder (all additive unless noted)

- `providers/stages.ts`: optional `taskFor` (per-stage task text, used in the prompt and in that stage's input revision); optional `jsonSchema`, `maxTokens`, `temperature` on `StageRunRequest`. **Behaviour change:** the input hash of a downstream stage now uses upstream `stage:contentHash` instead of `stage@revision:contentHash`, and a redo that produced word-for-word identical text no longer invalidates downstream stages. Before, a redone design always forced implement and review to rerun even when the plan was identical. All 18 existing `stages.test.ts` tests still pass.
- `providers/index.ts`: the local branch passes `jsonSchema`/`maxTokens`/`temperature` to `ctx.svc.runtime.client()` (it already supported `local`); `createProviderService` calls `bindTeamDraftHost(...)` at the end, because `ProcedureRunContext` carries no services (same pattern as `bindGmailService`).
- `procedures/builtins.ts`: one import and one spread.

## Tests

`cd app && npx vitest run src/main/services/procedures src/main/services/providers src/main/services/tasks.test.ts src/main/services/scheduler`: 29 files passed, 1 skipped; 456 tests passed, 15 skipped (the skips are the opt-in live Codex runs and other workstreams' live tests).

| File | Kind | Covers |
|---|---|---|
| `team-draft.test.ts` (40 tests) | MOCKED stage executors | order and no overlap; exact data each stage receives (design: goal + source; implement: plan + source, no goal; review: plan + draft + source, no goal; no staged files; fixed system prompts); reuse when nothing changed; goal change; source edit; provider change; local-only refused before any call (procedure and stage runner); policy re-read each run; failing cloud step pauses, names the provider, offers this computer, never calls another provider; "not now" sends nothing; a remembered old answer cannot switch a later pause; retry then pause on bad JSON; retry fixes; line numbers not in the source dropped and reported; missing plan sections retried; highlighting, quote verification, overruling, number check; provenance table columns; docx source; pasted source; registry. |
| `team-draft.service.test.ts` (3 tests) | REAL provider service, MOCKED adapter and local client | JSON schema reaches the local client; Codex gets only the plan and source (goal absent, data guard present, no file read); roles and artifacts persist in the service store; a local-only workspace with a stale cloud role never reaches the adapter; a failing Codex pauses and the "use this computer" answer changes the saved role. |
| `team-draft.real.test.ts` | REAL | below |

## Real run (a): all three steps on this computer, local-only workspace

Command: `npx vitest run src/main/services/procedures/team-draft/team-draft.real.test.ts`. Input `app/resources/samples/general/product-brief.md`. Raw record: `fixtures/team-draft/real-runs/local-run.json`; outputs `local-run-Team draft.md` and `local-run-Team draft - spec and review.md`.

- Workspace policy `local-only`; roles design/implement/review all `local`; no network used.
- Run 1 (fresh): 8.1 s total, 3 model calls (about 120 tokens/s on the RTX 5070), each step first try, no dropped lines. Design 3.9 s, Implement 2.9 s, Review 1.3 s.
- Draft contained all 6 known facts from `fixtures/team-draft/expected.json` (budget 1,500 USD, live before 14 November, pay in the shop, no accounts, no delivery, order email). Checks: stages-recorded, source-lines, quotes-verified, unsupported-flagged, numbers all pass.
- Run 2 (nothing changed): 22 ms, 0 model calls, all three steps reused.
- Run 3 (goal changed): 3 new calls, design r2, implement r2, review r2 (the new plan differed, so everything downstream correctly reran).
- Run 4 (source edited, budget 1,500 to 1,800): 3 new calls, r3 for all; the new draft says 1,800 and no longer says 1,500.

Honest model notes. The first real run (before the section-coverage check and the code overrule were added) produced a one-section draft and a reviewer that invented problems (it called "the owner, Maria Santos" unsupported although it is copied from the source, and flagged "quotes" that were not in the file). That is what the checks are for: the quotes were shown as "not relied on". The two fixes came from that run. The latest run's reviewer still lists one problem that is wrong (it says the email requirement is missing; the draft has it). The 4B reviewer is weak and the review notes say it is an AI; the code-side checks, not the verdict, are what to trust. Variance between runs was not measured beyond the four runs above.

## Real run (b): Codex on the Implement step

Command: `NONON_TEAM_LIVE=1 npx vitest run src/main/services/procedures/team-draft/team-draft.real.test.ts -t "REAL Codex"`. `providers.probe("codex")` reported `ready` (Codex 0.153.4, signed in with the owner's own ChatGPT login; nobody was signed in or out). Throwaway cloud-allowed fake workspace, roles design `local`, implement `codex`, review `local`. The only data sent to Codex was the plan and the sample brief, one turn. Raw record: `fixtures/team-draft/real-runs/codex-run.json` (+ `.out.json`, outputs).

- Total 18.8 s: Design 4.4 s (local), Implement 12.5 s (Codex, cloud), Review 1.7 s (local).
- Provenance shows "This computer / Codex (cloud) / This computer"; all 6 facts present; all checks pass.
- This was the one and only cloud run. Claude was not signed in and was not used. Antigravity was not used.

## Only mocked / not proven

- Claude and Antigravity as team roles: mocked only (their adapters were tested by the provider workstream, not through team-draft).
- Failure pause with a real failing provider: mocked (fake timeout errors, and through the real service with a failing fake adapter). Not forced against real Codex.
- The renderer: the pause question (id `switch-<stage>-<stamp>`) and the step labels use existing task UI (questions and steps); I did not open the app UI to look at them.
- Artifact history is per workspace (`stage-artifacts.json`), as `runStages` designed it. Drafting a different source in the same workspace makes the earlier artifacts stale.
- Source cap is 8,000 characters (about 1,300 words) so Review (plan + draft + source) fits the small model.
