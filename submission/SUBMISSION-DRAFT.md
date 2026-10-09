# NONON submission draft

Status: DRAFT. Nothing here has been published, posted or uploaded. Every claim below comes from
`docs/project/DELIVERY-LEDGER.md` and the build-log evidence notes. Rules, forms and sponsor details
come from an organizer briefing that Kyle has not shared with the build team, so none are invented here.
Items in square brackets need Kyle.

## Title

NONON

## One-line pitch

NONON finishes everyday file work, like comparing a spreadsheet with a bank export, using an AI that runs on your own computer, and it shows you every change before it touches your files.

## 50-word description

NONON is a Windows and Mac desktop app that finishes everyday file work with an AI running on your own computer. Compare a spreadsheet with a bank export, see exact totals, check every change before it is made, and undo it. After a one-time download, its core jobs work offline.

## 150-word description

NONON is a desktop app for Windows and Mac that helps ordinary people finish everyday work with their own files. The AI runs on the computer itself, so the core jobs keep working with no internet after a one-time download of the AI (3 to 6 GB).

The lead job compares two spreadsheets, such as an expense report and a bank export. Code does the adding up, so the totals are exact. The AI explains the differences in plain words. Every row is accounted for.

NONON never writes to your original file until you press OK, and it saves a backup copy first, so you can undo. It also drafts meeting follow-ups and study packets, tidies folders, and runs routines on a schedule. Online AI (Claude, Codex, Antigravity) and Gmail are optional, and not all of them are fully tested. The limits are listed openly.

## What it does

- Compares two spreadsheets (Excel or .csv). In the recorded run, 51 rows from two files were all accounted for: 19 matched pairs, 4 only in the expense report, 5 only in the bank export, 1 listed twice, 3 not sure. Totals were PHP 70,852.30 and PHP 68,286.70, a gap of PHP 2,565.60. The numbers come from code. The AI writes the explanation next to them.
- Asks a few plain questions first (for example, how far apart two dates can be and still count as the same payment), each with a suggested answer.
- Shows the answer inside the app: a summary and one sheet each for Matched, Only in A, Only in B, Listed twice, Not sure and About this comparison.
- Stages changes to your original file under "Changes to check". The file is not touched until you press "Make the change". A backup copy is saved first. "Undo this change" puts the file back. In the recorded run the file had the same hash before and after undo.
- Other jobs, tested with the real local AI on files with known answers: meeting follow-up, study packet, lesson outline, document draft, tidy a folder (moves listed exactly, then undone on request).
- Routines: a plain-English request becomes a schedule that survives restart. It never auto-approves a change.
- Optional: a direct, read-only Gmail brief; Claude, Codex and Antigravity as online helpers; sharing the AI of one computer with another on the same network.

## How it is built

- Desktop app: Electron, React and TypeScript, with a main process that owns files, tasks, changes and the scheduler. The window never sees secrets.
- Local AI: llama.cpp (b10909) serving Qwen3.5 4B or 9B (Q4_K_M GGUF), started on a random loopback port with a per-launch key, unloaded when idle, stopped on quit.
- Principle: code does arithmetic and checks; the AI interprets and explains. Model output is validated and each result is reopened and re-checked before it is called done.
- Changes: stage, check, apply with a recovery copy, undo. Stale files are refused. Newer edits are never overwritten.
- Site and downloads: trynonon.xyz on Cloudflare (a Worker for the site, an R2 bucket for the installers).
- Windows installer built with electron-builder. Mac app signed with Kyle's own Developer ID, notarized and stapled.
- Tests: `npx vitest run` gave 716 passed and 33 skipped (the skipped ones need a model, a command line tool or an account).

## What is new in the hackathon, and what is reused

Reused (Pragma by Systo AI, Apache-2.0, itself derived from OpenMausBot; per `docs/project/reuse-inventory.md` and `NOTICE`):

- Pinned llama.cpp b10909 download links, sizes and checksums, and the Qwen3.5 4B and 9B model pins (`runtime/catalog.ts`, kept verbatim, with the larger models and image files dropped).
- The download and unpack approach (resume, streaming checksum) and the llama-server launch flow (`runtime/download.ts`, `runtime/index.ts`, `runtime/sys.ts`), adapted. Pragma's 128K window, four slots and background use were not inherited.
- One idea in `runtime/llama-client.ts` (switching the model's thinking off). The client and streaming are new.
- The event shapes and one fact about how the Antigravity program is driven (`providers/agy.ts`). Permission flags, throwaway home and result checks are new. `providers/bin.ts` and `process.ts` re-implement ideas only, no code copied.
- The mascot artwork Pip, shown in NONON as Non (three images copied byte for byte, cropped versions for the interface and icon).

New in this hackathon (built from 2026-10-09 17:00 to the deadline): the app shell and first-run flow, the spreadsheet comparison and its checks, in-app results viewer, the change staging and undo layer, document procedures, the scheduler, the Gmail reader, the LAN sharing, the roles, the site and download pipeline, the brand pass (black, white and orange; Non with six states), and the plain-language copy pass.

## Tools and models used

- Local AI: llama.cpp (MIT) and Qwen3.5 4B and 9B by Alibaba Cloud's Qwen team (Apache-2.0; GGUF files by Unsloth), downloaded on first use, not modified.
- App: Electron, React, Vite, Tailwind CSS, ExcelJS, Papa Parse, docx, mammoth, unpdf, Croner, JSZip, zod, lucide-react. Typeface: Nunito (SIL OFL 1.1).
- Hosting: Cloudflare (Workers and R2).
- Optional connections the app can drive: Claude, Codex, Antigravity, Gmail (read-only).
- AI coding tools: Claude (Anthropic) wrote most of the code and tests under Kyle's direction.
- Demo video: the real app recorded with Playwright, edited with ffmpeg, captions set in Nunito. No generated footage.

## Honest limitations (from the delivery ledger)

- The small local AI can be loose in how it explains things. The numbers come from code and are shown beside its words.
- 8 GB and 16 GB computers are engineering targets taken from the machines tested. They are not guarantees. A real 8 GB computer was not tested. CPU only (no graphics card) was tested on the dev PC: about 55 tokens per second reading and 13 writing.
- No beginner observation study was run, so there is no claim that NONON beats anything.
- Not tested with real accounts or hardware: Gmail with a real Google account (needs an OAuth client file from Kyle); Claude (installed, not signed in, so its turn is mocked); the Codex and Antigravity sign-in buttons; sharing the AI between two separate computers (tested between two parts of one machine); the tray icon and start at login (hide on close was verified); a .docx output opened in Word (re-read by code only).
- Local AI keeps the thinking on the computer. Gmail, Claude, Codex and Antigravity are online services, and using them sends what the task needs to those companies.
- First run downloads 3 to 6 GB. There is no offline installer. Core jobs work offline after that.
- Not built: phone app, Linux, Intel Macs, scanned PDFs, other characters (only Non), unrestricted screen control, automatic updates, model training.
- The Windows installer is not code-signed, so Windows may show "Windows protected your PC" (More info, then Run anyway). [Confirm against the live download page before posting.]
- The official brand pack (logos, icons, Nunito, Non art) is in the app and the website.

## How a judge can try it in 3 minutes

Full steps with timings are in `JUDGE-QUICKSTART.md`. Short version:

1. Download from https://trynonon.xyz/download (Windows 10 or 11 x64, or a Mac with Apple silicon). Install. Open NONON.
2. Meet Non, choose Bookkeeping, let it get the built-in AI (a one-time 3 to 6 GB download, which is not part of the 3 minutes), then choose "Try sample files" and "Start using NONON".
3. Type: `Compare expense-report-may-2026.csv with bank-export-may-2026.csv` and press Enter.
4. Press Continue to accept the suggested answers. The comparison opens in the app. Click the Matched, Only in A and Only in B sheets.
5. Press "Changes to check", then "Make the change", then "Undo this change" and "Yes, undo it".

## Post draft

> I built NONON for [HACKATHON NAME]: a desktop app that does everyday file work with an AI that runs on your own computer. Give it two spreadsheets and it compares them, adds everything up in code, and shows you every change before it touches your file. Then you can undo it. Windows and Mac. Download: https://trynonon.xyz
> Video: [VIDEO LINK]  Code: [REPO LINK]
> Built with llama.cpp, Qwen3.5, Electron and Claude. Reuses Pragma (Apache-2.0).
> [SPONSOR TAGS: from the organizer briefing]

## Open items for Kyle

See `SUBMISSION-CHECKLIST.md`.

## Why I built this (in my own words, from the builder)

This is an entry for the AppBuildersPH Hackathon. I believe everyone should have an easy way to get the kind of high-quality AI results that developers usually have. I built NONON so anyone can have a free alternative to the rising cost of AI. NONON is free to use, and its built-in AI runs on your own computer, so everyday jobs cost nothing each time and keep working without the internet. Online AI services you choose to connect have their own prices.
