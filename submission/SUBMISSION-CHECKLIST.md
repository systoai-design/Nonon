# NONON submission checklist

**UPDATE 2026-10-10, early morning (supersedes the statuses below where they differ):**
- Public repository: DONE. https://github.com/systoai-design/Nonon is public (Apache-2.0), one clean commit history, no installers or private paths.
- Final builds: DONE. Windows installer and signed, notarized Mac disk image are live at https://trynonon.xyz/download; their SHA-256 values match the published manifest.
- Brand pack: DONE. The official logos, icons, Nunito and Non art are in the app and the website; the demo video was re-recorded on the final build.
- Website: DONE. Redesigned in the Pragma style with GSAP motion; three download choices (Windows, Mac, GitHub).
- Tests: 716 passed, 33 skipped.
- Still needs Kyle: upload the video and paste the link, the post and sponsor tags, any form fields not in `FORM-ANSWERS.md` (team name), and reconfirm the deadline with the host.

As of 2026-10-10, about 01:00 Asia/Manila. Deadline given: 2026-10-10 10:00 Asia/Manila. Sources: `docs/reference/NONON-PROJECT-PLAN.md` sections 10 and 11, `docs/project/DELIVERY-LEDGER.md`. Nothing has been published.

Status words: DONE (exists and checked), DRAFT (written, needs Kyle), KYLE (only Kyle can do it), OPEN (not known).

## A. Submission items the plan names

| Item | Status | Notes |
|---|---|---|
| Public repository | DONE | https://github.com/systoai-design/Nonon is public (Apache-2.0), one clean history, scanned for secrets and personal data. |
| One-minute video | DONE as a file, KYLE to upload | `submission/demo-1min.mp4` (58.2 s, 1920x1080, H.264, silent AAC track, captions burned in). Teaser `demo-teaser.mp4` (15 s) and `demo-1min-poster.png`. Upload and link are Kyle's. Watch it once before posting. |
| Sponsor-tagged post | DRAFT, KYLE | Draft in `SUBMISSION-DRAFT.md`. Tags are `[SPONSOR TAGS: from the organizer briefing]`. Needs Kyle's go to post. |
| Eligibility and forms | OPEN, KYLE | These come from a briefing Kyle has not shared with the build team. Not invented. Needs Kyle: eligibility rules, team or solo entry, any entry form fields, required category, required tools or sponsor products, rules about reused code. |
| Reconfirm deadline with the host | KYLE | The plan says to confirm 2026-10-10 10:00 Philippine time independently. Not done. |
| Disclosures: reused components, models and APIs, AI coding tools | DONE | `NOTICE`, `docs/project/reuse-inventory.md`, `SUBMISSION-DRAFT.md`. Pragma (Apache-2.0), llama.cpp (MIT), Qwen3.5 (Apache-2.0), Nunito (OFL), Claude as the coding tool. Confirm that the organizer is happy with Pragma reuse (Kyle's own sibling project, same license). |
| Tested build, factual feature status | DONE | `docs/project/DELIVERY-LEDGER.md`. 716 tests passed, 33 skipped. |
| Demo assets | DONE | Video, teaser, poster, 8 screenshots (`SCREENSHOTS.md`). |
| Judge instructions | DONE | `JUDGE-QUICKSTART.md`. |

## B. Needs Kyle before submitting

1. (Done) Final rebuild after the brand swap: the live downloads are the final builds.
2. (Done) Brand pack: the official logos, icons, fonts and Non art are in the app, the site and the re-recorded video.
3. Say go for each remaining publishing step: video upload and post (the repository and site are already public). (Standing rule: publishing needs his OK at that moment.)
4. Google OAuth Desktop client (`docs/gmail-setup.md`) if live Gmail should be shown. Without it, say Gmail is tested against a fake Google only.
5. Claude sign-in if a real Claude turn should be claimed. Without it, the Claude connection stays described as installed but not signed in.
6. Look at the video once. Things you may want to change: caption wording, the title line, end card text ("Windows and Mac", "Reuses Pragma"), and whether the orange cursor dot (a recording aid) is acceptable.

## C. Plan acceptance table (section 10): status

| Area | Status | Evidence |
|---|---|---|
| Offline / local | DONE on Windows and Mac | Real install, answer, quit; no outside connections while generating (`runtime-evidence.md`). The video was not recorded offline. |
| Spreadsheet | DONE | 94 known-answer tests, real app on both OSes (`spreadsheet-evidence.md`). |
| Meeting and education | DONE | 104 tests, 9 real runs (`documents-evidence.md`). |
| Changes (stage, check, apply, undo) | DONE | 40 tests, real app on both OSes (`changes-evidence.md`). Recorded again in the video: original untouched until OK, same hash after undo. |
| Scheduling | DONE | 89 tests with a fake clock plus the real app (`scheduler-evidence.md`). |
| Gmail | PARTIAL | Fake Google and real-model emails only. Needs Kyle's OAuth client. |
| Connected agents | PARTIAL | Codex and Antigravity: one real tiny turn each. Claude: mocked turn. Sign-in buttons not run. |
| Roles | DONE with real local AI and one real Codex step | `roles-evidence.md`. |
| Hardware | PARTIAL | 4B on RTX 5070 and M5 Max; CPU only 4B tested; real 8 GB and 16 GB machines not tested. No universal minimum claimed. |
| LAN pairing | PARTIAL | One machine only (loopback and its LAN address). Not two computers, Wi-Fi, Windows Firewall prompt or a Mac. |
| Beginner use | NOT DONE | No observation study. No superiority claim is made anywhere. |

## D. Files in `submission/`

| File | What |
|---|---|
| `demo-1min.mp4`, `demo-1min-poster.png`, `demo-teaser.mp4` | Video, poster, 15 s teaser |
| `SUBMISSION-DRAFT.md` | Title, pitch, 50 and 150 word text, build notes, reuse, limits, post draft |
| `JUDGE-QUICKSTART.md` | Install and the 3-minute path |
| `SCREENSHOTS.md`, `screenshots/` | Eight real screenshots with captions |
| `tools/` | How the video was made (`record-demo.mjs`, `build-demo.mjs`, `markers.json`, `proof.json`) |

How the video was made, what was cut, and what could not be recorded: `docs/project/04-build-log/submission-evidence.md`.
