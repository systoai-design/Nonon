# Connected AI providers: evidence log

Workstream: PROVIDERS. Date of runs: 2026-10-09, Windows 11, this PC. Code: `app/src/main/services/providers/`.
A probe is not a quality test. "Real" below means a real vendor program on this PC; "mocked" means `fixtures/fake-cli.mjs` or an in-memory fake adapter.

## Installed programs (read from the machine)

| Provider | Program | Version | Sign-in state seen by NONON's probe |
|---|---|---|---|
| Claude | `claude` 2.1.280 (npm global, resolves to `claude.exe`) | 2.1.280 | `needs-sign-in` (`claude auth status` says loggedIn false; stored OAuth session expired) |
| Codex | `codex` (npm global, `node codex.js`) | 0.153.4 | `ready` (`codex login status`: signed in with ChatGPT) |
| Antigravity | `agy.exe` in `%LOCALAPPDATA%\agy\bin` | 1.3.2 (it self-updated from 1.2.17 during the session) | `not-connected`, `verified: untested` (agy has no sign-in status command) |

Nobody was signed in or out by this work. No CLI config was changed. Each ready provider received a handful of tiny turns on the owner's own plan.

## What was REAL, per provider

| Check | Claude | Codex | Antigravity |
|---|---|---|---|
| Find binary, read version | real | real | real |
| Probe without a model turn | real: `--version`, `--help` flag check, `auth status` | real: `--version`, `exec --help` flag check, `login status` | real: `--version` only |
| One tiny turn "Reply with the single word OK." through `clientFor` | NOT RUN (not signed in) | real: answer `OK`, 4.6 to 7.1 s, 19.5k prompt tokens | real: answer `OK`, 8 to 16 s, 12.9k prompt tokens |
| Forced turn while signed out | real: plain error `auth` ("Claude needs you to sign in again...") | n/a | n/a |
| Cancel mid-turn, process tree gone | mocked only | real: 3 processes alive before abort, 0 after (`AbortError`) | real: 2 alive before, 0 after (`AbortError`, first output seen first) |
| Forced timeout (2.5 s), tree gone | mocked only | real: error `timeout`, 0 leaked | real: error `timeout`, 0 leaked |
| Bad working folder | mocked | real: plain error `spawn` | real: plain error `spawn` |
| Write attempt in staged copy | not run | real: model reported read-only, staged diff empty, nothing proposed | real: tool refused, no answer, staged diff empty; reported as an error, not success |
| Long prompt (15,729 chars) via task file | n/a (stdin) | n/a (stdin) | real: needle `PERSIMMON-42` returned |
| Local-only workspace refusal, no provider process started | real service | real service | real service |

Real results are reproducible with `NONON_LIVE=1 npx vitest run src/main/services/providers/live.test.ts` from `app/` (writes `E:\nonon-dev\provider-live\evidence.json`). Last full run: 14 of 14 passed.

Not verified on a real Claude: the success path of a turn (stream-json text, cost, usage). The signed-out error shape and the `system/init` event (which showed `tools: []`, `mcp_servers: []`, `skills: []`, built-in plugins only) were captured from the real program; the success stream is mocked from the documented shape. Claude stays "untested end to end" until someone signs in and runs `service.verify("claude")`.

## Findings that changed the design (all from real runs)

1. **agy loaded the owner's global tool servers.** A real turn started every MCP server in `~/.gemini/config/mcp_config.json`, including a database server, plus their skills and notes (32.9k prompt tokens for "OK"). agy's login lives in the system keychain, so the adapter now runs agy with a throwaway `HOME`/`USERPROFILE` (sibling folder `turn-xxxx-home`, deleted after the turn). Verified: login still works, process tree is just `agy.exe` and its console host, prompt size fell to 12.9k tokens, nothing under the real home is touched.
2. **`codex app-server` cannot skip the person's own config.** A real turn through it started their MCP servers (code index, docs lookup, script runner) and used their config model, which their ChatGPT account rejects (HTTP 400, "model not supported"). The `-c mcp_servers={}` override does not remove configured servers. The adapter therefore uses `codex exec --json --ignore-user-config --ignore-rules --ephemeral --sandbox read-only -c approval_policy="never"` with optional features disabled. Verified: process tree is `node`, `conhost`, `codex.exe` only. This is a deliberate deviation from "app-server first" in the brief. Login still comes from Codex's own store; `auth.json` is never read or copied by NONON.
3. **The owner's global Codex config is `danger-full-access` + `approval never`.** Relying on defaults would have given a turn full access. The explicit flags above override it. Codex does not report its effective sandbox in `exec --json`, so `effective.sandbox` is recorded as "requested", not "observed". Observed behaviour: the write attempt was refused by the model with nothing changed.
4. **Codex read-only mode on this Windows PC blocks even shell reads of files in the working folder** ("blocked by policy"). Plain-text inputs are therefore also placed in the prompt text (`run-turn.ts`), and the staged copy is kept for providers that can read it.
5. **agy soft-denies tools and can exit 0 with an empty answer.** Confirmed live. The adapter requires a `result` event with `status SUCCESS` and a non-empty response; otherwise it throws (`empty`, "needed a tool that was refused"). Exit code is never used as proof.
6. **Claude reports auth failure as `result.subtype "success"` with `is_error: true`.** Real capture. The adapter checks `is_error`, not subtype.
7. **Host variables leak by default.** This session's shell carried another tool's `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_*` session tokens and similar. Child processes get an allowlisted environment (system basics, proxy and certificate variables, plus `CLAUDE_CONFIG_DIR` or `CODEX_HOME`); API-key variables are not passed, so a vendor's subscription login is what is used. Unit-tested.
8. **agy `--print` takes the prompt on the command line**, and Windows caps that near 32,000 characters. Prompts over 12,000 characters are written to `NONON-TASK.md` in the staged folder and agy is told to read it (verified live), then the file is removed.

## Isolation actually enforced

- Claude: `-p --output-format stream-json --verbose`, prompt on stdin, `--tools ""` (text turns) or `--tools Read,Glob,Grep` plus `--allowedTools` (file turns), `--permission-mode dontAsk`, `--permission-prompts none`, `--strict-mcp-config`, `--setting-sources project`, `--safe-mode`, `--restricted`, `--disable-slash-commands`, `--no-session-persistence`. The `system/init` event is checked every turn: any tool outside the allowed set or any MCP server kills the turn as an isolation failure (mocked test; real init showed empty tools and servers). Never `--dangerously-skip-permissions`. The probe refuses (`incompatible`) when a required flag is missing from `--help`.
- Codex: see finding 2 and 3.
- Antigravity: `--sandbox`, `--disable-slash-commands`, throwaway home, throwaway staged cwd, never `--dangerously-skip-permissions`. Unlike the others, agy has no flag that turns off write tools, so the guarantee is the staged copy plus the diff, not the vendor's refusal.
- All: staged folder created by NONON with only the minimum inputs; after the turn it is diffed against what NONON put in; changes come back only as `ChangeProposalDraft`s (`create-file` into the workspace output folder, never an original path) and text; deletions and binary changes are reported, not applied. The folder is deleted in `finally`, and `turn-*` folders older than an hour are swept at startup.
- Kill: `taskkill /PID n /T /F` on Windows, process group SIGKILL elsewhere. Timeout 5 minutes per turn by default.

## Unit tests (MOCKED, labelled in each file header)

`npx vitest run src/main/services/providers`: 93 passed, 14 live tests skipped without `NONON_LIVE=1`.
They use `fixtures/fake-cli.mjs` (real child processes speaking the captured shapes) and in-memory fake adapters behind the real service. Covered: stream parsing and noise lines, isolation arguments, tool/MCP breach detection, `is_error` mapping, missing result, refused tools with exit 0, abort and timeout killing a grandchild process, bad cwd, secret scrubbing, host-environment allowlist, local-only refusal (including a policy change after the client was made), not-ready refusal, no fallback to another provider or the local model, status evidence (`probe-only` to `turn-tested`, agy remembered across restarts and forgotten on a version change, incompatible mark), roles persistence, stage sequencing, minimal hand-off, provenance, invalidation, pause on failure, overlap lock, staging diff to proposals.

## Not verified / open

- Claude success turn, Claude cancel and timeout against the real program (needs a signed-in Claude).
- `signIn()` launch paths for all three (Claude `auth login`, Codex `login`, agy in a terminal window) were not run, by instruction. The agy path opens an interactive terminal on Windows (`cmd /c start /wait`) and Terminal.app on macOS; both untested.
- macOS and Linux: path resolution, process-group kill and the throwaway-home trick for agy are untested on a Mac. The code has the branches; the lead may run `live.test.ts` over SSH.
- The 5 minute default turn time limit and the 200 KB inline-text cap are untuned.
- agy writes its own state into the throwaway home each turn and may check for updates there; observed turn times of 8 to 16 s include that.
- Codex skills: 265 skills from the owner's Codex folder still exceed the context budget and produce a warning item; they are text only, no tools.
- Quota used: across several full runs and exploratory runs, a few dozen tiny turns per provider (most cancelled or timed out within seconds). Codex and agy each ran one 15k-character prompt at most. Nothing larger was run.
