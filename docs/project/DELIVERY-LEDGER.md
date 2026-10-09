# NONON delivery ledger

Last updated 2026-10-10 early morning, Asia/Manila. Hackathon deadline: 2026-10-10 10:00 Asia/Manila (to be reconfirmed with the host).
Every line says what was actually run. "Mocked" means a fake stood in for the real thing. Evidence for each row lives in
`docs/project/04-build-log/`. Screenshots in `docs/project/screenshots/` are of the real app (Electron), not mockups.

## 1. Done and tested

| Area | What was run | Result |
|---|---|---|
| Local AI, Windows | Real install (runtime + Qwen3.5 4B and 9B), start, answer, idle unload, quit, on an RTX 5070 (CUDA and Vulkan builds) | 4B: about 139 tokens/s, 3.5 GiB peak, first token 0.18 s; process gone after Stop and after quit (runtime-evidence.md) |
| Local AI, Mac | Packaged app on a MacBook (M5 Max): install, answer, compare task | Metal runtime, 4B, peak 3.4 GiB, same results as Windows |
| Local AI, no graphics card | 4B on CPU only, 4 threads, 16K window | 55 tokens/s reading, 13 tokens/s writing, 4.45 GiB; real 8 GB computers NOT tested |
| Nothing leaves the computer for local jobs | Every TCP and UDP connection of the whole process tree sampled every 0.5 s through start, a full comparison, idle and quit (network-inventory.md) | Zero non-loopback connections after a start-up DNS lookup and a UDP probe by Chromium were switched off. Not firewall-proof: no admin rights to add an OS-level block |
| Spreadsheet comparison (lead demo) | Known-answer fixtures (100 tests) and the real app on both OSes | Planted differences found (typo, date lag, listed twice, only-in-one); every row accounted for; amounts exact; the comparison workbook opens on a plain one-page summary |
| Changes: stage, check, apply, undo | 40 tests on real files plus the real app on both OSes | Original untouched before OK and after "no"; stale file refused; partial failure reported exactly; undo byte-identical (same hash on Windows and Mac); newer edits never overwritten; undoing a move also removes the folders it created |
| Results shown in the app | Real Electron: comparison, meeting, study packet, big file, PDF, broken file | Inline preview in the chat card plus a Results panel with every sheet; long sentences wrap; "Open the file" and "Show in folder" are kept (not clicked in the test run) |
| Meeting follow-up, study packet, lesson outline, document draft, tidy a folder | Real local AI on fixtures with known answers | Quotes checked against the source; missing owner/date flagged; instructions hidden in documents ignored; moves listed exactly and undone |
| Team draft (project roles) | Real AI, all three steps on this computer; one real run with Codex on the writing step | Steps run one at a time, each gets only what it needs, changed input re-runs only what changed, failure pauses (no switch to another AI) |
| Routines (scheduler) | 89 tests with a fake clock, plus the real app: plain-English request, confirm, run, answer once and remember, next run unattended | Survives restart; one catch-up for missed days; no overlap; never auto-approves; a routine whose cloud provider is not ready stops and says so |
| Connected AI: Codex, Antigravity | One tiny real turn each ("OK"), cancel (process tree gone), time-out, bad folder | Works; originals untouched; Antigravity's exit code 0 is not trusted |
| Sharing one computer's AI with another on the network | Real pairing between this Windows PC and a MacBook over the home network: approval on the Mac, a comparison ran on the Mac's AI with no AI process started on the PC, revoke cut access at once, with the Mac off the task waited (no fallback to the local AI) and finished after Resume. Plus 36 tests of the TLS server and pinning | Works between two physical computers. Not tested: Wi-Fi roaming, the Windows Firewall first-run prompt, a Mac as client |
| Mac, full workflow on the final signed build | The dmg downloaded from trynonon.xyz with the browser quarantine flag, opened through macOS (it ran with no blocking dialog), then: first-run screens, a comparison in plain words, results in the app, change waiting (original hash unchanged), Make the change (changed as approved), Undo (hash identical to the original and to the Windows run), meeting follow-up, a routine proposed and run, Connections, Settings, screen size | All passed in 3.1 s for the comparison on Metal, local AI peak 3.71 GiB, 0 page errors. Screens: `docs/project/screenshots/mac-final-*.png` |
| Windows installer | Built, downloaded from trynonon.xyz, installed, full workflow on the packaged app | 106 MB; works without any developer tools; unsigned, so Windows SmartScreen shows "unknown publisher" |
| Mac app: signed and notarized | Built on a MacBook, signed with the developer's own Developer ID, notarized by Apple, stapled; the dmg downloaded from the live site with the browser quarantine flag set | Gatekeeper: "Notarized Developer ID" for the app and the disk image |
| Security hardening | Review of IPC, window, file opening, downloads, packaging; fixes with tests | Every IPC message validated; files open only as documents and only inside project folders; sandboxed window, strict CSP, zip-slip proof; electron-builder fuses. Open items listed in network-inventory.md section 6.3 |
| Window frame, branding, motion | Real Electron window | Branded title strip (no generic menu bar), official logo/icons/Nunito/Non art, margin checks 397/397, 26 transitions timed (worst 95th-percentile frame 5.1 ms, none over 33 ms; 14.9 ms with the graphics card off), screen-size setting |
| Plain-language wording | Every screen and message rewritten and checked in the real app | See COPY-GUIDE.md |
| Website | trynonon.xyz: redesigned in the Pragma style with GSAP motion, three download choices (Windows, Mac, GitHub), 31 download-path checks against the live site, Lighthouse 99 to 100 | Live; installers' hashes match the published manifest |
| Full test suite | `npx vitest run` | 716 passed, 33 skipped (live tests that need a model, a program or an account) |

## 2. Implemented, tested only with fakes or on one machine

| Area | Status |
|---|---|
| Gmail (direct Google, read-only, local analysis, cached vs fresh) | 59 tests against a fake Google, plus 14 real-model emails. NOT tried with a real Google account: it needs the OAuth client file (`docs/gmail-setup.md`). Testing-mode Google sign-ins expire after 7 days. |
| Claude connection | Installed and detected, but not signed in on the test PC. Its turn, cancel and time-out are mocked. |
| Antigravity / Codex sign-in buttons | Launch paths exist; not run (they open the vendor's own sign-in). |
| Tray icon, start at login, hide-on-close | Hide-on-close verified (window hidden, process alive). The tray icon and login item were not seen. |
| Docx output opened in Word | Re-read by code only; never opened in Word. |
| Mac native window frame (traffic lights) | The final signed build ran the full workflow, but the macOS screen could not be captured from a remote session, so the native frame was not photographed. The page itself leaves room for the traffic lights. |

## 3. Not built or deliberately out

Phone app; Linux; Intel Macs (local AI needs Apple silicon); scanned PDFs; other characters (only Non); unrestricted screen control;
broad app catalogue; Composio (excluded by decision); automatic updates; model training; an offline installer (first run downloads
3 to 6 GB, then the core jobs work offline); the profession packs' reviewed reference library with local search (packs have jobs, samples and templates, not a reference library).

## 4. Blocked or needs the owner

- Google OAuth Desktop client for live Gmail.
- Claude sign-in for a real Claude turn.
- Windows code-signing certificate (or Microsoft Store) to remove the SmartScreen warning.
- Hackathon form fields, sponsor tags, and reconfirming the deadline with the host.

## 5. Honest limits to say out loud

- Small local model: explanations can be loose. The numbers in results come from code, shown beside the AI's words.
- 8 GB and 16 GB are engineering targets from the machines tested, not guarantees.
- No beginner observation study was run, so no claim that NONON beats anything.
- Local AI means the thinking happens on the computer. Gmail, Claude, Codex and Antigravity are online services; using them sends what the task needs to those companies.

## 6. Reuse and credit

Pragma by Systo AI (Apache-2.0, derived from OpenMausBot): pinned llama.cpp and Qwen3.5 references and checksums, the way the Claude/Codex/Antigravity programs are driven, the website's design system and GSAP motion architecture, and the original Pip artwork shown as Non. Everything else was built during this hackathon (see `docs/project/reuse-inventory.md`, `NOTICE`). AI coding tools: Claude (Anthropic) wrote most of the code under the developer's direction.
