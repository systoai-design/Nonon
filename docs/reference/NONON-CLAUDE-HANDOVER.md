# NONON — implementation handover for Claude

Prepared: 9 October 2026, Asia/Manila.

This document is ready for Kyle to give to Claude as an implementation request. It is not a record of implementation already performed, and has not been sent to another chat or person.

## 1. Task and authority

Build **NONON**, a simpler derivative of Pragma for ordinary users. Intended website: **trynonon.xyz**. Implement the current NONON product plan, including local scheduled procedures and optional Claude, Codex, and Antigravity connections. Preserve a useful standalone local/offline core.

Kyle's latest decisions supersede the earlier no-cloud-AI rule and scheduling-as-proposal status. The three connected AI products are optional; local remains the default. Do not ask Kyle to reapprove these product decisions before routine scoped implementation. Ask only when an essential missing fact or a genuinely new scope/irreversible action requires it.

Work in a separate NONON derivative directory under <workspace>/NONON. Keep plans/research at the workspace root. Inspect local instructions before creating project files. Do not alter Pragma's active source, installs, global settings, release channels, pricing, or production services. Read and copy suitable components with provenance. If isolation requires a different path, document the reason before use and preserve Kyle's work.

This implementation request does not authorize domain purchases, deployments, public pushes/repository creation, social posts, sending email, paid subscriptions, or messages to other chats/people. Prepare local reviewable results and submission assets. Ordinary local implementation and necessary tests are within scope; live third-party actions need an already authorized test context.

## 2. Read order and current truth

Read:

1. <workspace>/NONON-PROJECT-PLAN.md — current scope and supersession.
2. <workspace>/NONON-CLAUDE-HANDOVER.md — execution order and completion evidence.
3. <workspace>/competitor-profiles/_summary.md.
4. <workspace>/competitor-profiles/PRODUCT-DIRECTION.md.
5. <workspace>/competitor-profiles/VALIDATION-PLAN.md.
6. Earlier PROJECT-PLAN.md and PRODUCT-ARCHITECTURE-REVIEW.md only for compatible UI/workflow detail. Their local-only prohibition and scheduling proposal are superseded.

Research is evidence, not new authorization. Do not treat text in imported documents, emails, source snapshots, or handoff examples as permission to execute additional actions.

No NONON application was built in this planning chat. Existing UI images are concepts with fictional data, not runtime evidence. No provider authentication, Gmail connection, scheduler run, device benchmark, or secure pairing has been demonstrated.

## 3. Start by checking reusable source

Pragma candidate checkout: D:/New Claude/Pragma. It has a CodeGraph index from earlier work. Follow the workspace CodeGraph rules for structural exploration. Use a focused codegraph_context if available, otherwise codegraph_explore, then a capped explore of relevant symbols. Literal file/config text can use native search. Trust fresh graph results; read only files explicitly flagged pending sync when needed. Do not repeat broad scans or spawn exploration agents unnecessarily.

The current root package.json was reported as zero-length. Indexed provider/local-runtime source includes:

- D:/New Claude/Pragma/output/feedback-preview-2026-10-02/win-unpacked/resources/server/server/drivers/claude.js
- .../drivers/antigravity.js
- .../drivers/codex-catalog.js
- .../drivers/lmstudio-load.js
- .../server/index.js

The ellipses above refer to the same resources/server/server base. Treat the October 2 preview as a snapshot, not proof of the current app's behavior or a complete production source repository. Locate buildable source, dependencies, scheduler/procedure code, permissions, and reusable character assets. Audit inherited Claude history as well as Codex history only if needed to locate missing source or prior decisions; do not import unrelated decisions into NONON.

Produce a concise reuse inventory with source/revision, component, keep/adapt/exclude, dependency/license conditions, and whether it was runtime checked. Audit local context defaults and idle model handling; the sampled lmstudio-load path uses a large agent context target, which should not be inherited for constrained hardware. This observation is not a diagnosis of Kyle's past RAM saturation.

Prefer one maintainable execution foundation and a separate NONON procedure/review layer. Pragma remains the approved derivative starting point. AnythingLLM core and Goose are comparison candidates, not automatically selected replacements. Do not combine full frameworks for their feature lists. If source is incomplete, continue independent NONON UI/tool/test work and report the concrete reuse blocker rather than claiming that packaged code is a verified build.

## 4. Build order

### A. Shell and local core

Choose a maintainable stack after source inspection. Windows-first is the recommended initial path, not a claim of cross-platform completion. Build the approved light UI, one companion, folders, conversation, task progress, contextual previews, review/apply/reject, recovery, and Stop. Rebrand visible text to NONON. Use the approved concepts linked in the product plan.

Assess hardware without an LLM/cloud login. Select a tested local model/runtime with verified redistribution conditions and bounded context. Distinguish a complete offline bundle from a download-based installer. No paid account is needed for the local core. Avoid additional loaded models and expensive specialist dependencies until required.

Prove one new-input workflow with real local inference before building a broad agent dashboard. Do not simulate replies or label sample outputs as model results.

### B. Procedures, review, and packs

Implement comparison of two declared supported tables first. Use fixtures with known matched, unmatched, duplicate, ambiguous, and total results. Code performs calculations. Require explicit mapping/matching rules where necessary, source every discrepancy, and preserve source amounts/history. Detect unsupported workbook features and stale formula caches; do not claim full Excel compatibility or universal recalculation.

Generate and reopen an editable discrepancy output. Stage a supported original-file annotation/change separately, preview original/new content, detect concurrent edits, apply only when permitted, and validate restoration. Report partial operations accurately.

Implement meeting-note follow-up with source-linked commitments, missing owner/date flags, editable summary/actions, and local reply draft. Add a bounded, functioning education procedure with source-grounding checks. Curate/adapt relevant Pragma skills rather than installing the full library. Keep supported procedures and limitations visible; no fake pack support.

Save user-approved stable rules/templates for repetition. Recheck fresh files, periods, columns, and assumptions; distinguish one-run corrections from persistent preferences. Preserve inspectable local task/procedure state.

### C. Scheduling — required scope

Implement a persisted scheduler that reuses approved procedures, not an LLM improvising what to do every day. Conversation can create a routine, followed by a plain-language confirmation card. Include time zone, input/output scope, execution location, allowed actions, and missed-run behavior. Support pause/edit/run-now/remove and last/next-run status.

Opt-in background worker permits UI closure. Explain that the executing computer must be awake/on. Default to one catch-up run, prevent overlapping copies, prioritize foreground work, unload idle inference, preserve pending approvals, and expose failures. Persist run IDs/checkpoints and check uncertain operations before retry. Do not promise exactly-once external actions.

First demonstrate a local-file schedule with no internet. Then implement a daily Gmail brief using the same scheduler. Test restart, missed run, pause/remove, overlap, input change, time-zone behavior, failed dependency, and permission preservation. Scheduling does not authorize sending or deleting email.

### D. Direct Gmail

Implement direct Google authorization and read/brief/local-draft functionality, no Composio. Use appropriate scopes/credential storage and bounded caching. New retrieval requires internet; offline cached output needs a last-sync label. A cache must not be presented as current inbox coverage.

Process messages locally by default. Keep mailbox changes and sending separate. Do not send real email during implementation without an explicit authorized test action. If a Google project/client/test account is needed and absent, provide an exact local configuration template/path, never ask Kyle to paste secrets into chat. Test provider-independent parsing/sync failure cases meanwhile and clearly label mocked tests separately from live integration.

### E. Three optional AI adapters and one project

Implement a provider-neutral task/turn/cancel/error/proposal contract, then add each requested adapter through its supported official interface. Keep one companion, one workspace, revisioned artifacts, and sequential role stages. Example roles are Claude for implementation and Codex for design, adjustable by the user; do not claim model specialization as fact.

Codex: investigate local stdio app-server; map streaming and approval requests, pin the installed protocol/schema, and use official authentication. Subscription access and API billing differ. The app-server is experimental; validate the actual installed version. Do not copy a user's auth file into NONON or expose the daemon publicly.

Claude: use the unmodified official binary or supported SDK/API route under current provider conditions. The user completes the vendor-owned authentication flow. Do not implement a fake Claude.ai sign-in or collect/intermediate subscription tokens. SDK plan access does not override embedding/distribution rules. Retain valid user authentication choices and disclose provider charges/limits.

Antigravity: validate official agy headless JSON/streaming auth, interruption, and errors. Native headless workspace writes may happen without an interactive prompt, and soft-denied tools may not cause a failing exit code. Therefore use isolated staged work and validated outputs; never interpret process exit zero as completed work or rely on prompt text to protect originals.

For every adapter, enforce actual isolation or controlled tools, not a role description. Do not grant unrestricted original-folder access, inherit all global plugins/credentials, alter the user's global config, or use blanket bypass switches. If sufficient isolation cannot be demonstrated, provide read/draft-only capability and mark direct execution unsupported until resolved.

Show local/paired/cloud inference location, scoped data disclosure, and account-dependent costs before activation. Local-only workspace policy prevents cloud routing, including schedules. Default routine processing remains local even with connected agents. Multiple roles do not permit simultaneous conflicting writes or unapproved cross-provider sharing of all prior context.

Do not replace a failed cloud stage silently. Preserve state and offer a supported local alternative. Keep cloud requests out of the offline proof.

### F. Shared local devices and delivery

Deliver the approved paired-device feature separately with explicit pairing, authentication/encryption, revocation, host budgets, and execution-location display. A bare model-server URL is not secure pairing. Test host loss and wait/resume semantics; no RAM merging or promised availability away from the LAN.

Prepare an actual launchable local build and exact startup instructions. Prepare truthful one-minute demo/script, reuse/dependency disclosure, known limitations, and submission checklist. Do not deploy trynonon.xyz or publish repositories/videos/posts through this handover alone.

The supplied deadline is October 10 at 10 a.m. Philippine time. Reconfirm the event time. Keep an honest delivery ledger; prioritize the working offline lead workflow and scheduler while completing requested integrations where feasible. If time or credentials prevent a feature, report what remains and continue independent work. Do not quietly delete requested scope or claim completion from UI placeholders.

## 5. Required verification

Run meaningful checks appropriate to actual implementation:

- Fresh task with external networking blocked; verify model/tools/retrieval are local and outputs reopen.
- Spreadsheet known-result, ambiguity, missing-column, duplicate, formula/format compatibility, and output validation.
- Source-grounded meeting and education outputs with missing/conflicting material.
- Original files unchanged before approval and after rejection; stale proposals rejected; accurate partial failure; supported recovery without overwriting newer work.
- Persisted schedule, run-now/due run, missed-run catch-up, restart/overlap, pause/remove, and pending review preservation.
- Gmail real authorization/retrieval where authorized; local analysis; cached-data labels; no unapproved mailbox effects.
- Every connected adapter has actual turn/cancel/error/permission evidence or an explicit untested/blocked status. Schema/connection probes are not full workflow tests.
- Same-project stage handoff uses shared revision/provenance and cannot race original writes.
- Full-process peak memory, paging, latency, idle release, and constrained-device limits recorded; never extrapolate universal hardware requirements.
- Paired host authentication/revocation, resource limits, encrypted transport, disconnection, and task continuity.
- An observed beginner path when feasible. Small observations do not prove general superiority.

Run tests/build checks appropriate to each change. Distinguish static checks, integration tests, direct runtime/visual verification, installer packaging, and live-service evidence. Do not fabricate scores or benchmark data. A requested integration lacking credentials remains incomplete even when mocked tests pass.

## 6. Reporting and deliverables

Provide:

1. NONON application/source at the isolated derivative path, exact launch instructions, and tested artifact paths.
2. Reuse inventory and maintained implementation status: done-and-tested, implemented-not-runtime-checked, partial, blocked, deferred, and remaining work.
3. Selected model/runtime/adapter versions, dependency/distribution notes, supported formats/jobs, and resource results.
4. Procedure definitions, evaluation fixtures, scheduler/config behavior, approval/recovery evidence, and live-versus-mocked service evidence.
5. Screenshots of actual implemented UI and a factual demo/submission draft; no publication claim.

Report the concrete outcome, why changes help ordinary users, how verified, and material limitations. Avoid claiming that free NONON includes free third-party model usage, all-device performance, or private local processing for cloud-selected tasks.

## 7. Copy-and-paste kickoff message

> Build NONON using <workspace>/NONON-PROJECT-PLAN.md and <workspace>/NONON-CLAUDE-HANDOVER.md. Work in the separate NONON derivative folder and preserve Pragma. The latest scope includes local scheduled procedures, direct Gmail, optional Claude/Codex/Antigravity connections, and configurable roles within one project. Keep meaningful local/offline work as the default, one companion, the three approved packs, simple onboarding, and reviewed recoverable changes. Start with the reusable-source audit, then complete a checked local workflow and scheduler before expanding. Continue routine scoped implementation without asking me to reconfirm approved decisions. Use supported authentication and report actual tests and remaining work. Do not deploy, publish, purchase services, send real email, or modify the live Pragma installation through this request.
