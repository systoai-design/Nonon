# LAN pairing evidence (shared local compute)

Workstream: LAN PAIRING. Plan section 5 and handover section F: explicit pairing, authentication and encryption,
revocation, bounded host use, visible execution location, wait/resume when the host is gone, no RAM merging.
This is optional, off by default, and the standalone offline core never depends on it.

## What exists

| Piece | Where |
| --- | --- |
| Host HTTPS server, pairing, auth, limits | `app/src/main/services/lan/host.ts` |
| Self-signed certificate (EC P-256, 10 years, `selfsigned` package, no openssl) | `lan/cert.ts` |
| Pinned-TLS client, `InferenceClient` with `location.ai = "paired"` | `lan/client.ts`, `lan/pinned.ts` |
| Tokens, hashing, pairing string, short code | `lan/tokens.ts` |
| Client token vault (refuses plaintext, same `SecretStore` shape as Gmail) | `lan/vault.ts` |
| `LanService` (status, host start/stop, code, approve/deny/revoke, pair, unpair, client) | `lan/service.ts`, `lan/index.ts` |
| Typed errors (`HostUnavailableError`, `PairedAuthError`, `PairingError`) | `lan/errors.ts` |
| UI: two cards on Connections | `renderer/.../connections/PairedDevices.tsx`, `pairingPreview.ts` |
| Task layer: wait instead of fail, no silent local fallback, workspace preference | `services/tasks.ts` (additive) |

### How it works

1. Host owner turns on "Share this computer's AI". An HTTPS server listens on port 18765 (configurable) on all
   IPv4 interfaces, TLS 1.2 minimum, with a certificate generated once and kept in `<dataDir>/lan/host-cert.pem` and
   `host-key.pem` (written 0600 where the OS honours it). Every connection from a non-private address is dropped.
2. "Make a pairing code" gives a string holding `address, port, certificate SHA-256, one-time secret (192 bits),
   host name`, plus a six digit code derived from the fingerprint and secret. The code lives 5 minutes, works once, and
   locks after 3 wrong secrets.
3. The client pastes the string. The app shows the host name and the same six digits so the person can check them.
   It then opens TLS **pinned to the fingerprint** (CA validation is off; the pin is the trust decision; nothing is
   written to the socket until the pin matches) and sends the secret and a device name.
4. The host asks its user "Allow <device>?" (event `lan:pair-request`, answer with `lan:approve` or `lan:deny`). Only on
   yes does it issue a 256-bit device token. The host stores a per-device salted SHA-256 hash, name, created, last seen.
   The client keeps the token in a `SecretStore` (Electron `safeStorage` in the app); if the OS cannot encrypt, pairing
   is refused before the host is contacted, so no code is spent and no token is orphaned.
5. Authenticated use: `Authorization: Bearer <token>`. The host exposes only `POST /v1/pair` (secret gated),
   `GET /v1/status` and `POST /v1/chat` (same fields as `InferenceRequest`, streamed as one JSON object per line).
   It forwards to `ctx.svc.runtime.client()` only. The llama-server port, files, tasks and Gmail are not reachable.
6. Revoke: `lan:revoke` removes the device and aborts its in-flight request; the client then gets 401, deletes its
   token and shows "This computer was unpaired".

### Policy decision

A paired computer is the user's own device on the user's own network, so it is **allowed in `local-only`
workspaces** and labelled "AI: Paired computer" wherever work is shown. Connected cloud providers are still refused
there. The rule lives in one place: `aiAllowed()` in `tasks.ts`.

## Verification (run on this PC, Windows 11, Node 22)

```
cd app
npx vitest run src/main/services/lan src/main/services/tasks   -> 5 files, 77 tests passed
npx vitest run                                                 -> 43 files passed, 1 skipped; 654 tests passed, 15 skipped
npx tsc -p tsconfig.node.json --noEmit / tsconfig.web.json     -> clean for my files
```

All of the following run against the **real** HTTPS host and **real** pinned-TLS client in one process over loopback.
Only the AI behind the host is a fake (labelled in `lan/testkit.ts`) except where marked REAL MODEL.

| Requirement | Test (in `lan/lan.test.ts` unless noted) | Result |
| --- | --- | --- |
| Pair success with approval; nothing issued before approval; host name and device shown | "pairs after the host user approves..." | pass |
| Pair denied; spent code cannot be retried | "denied: ..." | pass |
| Wrong secret refused; 3 wrong secrets lock the code even for the right one | "a wrong secret is refused..." | pass |
| Expired code refused | "an expired code is refused" | pass |
| Reused code refused | "a used code cannot be reused" | pass |
| Fingerprint mismatch refused, and the secret is never sent (real code still works after) | "fingerprint mismatch is refused before any secret is sent" | pass |
| Host certificate that does not match the pin is refused for an existing pairing | "a paired client will not talk to a host whose certificate changed" | pass |
| Plain HTTP to the TLS port gets no HTTP answer | "rejects plain HTTP on the port without answering it" | pass |
| TLS 1.2 or newer negotiated; TLS 1.1 refused | "negotiates TLS 1.2 or newer..." | pass |
| Unpaired and wrong-token requests get 401 with an empty body on every route | "answers 401 with no detail..." (24 request shapes) | pass |
| Only `/v1/chat` and `/v1/status` exist for a paired device (others 404) | "exposes nothing but..." | pass |
| Failed-auth rate limit: 6th failure in a minute gets 429, even with a valid token | "rate-limits failed authentication per IP" | pass |
| One paired request at a time: second gets 429 with Retry-After; first still finishes | "runs one paired request at a time..." | pass |
| Host's own work has priority (`localBusy`) | "the host's own work keeps priority..." | pass |
| Body size cap (413), maxTokens cap (400), message cap, bad temperature, bad JSON; extra fields not forwarded; absent maxTokens becomes the cap | "caps request size, token count..." | pass |
| Client refuses to send an oversized request at all | "the client refuses to send..." | pass |
| Revoke ends access at once and aborts the in-flight stream (host AI call really aborted) | "revoking ends access at once..." | pass |
| Revoked client reports "unpaired", not "unreachable"; token file removed | "a client that was revoked sees 'unpaired'..." | pass |
| Host stop mid-request becomes `HostUnavailableError`, never a local fallback | "a host that stops mid-request..." | pass |
| Host off: status "unreachable", pairing kept | "a host that is off is reported unreachable..." | pass |
| Task goes `waiting` ("your other computer"), keeps checkpoints, resumes after the host returns, step 1 not repeated, never `failed` | "a task on the paired computer waits..." (real host, real stop/start, `chatJson` path) | pass |
| Token not plaintext: host file holds only a salted hash, client file is ciphertext; neither contains the token or its secret | "stores only a hash on the host..." | pass |
| Refuses to pair when the OS cannot encrypt | "refuses to pair at all when this computer cannot encrypt..." | pass |
| Identity (certificate) survives a host restart | "keeps the same identity across a host restart..." | pass |
| Off by default; remembered "on" restarts at launch, "off" stays off | "host refuses to make a code until sharing is on", "a host that was left on restarts at launch..." | pass |
| Task layer: paired allowed in local-only, cloud still refused; waiting not failed; swallowed errors still wait; resume uses checkpoints; user Stop still `interrupted`; after restart a paired task stays paired; workspace preference honoured and never falls back to local | `services/tasks.paired.test.ts` (9 tests, real paired client pointed at a dead port) | pass |
| Pasted-code preview shows the same six digits as the host | `lan/preview.test.ts` | pass |

Mutation checks (tests really bite): with the fingerprint check forced to "ok", the two pinning tests failed; with
authentication forced to accept any known device id and revoke's abort removed, the 401 and revoke tests failed.
Both mutations were reverted.

### REAL MODEL end to end

`lan/lan.realmodel.test.ts` (skipped automatically when `E:\nonon-dev\llm-url.txt` is not reachable). The host wraps
`createOpenAiCompatClient("http://127.0.0.1:18088")` (Qwen3.5 4B Q4_K_M, dev server), a second client in the same
process pairs and chats, once via loopback and once via this PC's LAN address `192.168.254.112` (host bound to 0.0.0.0).
Both returned a real completion ("pong") over TLS and a schema-constrained JSON reply (`{"answer":42}`).
Warm timing: paired call about 60 ms against about 90 to 126 ms for the direct call, so the transport overhead is lost in the noise. The first run
of the day took 11 to 19 s because the shared dev server was cold or busy; that is the model, not the transport.

## Not verified (said plainly)

- Two physically separate computers, Wi-Fi, real packet loss, sleeping hosts. The LAN-address run is still one machine.
- Windows Firewall prompt behaviour on a clean machine, and macOS (no Mac available to this workstream), and the Mac
  prompt "accept incoming network connections".
- mDNS or any automatic discovery. Discovery is manual: the pasted code carries the address.
- Electron `safeStorage` itself. The vault is tested with a real AES-GCM fake with the same interface; the production
  adapter is the Gmail workstream's `electronSecretStore`, untested here in a running Electron.
- The packaged build (`electron-builder`): `selfsigned` was added to `dependencies`, so it is externalised and shipped.
  Not built or packaged by me.
- A packet capture. TLS is shown by the negotiated protocol, the refused plain HTTP bytes, the refused TLS 1.1 and the
  pin check, not by Wireshark.
- The UI was exercised in the browser demo bridge (`pnpm dev:web`, "Demo data"), not in Electron against the real service.

## Windows Firewall (read before demoing)

The first time the host starts, Windows Defender Firewall asks whether NONON may communicate on networks. Choose
**Private networks** (a home or office network marked Private) and press Allow. If the prompt was dismissed or Public
was chosen, the other computer will report "Cannot reach it". Fix: Windows Security, Firewall and network protection,
"Allow an app through firewall", tick NONON (or Electron in dev) for Private. NONON never changes firewall settings
itself. On a network marked Public, Windows blocks inbound connections by design; switch the network profile to Private.
On macOS an "accept incoming network connections" prompt appears the first time; choose Allow.

## Known limits

- **Priority.** "This computer's own work first" is enforced as: while a task running on the local AI exists
  (`tasks` state `running`, `location.ai = local`), paired requests get 429 and wait. Direct chat-panel answers are
  not tracked, so a chat reply can overlap with one paired request. Concurrency is capped at one paired request, so the
  worst case is two requests on the llama server, not a flood.
- **One request at a time** across all paired computers, by design (simple and bounded).
- **Waiting client.** A busy host makes the client retry for up to 2 minutes, then the task waits.
- **Revocation is host-side.** "Unpair" on the client forgets the token locally but the host keeps listing the device
  until its owner presses Remove; the UI says so. Clients cannot remove themselves from the host (no extra endpoint on purpose).
- **Code lock can be abused on a LAN.** Anyone on the network can burn a pairing code with 3 wrong guesses, which
  forces the owner to make a new one. That is the intended trade (a stolen code is worth more than a lost one).
- **Rate limit is per IP.** Two computers behind one NAT address share a failure budget. The limiter counts only failures.
- **Private addresses only.** The host drops connections from public addresses (a forwarded port will not work).
  IPv4 listener only; IPv6 not offered.
- **Certificate is permanent** (10 years). If the host's data folder is deleted, a new identity is made and clients must pair again; they
  see "That does not look like the computer you paired with" and nothing is sent.
- **Key file permissions.** 0600 on macOS and Linux. On Windows the file relies on the user-profile ACL.
- **Token in transit and at rest.** TLS 1.2+ only; token never logged, never sent to the renderer.
- **Pairing mid-task changes nothing.** Only tasks or workspaces that chose the paired computer use it.

## Contract and file edits (additive)

- `shared/contracts.ts`: `Workspace.preferredAi?`; types `PairedDevice`, `PairRequest`, `PairingCodeInfo`,
  `LanHostState`, `LanClientState`, `LanClientStatus`, `LanStatus`.
- `shared/ipc.ts`: channels `lan:status`, `lan:host-start`, `lan:host-stop`, `lan:pairing-code`, `lan:approve`, `lan:deny`,
  `lan:revoke`, `lan:pair`, `lan:client-status`, `lan:unpair`; events `lan:updated`, `lan:pair-request`;
  `workspace:update` patch accepts `preferredAi`.
- `services/types.ts`: `LanService`, `Services.lan`, `WorkspaceService.update` patch accepts `preferredAi`.
- `main/app.ts`, `main/ipc.ts`: create the service, register the handlers.
- `services/workspaces.ts`: one line so `update()` stores `preferredAi` (needed for the workspace choice).
- `services/tasks.ts`: `aiAllowed()` (one policy place), `preferredClient()`, `pauseForHost()`, host-loss watcher, and
  paired tasks stay paired after a restart. No other behaviour changed; the existing 27 task tests pass unchanged.
- `renderer/.../ConnectionsView.tsx`: one `<PairedDevices />` mount.
- `renderer/src/lib/mockBridge.ts`: demo handlers for the new channels (its `Handlers` type requires every channel).
- Dependency added: `selfsigned` 5.5.0 (in `dependencies`).
