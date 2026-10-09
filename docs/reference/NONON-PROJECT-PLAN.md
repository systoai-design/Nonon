# NONON — product and delivery plan

Version: 1.0 · 9 October 2026 · Asia/Manila

App name: **NONON**. Intended website: **trynonon.xyz**. Domain ownership, registration, DNS, hosting, and deployment have not been verified or performed.

This is the current plan. It supersedes the earlier cloud-AI prohibition and the scheduling-as-proposal status in PROJECT-PLAN.md and PRODUCT-ARCHITECTURE-REVIEW.md. Their remaining compatible decisions and research still inform this plan. The latest direct user decisions take priority over research recommendations.

This turn produces planning and handover documents. The user requests a handover for Claude to execute the derivative, including scheduling. No application development is performed in this turn. The handover authorizes scoped NONON development when the user supplies it to the implementing agent; it does not authorize modifying the live Pragma product, buying a domain, deploying, publishing, sending messages, or changing production services.

## 1. Product promise

> NONON helps you finish everyday work with your own files, without learning how to configure or prompt AI. Useful local AI stays available when cloud services disappear.

Make supported work approachable and dependable: guided inputs, relevant instructions, deterministic calculations, editable deliverables, understandable changes, recovery, and reusable procedures. One companion represents the product across workspaces. A mascot supports approachability; validated work supplies the value.

The base application and its supported local core are free to users. Optional providers may require their own subscriptions, credits, or API billing. NONON does not promise free or unlimited third-party inference, sponsor user usage, share developer credentials, or add a NONON usage charge in this version. Free distribution does not automatically decide an open-source license.

NONON is a simpler derivative of Pragma. Reuse suitable components and assets after inspection and disclosure; do not inherit its full multi-companion interface, connected-app catalogue, permissions, context sizes, or background resource use unchanged.

## 2. Approved scope and revised decisions

| Area | Current direction |
|---|---|
| Primary users | Small-business owners, freelancers, office staff, bookkeepers/accountants, teachers/trainers, and students |
| Packs | General mode plus Business and office, Bookkeeping and finance administration, Education and study |
| Interaction | One personal companion, character selection, folder workspaces, quiet light conversation UI, contextual review panel |
| Local AI | Recommended tested configuration, meaningful standalone local inference, useful fresh tasks offline, advanced local model controls |
| Optional connected AI | Add Claude, Codex, and Google Antigravity connections through supported official interfaces; no broader provider marketplace |
| Project roles | Multiple connected agents may contribute to one project through user-selected roles; default to one active task and sequential stages |
| Privacy | Local by default. Explicit cloud permissions and visible processing location; no silent cloud fallback |
| Service integrations | No Composio. Direct Gmail first; other services deferred |
| Scheduling | Implement persisted local scheduled procedures with simple conversational setup |
| Repeat procedures | Save approved rules/templates, validate new inputs, preserve progress, and handle interruptions |
| Changes | Stage supported edits, preview, apply with required permission, record, and recover supported changes |
| Auto-apply | Explicit and workspace-scoped; not blanket permission for send/delete/commands/provider use |
| Local pairing | Approved roadmap capability: authenticated stronger owned-device host worker with resource limits |
| Coding | Supported folder assistance; website creation secondary; VS Code and a separate Developer mode deferred |
| Exclusions for initial entry | Mobile, unrestricted GUI control, broad integrations, default parallel agents, local image generation, and custom model training |
| Brand | NONON, with trynonon.xyz as the intended website |

Claude, Codex, and Antigravity are connection products/agent runtimes, not three fixed model architectures. Use models actually available to the user's account/runtime; do not hard-code obsolete model IDs or assume one is always best for a role. Installing a cloud-connected CLI locally does not make its inference local.

## 3. Beginner journey and UI

1. Choose a companion appearance/name and work pack, or General mode. These can change later.
2. Assess available memory, storage, CPU/acceleration, and runtime compatibility without depending on AI or an online login.
3. Recommend one supported local configuration. Provide clear model/runtime download progress or validate bundled offline dependencies. Do not require parameter-count decisions.
4. Select an approved folder, or use sample files. Show where outputs will be saved.
5. Begin a small useful job through ordinary language or a starting suggestion.
6. Inspect inputs, ask only consequential questions, execute locally, and show validated editable results.
7. Review/apply supported changes. Offer to save the procedure or schedule it.
8. Offer Gmail or optional connected AI only when useful. Neither is required to complete the offline sample job.

Use a compact workspace sidebar, central conversation, restrained mascot, and contextual result/review panel. Keep Stop, review/apply/reject, recovery, and processing location visible when relevant. Reduced motion and a collapsed character option remain useful.

Connections show Gmail and the three optional AI connections. Advanced settings expose local model imports, supported downloads, context/resource controls, and diagnostics. Role configuration is a small optional project setting, not a mandatory orchestration dashboard or additional companion collection.

Display inference and action locations separately: for example, AI: Local / Files: This computer, AI: Codex cloud / Files: This computer, or AI: Paired Mac / Files: This computer. Shared context remains scoped to each task; one companion does not mean an infinitely growing chat.

Approved concept images are references, not implemented screenshots or final assets:

- [Main conversation](ui-concepts/main-conversation.png)
- [Spreadsheet review](ui-concepts/spreadsheet-review.png)
- [Approval settings](ui-concepts/approval-settings.png)

## 4. Supported procedures and skills

| Pack | Initial procedure candidates | Checked output |
|---|---|---|
| Business and office | Meeting follow-up; template-based report; quotes later | Editable summary/actions/local reply draft with references and missing information flagged |
| Bookkeeping and finance administration | Compare two supported tables; repeat a comparison with fresh inputs | Matched/unmatched/duplicate/ambiguous records, deterministic totals, row references, discrepancy report |
| Education and study | Study packet; lesson outline | Source-grounded explanations, practice questions/answer key, lesson material with stated assumptions |
| General | Document understanding, drafting, reviewed file organization | Supported editable output or exact proposed rename/move list |

Lead demonstration candidate remains spreadsheet comparison; meeting follow-up is the second evaluation task. Education remains an approved pack and needs its own functioning, evaluated procedure before claims of support. A pack menu alone does not establish delivery.

Initially select CSV and a tested XLSX subset for comparison. Map columns, confirm period/units and matching rules, flag ambiguous mappings, and account for every record. Code performs arithmetic; AI interprets requests, asks questions, and explains. Recalculation, macros, external links, complex formatting, embedded objects, and live unsaved Office state are separate compatibility questions. Stop or request a supported value export when necessary.

Each procedure contains a concise trusted skill, input schema, clarification rules, tools, templates, source references, validation checks, proposed-edit types, recovery limits, and evaluation fixtures. Reuse and adapt suitable Pragma skills; create new procedures where required. Do not load the entire inherited skill library.

Use local retrieval from reviewed references with dates, sources, regional scope, and version. Start with lightweight full-text search; add local embeddings only when justified. Compression saves storage, selective retrieval bounds context, and summaries may lose exceptions. These packs are preparation and retrieval, not model pre-training. No silent training on user documents.

## 5. Local execution and resource control

One main model/task on constrained devices, bounded relevant context, on-disk progress, bounded document batches, and specialist tools loaded on demand. Unload idle inference. Measure the full process tree, previews, parsers, retrieval, paging, and model overhead.

8 GB limited mode and 16 GB recommended mode remain engineering targets, not validated minimums. Model/runtime choices must be tested on the actual target hardware. Do not inherit a large agent context default merely because it worked in Pragma. A smaller model must pass the supported task checks, not merely load.

A fully offline installation must include the required runtime, model, skills, and tool dependencies with redistribution terms checked. A smaller installer may guide downloads but cannot claim offline first installation. The local core must cold-start and complete a new supported task with external networking blocked and all cloud adapters disabled.

Shared local compute uses explicit pairing, authentication/encryption, revocation, bounded host resource use, and visible execution location. Start with remote inference, not merging RAM across machines. An unavailable host preserves task state and may require waiting; only supported steps can resume locally. This feature must not replace a meaningful standalone offline demonstration.

## 6. Optional AI connections and project roles

The latest decision permits cloud AI as an optional secondary capability. Start disconnected and local. Show which provider will receive which task information before authorizing cloud processing. Give local-only workspaces a policy that cannot be overridden by a role prompt, a retrieved document, a schedule, or provider failure.

Project settings may assign roles such as drafting, design, implementation, or review. The user's example, Claude for implementation and Codex for design, is a configurable choice, not an intelligence ranking. Antigravity is another selectable connection. Roles stay behind one companion and use one workspace, task record, input revision, and artifact history.

Run stages sequentially by default. A design stage can produce a specification that an implementation stage reads. A review stage inspects proposed outputs. Give each stage only necessary context, record provenance, and invalidate downstream results if their inputs change. Do not permit simultaneous writes to originals or pretend separate agents automatically share native conversation history.

All agents use staged copies or application-controlled tools, with enforceable access boundaries and approval on original changes. A cloud stage can expose input content even if it runs in a local child process. Pin adapter versions and avoid inheriting broad tools, credentials, plugin settings, or implicit provider configuration.

| Connection | Technical route to validate | Important condition |
|---|---|---|
| Local | Independent tested local inference adapter | No paid account needed for the supported local core |
| Codex | App-server over local stdio with mapped events, approval, and official authentication | Actual account access and billing depend on sign-in method; pin experimental interfaces |
| Claude | Unmodified official Claude Code process, or supported Agent SDK/API route | User authenticates through the official flow; app embedding and credential handling must follow current provider conditions |
| Antigravity | Official agy headless/streamed interface | Verify auth, model availability, cancellation, and isolation; workspace writes may otherwise be allowed before NONON review |

Provider states: not installed, not connected, ready, needs sign-in, unavailable, incompatible, and failed. A successful probe does not prove task quality. Show unsupported capability honestly instead of a successful-looking placeholder.

NONON must not harvest tokens or imitate a vendor's sign-in page. Keep user credentials local in suitable credential storage; avoid secrets in UI logs, prompts, shared role context, or repository files. Do not modify global provider configuration to enable a project or blanket bypass permissions to make a demo run. Installed CLI presence is not proof of login, eligibility, supported redistribution, or working integration.

Cloud failure pauses the affected step. Offer an appropriate local alternative where supported; do not silently change models or route a private task to another provider. Gmail content remains locally processed by default. Allowing cloud use for a separate project does not grant it access to all cached email or all personal memory.

## 7. Scheduling: included implementation scope

User example: Every weekday at 8 a.m., prepare my email brief and flag anything that needs my attention.

Confirm one plain-language routine card: schedule/time zone, input scope, procedure, output location, permitted actions, processing location/provider, and missed-run behavior. Allow pause, edit, run now, and remove via conversation or a small routine list. Persist the routine independently of model memory.

The first scheduler is local and lightweight. Enable background execution explicitly if the UI may close. The executing device must be powered on and awake; closing the UI only works if the worker remains active. Do not promise jobs while powered off or asleep. Default to one catch-up run after resuming, not replaying every missed daily run. Record time zone, daylight-saving behavior, overlap policy, last success, next due time, and pending review.

Daily Gmail brief:

1. Retrieve only authorized messages/threads directly from Google when online, using persisted sync/run state and bounded batches.
2. Analyze with the local model and produce an in-app/local brief with source links, explicit deadlines, suggested priorities, and optional local reply drafts.
3. If offline, label any cached-data brief with its last sync time; if inputs are absent, wait for connectivity. Never present it as a current inbox check.
4. Treat email text as data, not tool authorization. Scheduling grants no send/delete/mailbox-modification permission.
5. A cloud-backed routine needs separate explicit provider/data authorization; local execution is the default even if cloud connections exist.

Also support a scheduled local-file procedure such as a weekly report; this demonstrates scheduling without internet. Recheck input changes and preserve required approvals. Notifications remain local in the first implementation; external email delivery of a brief is a separate action.

Use persisted run IDs, locks/leases, stage checkpoints, and idempotent operations where supported. Prevent concurrent copies and blindly repeated writes, but do not claim universal exactly-once execution. Interrupted external actions require checking outcome before retry. Failed runs need useful status rather than silently disappearing.

Scheduling UI and timer creation are straightforward relative to safe unattended execution. Include meaningful restart, missed-run, permission, input-change, and disconnection tests; do not describe the entire feature as trivial.

## 8. Direct Gmail and application access

Use direct Google authorization and API access, no Composio or third-party connector broker. Explain that Gmail still belongs to Google: local inference does not make its service offline or remove Google's processing. Use appropriate scopes, stored credentials, bounded cache retention, source links, and distinct read/draft/send choices. Provider verification or account restrictions may limit public release and must be reported.

Start with read/brief/local drafting. Sending remains a supported roadmap action with explicit permission. Other Google products and broad app catalogues are deferred. Read/write saved Office files before claiming direct control of open applications. VS Code, kiosks, databases, and live Office bridges each require a scoped adapter.

## 9. Approval, recovery, and architecture

UI → procedure/task controller → local/connected inference adapter and deterministic tools → validation → proposal → permission-controlled application → task/change record.

Separate services: workspace access, local reference search, task persistence, scheduler, provider adapters, typed changes/recovery, and optional Gmail/LAN workers. Use one maintainable main execution foundation; keep the procedure/review layer testable independently. Inspect current Pragma first; alternatives remain comparisons, not automatic replacements.

Changes record target, base fingerprint, exact supported edits, reason, input/procedure revisions, validation, and recovery copy. Recheck/lock around application and use suitable atomic replacement where possible. Reject stale proposals. Recovery must not silently overwrite newer user edits. Report partial application and uncertain state accurately.

Enforce permissions in tools and isolation, not only model instructions or native CLI prompts. The same policy applies to local, cloud-connected, scheduled, and paired-device work. Workspace auto-apply never becomes broad bypass mode. No universal undo for sent email or external effects.

Task states include input inspection, clarification, execution, validation, review, application, complete, interrupted, waiting for dependency, and needs attention. Persist verified outputs and completed steps so restarts do not falsely report success or redo consequential actions.

## 10. Delivery order and acceptance

### Required delivery sequence

1. Inventory reusable Pragma code/assets, source completeness, runtime/adapters, permissions, and distribution constraints. Select a maintainable derivative structure.
2. Build the NONON shell/onboarding and a meaningful local fresh-input workflow with checked outputs and review/recovery.
3. Add functioning starter procedures for the three packs; mark each exact supported job and format.
4. Implement reusable procedures and the persisted local scheduler, including background opt-in and a local-file routine.
5. Implement direct Gmail retrieval/local brief and a daily scheduled brief with actual test-account evidence where available.
6. Add optional Claude/Codex/Antigravity adapters and same-project role stages. Validate each separately; local core never depends on them.
7. Deliver secure LAN pairing as a separate approved capability after core reliability, or clearly report remaining work if submission time prevents it.
8. Prepare tested build, disclosures, factual feature status, demo assets, and submission checklist. Publication requires separate authorization.

This order does not remove requested features. Report implemented, tested, partial, blocked by credentials/provider/platform, and remaining work separately. Do not silently mark all scope complete after producing only a local chat wrapper.

| Area | Required evidence |
|---|---|
| Offline/local | Cold-start on unseen inputs with external networking blocked and cloud adapters off; actual local inference and reopenable output |
| Spreadsheet | Known deterministic classifications/totals; ambiguous cases visible; no corrupt formulas/unsupported features |
| Meeting/education | Source-linked facts, visible missing information, editable outputs, no invented commitments/answers |
| Changes | No premature original writes, rejection unchanged, stale proposal detected, partial failure accurate, supported recovery successful |
| Scheduling | Run now, due run, pause/remove, restart, missed-run catch-up, overlap prevention, waiting/retry, and permission boundaries |
| Gmail | Real direct auth/retrieval where authorized, fresh versus cached distinction, local inference, no unauthorized send/delete |
| Connected agents | Actual auth/turn/cancel/error evidence per provider; privacy boundaries; proposed changes converge through one review layer |
| Roles | Shared input revision, sequential stage handoff, artifact provenance, no conflicting original writes |
| Hardware | Full-process peak memory/paging, response and task timing, idle release; no universal minimum claim |
| LAN | Pair/revoke/unpaired rejection, encryption, host loss/resource controls; no untested endpoint presented as secure pairing |
| Beginner use | Observe setup decisions, assistance, task success, and recovery; distinguish small formative observations from superiority claims |

The supplied deadline is October 10 at 10 a.m. Philippine time; independently reconfirm with the host before submission. If time is constrained, finish the tested offline lead workflow and scheduler first, then accurately report which additional requested integrations work. Do not publish future capabilities as current or promise a win.

## 11. Research, reuse, and sources

Competitor research is documentation/repository work, not installed-product comparison or interviews. Use matching tasks, fixtures, hardware, and model where possible when selecting a base or asserting a usability advantage. No complete replacement foundation is chosen by this document.

Read-only observations this turn: local codex, claude, and agy commands are discoverable; codex help exposes app-server and marks it experimental. No account login or inference request was run. CodeGraph finds provider/local-runtime material in a Pragma October 2 packaged preview. That snapshot is not a verified buildable source tree or a current running integration. Root package.json reported zero length; implementing Claude must locate usable source and record provenance before reuse.

Official connection references checked October 9, 2026:

- [Codex app-server](https://learn.chatgpt.com/docs/app-server): client embedding, events/approvals, version-specific schemas; prefer local stdio.
- [Codex authentication](https://learn.chatgpt.com/docs/auth): subscription and API routes have different access/billing; verify the user's route.
- [Claude Code product/authentication conditions](https://code.claude.com/docs/en/legal-and-compliance): unmodified binary, vendor-owned login, end-user billing; no collection/intermediation of subscription tokens.
- [Claude plan and SDK usage update](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan): current plan usage guidance; it does not remove app embedding conditions.
- [Antigravity headless interface](https://antigravity.google/docs/cli/headless/): JSON/streaming and native permission behavior; exit success alone does not establish tool completion.
- [Gmail sync](https://developers.google.com/workspace/gmail/api/guides/sync): direct retrieval, local cache, and sync state.

Preserve notices and evaluate exact selected component/model/asset terms. Disclose reused Pragma components, new event work, models/frameworks/APIs, and AI coding tools. The public repository, one-minute video, sponsor-tagged post, and eligibility requirements come from the supplied briefing and still require organizer confirmation and user-authorized publication.
