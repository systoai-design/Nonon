# Network inventory and offline measurement

Audit date: 2026-10-10 (Windows 11, NONON 0.1.0 build from the working tree, Electron 43.4). Scope: every place the app, the
local engine and the website can make a network request, what is sent, when, and whether it works offline. Part 1 of the same
audit (security fixes) is summarised at the end because several fixes came out of this measurement.

## 1. Headline

- The claim "after setup, the core jobs work with the internet off and nothing is sent anywhere" is **supported for the NONON
  app on Windows by measurement, with the limits in section 5**. It is not an OS-level firewall proof (see 5.1).
- The measurement **found one real leak and it is fixed**: with nothing asked of it, Chromium looked for a proxy script on
  every start (a "wpad" name lookup on the local network and an IPv6 route probe), and again each time the window loaded. The
  window never needed it. It is now switched off (`PRIVACY_SWITCHES` in `app/src/main/hardening.ts`, applied in `index.ts`).
  After the fix a Chromium NetLog capture of a whole run holds no DNS, no proxy-script, no socket and no URL-request events.
- Everything that does leave the computer is user-triggered or opt-in, goes to a named host, and is listed in section 2.

## 2. Inventory: every network path in the code

"Trigger" says whether a person starts it or it happens by itself. "Offline" says what happens with no internet.

| # | Where (file) | Trigger | Destination host | What is sent | Offline |
|---|---|---|---|---|---|
| 1 | Engine and model download: `app/src/main/services/runtime/download.ts:46` (`fetch`) | User presses install (`runtime:install`); resumes a partial file | `github.com/ggml-org/llama.cpp/releases/download/b10909/*` (302 to `release-assets.githubusercontent.com`); `huggingface.co/unsloth/Qwen3.5-{4B,9B}-GGUF/resolve/<pinned sha>/*` (302 to `us.aws.cdn.hf.co`). Redirect hosts were read with a HEAD request on 2026-10-10. | A plain HTTPS GET, plus `Range: bytes=N-` when resuming. Node default headers, your IP address and TLS server name. No file, setting or user data. | Fails with a plain message; the partial file is kept. Not needed after install. Only `github.com/ggml-org/llama.cpp/` and `huggingface.co/unsloth/` are allowed; size and SHA-256 must match the pin before the file gets its final name; a redirect that leaves https is refused (new). |
| 2 | Local engine health and chat: `runtime/index.ts:232`, `runtime/llama-client.ts:81` | Automatic while a job or chat runs | `127.0.0.1:<random port>` (llama-server) | The prompt, which includes your document text, plus a per-run random key | Yes. Loopback only. |
| 3 | The engine process `llama-server` (started by `runtime/index.ts`) | Starts with the first job, stops after the idle timeout or on quit | Listens on `127.0.0.1` only (`--host 127.0.0.1`, `--no-webui`) | Nothing outbound seen in any run | Yes |
| 4 | Gmail connect: `gmail/oauth.ts`, `gmail/service.ts` | User presses Connect Gmail | `accounts.google.com` (opened in your own browser through `shell.openExternal`); a one-shot listener on `127.0.0.1:<random>/callback` (2 minutes, state-checked, PKCE); `oauth2.googleapis.com/token` | OAuth client id and secret from your `google-client.json`, the one-time code and PKCE verifier | Needs internet. Off by default (no client file means "not set up"). |
| 5 | Gmail token refresh and disconnect: `gmail/oauth.ts` | Automatic when an access token has expired and a brief is requested; user presses Disconnect | `oauth2.googleapis.com/token`, `oauth2.googleapis.com/revoke` | Refresh token (or the token being revoked), client id and secret | Brief falls back to saved mail |
| 6 | Gmail read: `gmail/api.ts:153-185`, `gmail/sync.ts` | User asks for a brief, or a saved routine with the read-mail permission comes due (automatic, only while the app or its background mode is running) | `gmail.googleapis.com/gmail/v1/users/me/{profile,messages,messages/<id>,history}` | Bearer access token, `labelIds=INBOX`, `q=newer_than:Nd`, message ids. Scope is `gmail.readonly` only. | Yes: the brief is built from saved mail and labelled "Saved copy ... not a current check". With nothing saved it asks to connect once. Saved mail is kept 14 days (200 messages) in plain JSON in the data folder. |
| 7 | Shared computer, host: `lan/host.ts` | Only after the user turns sharing on (off by default; remembered once on) | Listens on TLS `0.0.0.0:18765`. Every connection from an address that is not loopback, private, link-local or IPv6 unique-local is destroyed before any HTTP. | Receives a pairing secret and device name, then chat requests from paired devices (these contain document text). Sends the AI's reply. | Works on a LAN with no internet |
| 8 | Shared computer, client: `lan/client.ts`, `lan/pinned.ts` | User pastes a pairing code; then whenever a project is set to "use my other computer"; the Connections screen status check | Host and port from the pairing code (normally a private IP) | Device name and one-time secret at pairing; afterwards the bearer token and the prompts (document text) | Works on a LAN with no internet; if the host is gone the job waits |
| 9 | Connected AI, status checks: `providers/claude.ts`, `codex.ts`, `agy.ts` (`probe`) | Automatic: the first `app:state` (every start) probes all three | Runs the vendor program with `--version`, `--help`, `auth status` / `login status` | Nothing from NONON | n/a. The vendor programs opened no sockets in the polling described in 4.3. |
| 10 | Connected AI, a job: `providers/*.ts` `runTurn` | Only when a project allows online AI and the person starts a step with that connection | The vendor's own servers (Anthropic, OpenAI, Google). NONON makes no request itself. | The prompt and copies of the chosen input files in a temporary folder, through the vendor program's own connection | No |
| 11 | Connected AI, sign-in: `providers/claude.ts runVendorSignIn`, `agy.ts openInTerminal` | User presses Sign in | The vendor's login page, opened by the vendor program | Nothing through NONON | No |
| 12 | Links: `index.ts` `setWindowOpenHandler`; `renderer/src/views/lib.ts openHttps`; `BriefView.tsx` | User clicks a link (the only one the UI makes is "open this email": `https://mail.google.com/mail/u/0/#inbox/<thread id>`) | Your default browser | NONON sends nothing; the browser requests the page | No |
| 13 | The window (renderer) | Never | Blocked three times: CSP `connect-src 'self'`, `session.webRequest.onBeforeRequest` cancels everything except `file:`, `data:`, `blob:`, `devtools:`, and `no-proxy-server` plus `host-resolver-rules` leave Chromium nothing to resolve | Nothing | Yes |
| 14 | Chromium itself (before the fix) | Automatic at start, and again when the window (re)loads | Local network DNS for `wpad`, Windows DHCP proxy discovery, UDP route probe to `[2001:4860:4860::8888]:443` | The name "wpad" to your DNS resolver; the route probe is a `connect()` on a UDP socket (no payload) | Was happening offline too. Fixed: see 3. |
| 15 | Updates, telemetry, crash reports, fonts, CDN | None | None. No `electron-updater`, no `autoUpdater`, no `crashReporter`, no analytics code (grep of `app/src`); the font is bundled; electron-builder runs with `--publish never`. | Nothing | n/a |
| 16 | Local helper programs (no network): `nvidia-smi`, `powershell Get-CimInstance`, `reg query`, `tasklist`, `taskkill`, `tar.exe` (unpack), `cmd /c start` (Antigravity sign-in) | Hardware check, process tidy-up, unpack, sign-in | none | n/a | Yes |
| 17 | Dev only: Vite dev server through `ELECTRON_RENDERER_URL` | `pnpm dev`; ignored when the app is packaged (`app.isPackaged`) | `localhost` | n/a | n/a |
| 18 | Website `trynonon.xyz` (`site/src/worker.ts`) | A visitor | Cloudflare Worker serving static files, `GET /api/latest` (reads `latest.json` from R2) and `GET /dl/<file>` (R2). The pages load nothing from other companies' servers (CSP `default-src 'none'`, self-hosted fonts, no cookies, no analytics). `huggingface.co/Qwen`, `github.com/ggml-org/llama.cpp`, `fonts.google.com/specimen/Nunito` and `www.trypragma.xyz` are plain links a visitor may click. | Normal web request data. Worker logs are on (`observability`, sampling 1.0), which records request metadata at Cloudflare. | n/a. **The app never contacts the site** (no `trynonon` string in `app/src`), so downloads and update checks are manual. |

Not network but worth knowing: the per-run key for the engine travels in the environment, not on the command line;
Antigravity (`agy`) is given the prompt on its command line (up to a length limit, longer prompts go in a file), so other
programs run by the same user can read that prompt while the step runs. That is the vendor program's interface, not something
NONON can change.

## 3. The leak that was found and fixed

NetLog (Chromium's own network log, `--log-net-log`) of an unmodified build, 95 seconds, nothing but start, wait, one job and quit:

- `PROXY_CONFIG_CHANGED {auto_detect: true, from_system: true}` at 133 ms, which starts `PAC_FILE_DECIDER`.
- `WPAD_DHCP_WIN_FETCH` (asks Windows for a proxy script address through DHCP), then `HOST_RESOLVER_MANAGER_REQUEST host=wpad:80`
  through the system resolver ("No such host is known", os_error 11001), 4 lookups in the run.
- `UDP_CONNECT [2001:4860:4860::8888]:443` (IPv6 reachability probe, 2 in the run; `connect()` on UDP sends no payload).
- The same burst again at +8.2 s, when the harness reloaded the window (2 proxy-decider runs per burst, 4 lookups and 2 route probes in all). No URL request caused it; Chromium does this on its own when the system proxy is "auto-detect". Nothing else appears in the 93 s log until the QUIC pool closes at quit.

Fix, in `app/src/main/hardening.ts` (`PRIVACY_SWITCHES`) and applied before `ready` in `index.ts`:
`no-proxy-server`, `disable-background-networking`, `disable-component-update`, `disable-domain-reliability`, `no-pings`, and
`host-resolver-rules = MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1`. They only affect Chromium (the window).
Downloads, Gmail and the paired computer run in the main process through Node and are not touched. A corporate proxy is
therefore not used for those today either (Node's `fetch` never read the system proxy); worth knowing for a user behind one.

After the fix the NetLog of the same run holds only `DNS_CONFIG_CHANGED`, `PROXY_CONFIG_CHANGED`, `HTTP_SERVER_PROPERTIES_INITIALIZATION`
(x2) and `QUIC_SESSION_POOL_CLOSE_ALL_SESSIONS` (x2): configuration bookkeeping, no lookups, no sockets, no requests.

## 4. Measurement

### 4.1 Method

- Harness `E:\nonon-dev\e2e\audit-offline.mjs` (Playwright-electron, same pattern as `flow.mjs`). Args `--user-data-dir=E:\nonon-dev\ud-audit`
  and `--log-net-log=<file>`. Data folder `E:\nonon-dev\audit\data-<tag>`; model folder is a private copy
  (`audit\models`: a hard link to the 4B GGUF and a junction to the installed engine) so the shared `install-test` engine and its pid file were not touched.
- Phases written to `phase.txt` by the harness: startup, probes (hostile-renderer attempts, 4.4), idle (60 s), task, post-task idle (15 s), quit, after quit.
- The task is the lead demo: the spreadsheet comparison of `expense-report-may-2026.csv` and `bank-export-may-2026.csv`, started through the same IPC
  the window uses (`chat:send`, `task:answer`), with the real local model (Qwen3.5 4B Q4_K_M, CUDA, llama.cpp b10909) writing the explanation.
- Sampler `E:\nonon-dev\audit\sample-net.ps1`: about every 0.5 s it lists all TCP and UDP sockets with their owning PID (`netstat -ano`, 25 ms), keeps those owned by the
  app's **whole process tree** (root plus every descendant ever seen: Electron main, GPU, network service, renderers, llama-server and helper programs), and every 8 s
  repeats the lookup with `Get-NetTCPConnection` and `Get-NetUDPEndpoint` as a cross-check (they take about 1.2 s, too slow for the fast loop).
  Each row carries the process role taken from its command line (`--type=` and `--utility-sub-type=`).
- Run "final": 178 samples, median interval 0.51 s, 95th percentile 1.07 s (the slow ones are the process-tree refresh), longest 2.16 s.
- Run "bn" (same, with Node networking blocked in the main process, see 4.2): 118 samples.

### 4.2 Hard block inside the main process ("bn" run)

No admin rights (`net session` returns "Access is denied"), so no Windows Firewall rule could be made and none was attempted.
Instead `E:\nonon-dev\audit\blocknet.cjs` was loaded into the Electron main process before the app code. It refuses every non-loopback TCP connect,
DNS lookup and UDP send made through Node and logs each attempt. A deliberate self-test from the main process
(`fetch("https://example.com/")`) was refused (`BLOCKNET refused tcp-connect to example.com:443`), proving the block was active. The whole flow then ran
(start, idle, comparison with the local model, quit) and **the log holds exactly one entry, the self-test, and none from the app**. The task finished
`review` with all checks passing and a model-written summary, and the engine started on CUDA in 1842 ms.

### 4.3 Result: connections seen (runs "final" and "bn")

Loopback means 127.0.0.1 on both ends.

| Process (role) | Phases seen | Sockets | Remote endpoints |
|---|---|---|---|
| `cmd.exe` (Playwright launcher, root) | all | none | none |
| `electron.exe` main | startup, idle, task, post-task idle, quit | TCP LISTEN on two ephemeral 127.0.0.1 ports, each with an ESTABLISHED loopback partner inside the same process (most likely Node/libuv internal socket pairs, or the Playwright link; not investigated further); during the task a short TCP "Bound/Established" to the engine port | loopback only |
| `electron.exe` gpu-process | all | none | none |
| `electron.exe` utility `network.mojom.NetworkService` | all | none | none |
| `electron.exe` renderer (x1 or x2) | all | none | none |
| `llama-server.exe` | task, post-task idle | TCP LISTEN on one ephemeral 127.0.0.1 port, ESTABLISHED loopback to Electron main | loopback only |
| helper programs (`tasklist`, `conhost`; `claude.exe` once, a startup status check) | brief | none seen | none |
| UDP, all processes | all | **0 endpoints** in every sample | none |
| **Non-loopback TCP/UDP rows** | **all phases** | **0** | **none** |

The unmodified build ("base") also showed loopback only at the socket level (a slower 4 s sampler); its leak was visible only in the NetLog (section 3), because a name
lookup and a UDP `connect()` last milliseconds.

### 4.4 Attempts from a hostile window (run "final", `PROBES=1`)

Code running in the window tried: `fetch`, `XMLHttpRequest`, an image and a WebSocket to `https://example.com` and `wss://example.com`; `fetch` to the loopback engine port
(`127.0.0.1:18088`); `location.href = "https://example.com"`; `window.open` of a web address and of `file:///C:/Windows/win.ini`; and IPC calls with
`../settings`-style ids, `shell:open` of `C:\Windows\System32\calc.exe`, `output:preview` of `C:\Windows\win.ini` and a junk `settings:update`.
Every one was refused or ignored: the CSP blocks all five request types, the page URL does not change, no second window opens, and each IPC call returns a plain error.
`getLastWebPreferences()` reported `sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true`. The same probes passed against the packed Windows build
(section 6.1, last row). The preload under `sandbox: true` was also checked directly: `window.nonon` exposes `call`, `on`, `pathForFile` and `platform`, `pathForFile` does not throw, and the page has no `process` or `require`.

## 5. What this does and does not prove

1. **Not an OS firewall proof.** The network was up during every run. What is proven: with the machine online, no non-loopback connection was observed in any
   phase at 0.5 s resolution, the Chromium network stack logged no request, and with Node networking forcibly refused the job still completed. A Windows Firewall
   outbound block for the test process needs admin rights. When an admin account is available, one rule per executable
   (`New-NetFirewallRule -Direction Outbound -Action Block -Program ...\electron.exe`, same for `llama-server.exe`) plus the same harness would close that gap.
2. **Short connections can be missed.** A socket that opens and closes in under half a second may not be sampled; that is why the NetLog (which records them all
   for Chromium) was captured too. Native code outside Chromium (`llama-server`) is covered by the socket samples only, and by the fact that it listens on loopback
   and is given no address to call.
3. **Vendor programs are outside NONON.** At start NONON runs `claude`, `codex` and `agy` status commands if they are installed (row 9). A separate 7-command
   polling test (every ~100 ms, `E:\nonon-dev\audit\probe-cli-net.ps1`) saw no sockets, but those programs exist to talk to their vendors and a later version may
   check for updates or refresh a login at that moment. Recommendation (not applied, it changes the Connections behaviour owned by another workstream): probe them only when the person opens Connections.
4. **macOS was not measured.** The switches are cross-platform; the WPAD finding is from Windows' proxy auto-detect.
5. **Only the local core was exercised.** Gmail, the paired computer and connected AI need networks by design (rows 4 to 11) and were not run in this audit.
6. The first-time setup needs the internet once (row 1). "Works offline" means after that.

## 6. Security review results (part 1 of the audit)

Method: read the Electron entry, IPC, every service that touches files, processes or sockets, the Worker, and the build/packaging config; fixed what was real with
tests; ran every claim that could be run. Tests: `npx vitest run` from `app/` 716 passed, 33 skipped (the 33 are the live and real-model suites that need a model server or a cloud login); `tsc -p tsconfig.node.json` clean.

### 6.1 Fixed (all with tests)

| Finding | Fix | Tests |
|---|---|---|
| IPC accepted anything. Ids became file names (`chat/<id>.json`, `tasks/<id>.json`), so `chat:history {workspaceId:"../settings"}` or `task:get` could read any `.json` under the data folder or above it. | `app/src/main/ipc-schema.ts`: a zod schema for every channel (ids `[A-Za-z0-9_-]{1,100}`, paths and text length-capped, enums, unknown keys dropped); `parseArg` runs before every handler. | `ipc-schema.test.ts` (9, including "has a schema for every channel and no extras", traversal ids, `__proto__`/`constructor`) |
| IPC did not check who was calling. | `ipc.ts`: the sender frame must be the main frame and its URL must be the bundled page (or, unpackaged, the dev server on localhost). | proven live: window calls work; checked in `hardening.test.ts` (`isAppPage`) |
| `shell:open` ran `shell.openPath` on any file inside a project folder by lexical path: a program, script, shortcut or a link pointing out of the folder would be started or followed. | `app/src/main/shell-guard.ts`: real path (links and junctions resolved) must be inside a project folder; only document types open (csv, xlsx, txt, md, json, docx, pdf, rtf, pptx, png, jpg); both the given and the real name are checked; `shell:reveal` also uses real paths. | `shell-guard.test.ts` (8): 18 executable/script/shortcut names, outside, `..`, file link, junction, link named .txt to an .exe |
| `will-navigate` accepted any `file://` page and any string starting `http://localhost` (so `http://localhost.evil.com`). Windows opened any https URL, including ones with embedded credentials. | `hardening.ts` `isAppPage` (exact page), `isSafeExternalUrl` (https, no credentials, bounded length), also `will-redirect`, `will-attach-webview`. | `hardening.test.ts` (8) |
| The window had `sandbox: false`. | `sandbox: true` (the preload only uses `ipcRenderer`, `contextBridge`, `webUtils`), plus `webSecurity`, `allowRunningInsecureContent: false`, `webviewTag: false`. Verified in the live run and in the packed build. | live `getLastWebPreferences()` |
| Window requests: CSP allowed any localhost port and there was no second layer; permissions were default. | CSP now `connect-src 'self'` with `object-src`, `frame-src`, `base-uri`, `form-action` set; dev socket allowance only through a dev-server plugin (`electron.vite.config.ts`); `session.webRequest` cancels every non-local request; every permission denied except clipboard write. | `hardening.test.ts`; live probes (4.4) |
| Chromium phoned a proxy-discovery lookup on its own. | section 3 | `hardening.test.ts` (switch list); NetLog before and after |
| A link inside a project folder could lead a job into NONON's own data folder (`placeInput` checked the name, not the real path) and so copy saved sign-ins or the host key into the project. | `tasks.ts` uses `isReallyInside` for the data folder. | covered by the existing task tests; the helper is the same one `shell-guard.test.ts` exercises |
| A download could be redirected off https. | `download.ts`: refuse a redirected response whose final URL is not https. | `download.test.ts` (2 new) |
| Unpacking the engine archive: is zip-slip possible? | No: the archive is size- and SHA-256-checked before it is unpacked, and the system `tar` (bsdtar) refuses `..` entries and strips a leading `/`. Proven with a real zip containing `../`, `sub/../../`, `..\` and `/x` entries. | `download.test.ts` "keeps entries that climb out of the folder..." (Windows) |
| Packaged app fuses were all default. | `electron-builder.yml` `electronFuses`: `enableNodeOptionsEnvironmentVariable: false`, `enableEmbeddedAsarIntegrityValidation: true`, `onlyLoadAppFromAsar: true`. Built a packed `win-unpacked`, ran the whole flow and the hostile probes on it: all pass. | packed run |

### 6.2 Checked and fine

- LAN host: TLS 1.2+ with a self-signed P-256 certificate pinned by SHA-256 (the client sends nothing before the pin is checked); tokens are 256 bits and stored only as per-device salted hashes;
  hash compare is constant time and runs for unknown ids too; pairing secrets are 192 bits, single use, five-minute expiry, locked after three wrong tries, and need a person's approval; failures are
  rate-limited per address; body size capped (512 KB, 413 with bounded drain); one chat at a time; at most 3 pending pairings; 32 connections; header and request timeouts; non-private peers dropped;
  default off.
- Gmail: scope `gmail.readonly` only (plus `openid email`); PKCE S256; state compared in constant time; loopback listener closes after the first callback and after two minutes; refresh token only in `safeStorage`
  (nothing is written when the OS cannot encrypt); tokens never in logs or the window.
- Provider programs: no shell; binaries found by explicit lookup; environment is an allow-list (`buildChildEnv`); the working folder is a throwaway copy; the prompt goes through stdin (Claude, Codex);
  staged output is only ever turned into new-file suggestions; the isolation checks in `claude.ts` stop a turn that shows unexpected tools or MCP servers; secrets are scrubbed from errors.
- Model output: markdown is rendered to React nodes (no `dangerouslySetInnerHTML`, no `innerHTML`, no `eval` in the renderer or main, no links from model text); the local model has no tools, and its output is validated before use.
- Worker `/dl/*`: names must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` and an allow-listed extension, so no path separators, no percent-escapes and no `latest.json`; range requests parsed strictly; strict CSP and
  security headers on every response; only GET and HEAD.
- Auto-apply: workspace-scoped, explicit, never covers moves, and only when every check passed; every write makes a recovery copy first.
- Spreadsheet output cannot carry formulas from data: status and note cells always start with fixed text.

### 6.3 Open (not fixed), with reason

1. **Claude read scope not verified.** `claude.ts` passes `--allowedTools Read Glob Grep` with `--permission-mode dontAsk`. A bare `Read` allow rule may let the vendor program read files outside the throwaway folder if a document
   injects instructions. I could not test it: the standalone `claude` login on this machine is expired ("OAuth session expired"), and signing in is Kyle's step. Suggested check once signed in: run the adapter args with a canary file outside the cwd and see
   whether it is read; if it is, drop `--allowedTools` (reads inside the cwd need no allow rule) or use `Read(./**)`. Only reachable for a project that allows online AI.
2. **Codex runs with the read-only sandbox**, which still lets it read the whole disk. Same exposure, same precondition; it is the vendor's sandbox model.
3. **The renderer is trusted with paths.** `task:start`/`chat:send` accept any file the window names and copy it into the project, and `workspace:create` accepts any folder. A compromised window could therefore pick files. Fixing it means
   remembering which paths came from the native dialogs, which would break the e2e scripts that pass paths directly; the CSP, the request block and the schema make a compromise much harder, and no `innerHTML` path was found.
4. **Host key not encrypted.** `lan/host-key.pem` is written 0600 (ignored on Windows) in the user's profile. Encrypting it with `safeStorage` is possible but would need a startup migration.
5. **Saved mail is plain JSON** in the data folder (14 days, 200 messages). Tokens are encrypted; the mail is not.
6. **OAuth callback can be cancelled by a bad request.** A wrong `state` on the loopback callback ends that sign-in attempt (the user just retries). Not a data risk.
7. **Antigravity prompt on its command line**, and its Mac sign-in builds an AppleScript string from the program path (`agy.ts:197`). Only odd install paths matter.
8. **Fuses left at default** with reasons in `electron-builder.yml`: `runAsNode` (needed by `providers/bin.ts` fallback), `enableNodeCliInspectArguments` (Playwright), `grantFileProtocolExtraPrivileges`
   (turning it off made the packed app fail to load its page: `ERR_FILE_NOT_FOUND` from the asar). Mac builds were not tested with the fuses.
9. **Document parsers** (exceljs, mammoth, unpdf) run on untrusted files in the main process; size limits exist for previews but a decompression bomb could still stall the app. No known exploit; not mitigated.
10. **`pnpm audit`**: no high or critical (details in `publication-readiness.md`).
11. The sender check in `ipc.ts` (main frame only, bundled page only) is covered by unit tests of `isAppPage` and by every window call succeeding; a call from a foreign frame was not staged end to end (the CSP forbids frames, so there is no way to make one from the app).
12. The runs used the working tree as of 2026-10-10 01:10; other workstreams were editing the window code (a `Spinner is not defined` page error appeared in two runs) at the time. The security changes do not depend on it.
