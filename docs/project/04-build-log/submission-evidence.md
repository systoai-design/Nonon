# Submission evidence: one-minute demo video (DEMO + SUBMISSION KIT workstream)

Date: 2026-10-10, about 00:35 to 01:00 Asia/Manila. Nothing was published, pushed, uploaded or posted. Files are in `submission/`.

## What the video shows

The real NONON window, run from the repository source (HEAD `a28ecf7`, clean tree), built with `pnpm build` in `app/` (ELECTRON_CACHE=E:\electron-cache) just before recording. Real services and the real local AI (Qwen3.5 4B on CUDA, RTX 5070), Windows 11. Not the installed app and not the packaged installer: Kyle's `E:\NONON` was not running, touched or killed. The only process started was the dev Electron (main PID 27292 on the final run, closed by the script and `taskkill /T` of that PID only).

## How it was recorded

- Script: `submission/tools/record-demo.mjs` (adapted from `E:\nonon-dev\e2e\demo-record.mjs`). Playwright-electron `recordVideo`, 1600x900, user data `E:\nonon-dev\demo\ud`, `NONON_DATA_DIR=E:\nonon-dev\demo\data`, `NONON_MODEL_DIR=E:\nonon-dev\install-test`.
- Off camera: the first-run screens and the native folder dialog. The script makes the project and puts the sample files in with the same app calls the dialog flow ends in (`workspace:create`, `workspace:add-samples`). The video caption "Pick a folder of your files" therefore sits on the project home screen, not on a recording of the picker.
- On camera, all real: click the project, type `Compare expense-report-may-2026.csv with bank-export-may-2026.csv`, Enter, the questions card, Continue, the answer and sheets, Changes to check, Make the change, Undo this change, Yes, undo it.
- Recording aid: a small orange dot follows the mouse (injected into the page, since Playwright video has no cursor). It changes no app content.
- Run result (markers in `submission/tools/markers.json`, hashes in `proof.json`): Continue clicked to task done in 3 s (state `review`); original file hash `6bd9892a972ec5b4` before, while the change waited and after opening the panel; `a327cdc2ce2163db` after "Make the change"; `6bd9892a972ec5b4` again after undo (byte-identical). `proof.json` field `taskSeconds` (41.5) is wrong: it was read at the end of the script, not at task completion. The 3 s in the `task_done` marker is the right figure.
- Answer numbers in the app, from the task summary: 25 rows in A, 26 in B; 19 matched; 4 only in A (PHP 6,375.00); 5 only in B (PHP 4,775.00); 1 listed twice; 3 not sure; totals A 70,852.30, B 68,286.70, gap 2,565.60. Six checks: five pass, one warning (1 match on amount and date only).

A first attempt typed "Compare my expense report with the bank export" (the storyboard wording). The current app answered that it needs the files added and asked to send the request again, because files must be named in the request or attached. That is the app working as built, not a failure, but it means the storyboard line could not be filmed as written. The video uses the two file names. This is also in the judge quickstart.

## How it was edited

Script: `submission/tools/build-demo.mjs`. ffmpeg 8.0.1 (Gyan full build).

- Raw: `E:\nonon-dev\demo\raw\a55ba57dd43ec29785bc793e7221f514.webm`, VP8, 1600x900, 59.44 s. Kept outside the repo.
- Nothing was sped up or slowed down, so there is no "sped up" label. The AI step took 3 s in real time, so no fast-forward was needed.
- Cuts (idle time only, hard cuts, no effects). Source seconds used: 3.6-7.5, 8.5-14.2, 16.0-20.5, 22.4-23.9, 24.0-29.5, 30.8-38.8, 41.8-47.2, 47.2-50.2, 50.3-55.0, 54.3-59.3. Dropped: the first-run flash at the start (0-3.6), the wait before typing (7.7-8.5), about 2 s of reading the questions (20.5-22.4), 1.3 s of the answer settling (29.5-30.8), the tab clicks on Only in B and the move back to Summary (38.8-41.8), and the first second of the final hold is shared between the Undo and offline segments (54.3-55.0 appears twice). The Continue click to first answer frame (about 1 s on screen) is inside the 22.4-24.0 segments.
- Overlays: captions in Nunito (`site/public/fonts/nunito-latin-wght-normal.woff2`), orange `#F47B32` accents, in a 120 px black band under the scaled app (1600x900 scaled to 1707x960 and centred on 1920x1080). Title and end cards are HTML rendered to PNG with Edge via Playwright, faded in and out by ffmpeg. Non is the app's own `non-rest.png`. One zoomed inset: a crop of the "AI: This computer" label from the same recorded frames, magnified 4x, shown at 47 to 52 s (output time).
- Caption claims and their evidence: "Nothing sped up" (true, above); "added up by code, not guessed by the AI" (app text and `spreadsheet-evidence.md`); "Works offline after setup. The AI runs on your computer." (header label "AI: This computer" plus the no-outside-connections check in `runtime-evidence.md`; this recording itself was made with the internet on).
- Audio: a silent AAC track, no narration or music.

## ffprobe

`demo-1min.mp4`: format mov/mp4, duration 58.200 s, size 5,129,488 bytes (~5.1 MB), bit rate 705 kb/s. Stream 0: H.264 High, 1920x1080, yuv420p, 30 fps. Stream 1: AAC LC, 44.1 kHz stereo (silent).
`demo-teaser.mp4`: H.264, 1920x1080, AAC, 15.000 s, 1,433,152 bytes. Same footage, cut from the main video's parts (typing, answer, changes, undo, end card).
`demo-1min-poster.png`: frame at 23.5 s of the main video (the answer with its caption).

Timeline of the main video (output seconds): 0-5 title card; 5-8.9 project home; 8.9-14.6 ask in plain words; 14.6-20.6 questions; 20.6-26.1 the answer in the app; 26.1-34.1 sheets; 34.1-39.5 changes to check; 39.5-42.5 make the change; 42.5-47.2 undo; 47.2-52.2 offline label with the zoomed "AI: This computer"; 52.2-58.2 end card (trynonon.xyz, Windows and Mac).

## What could not be recorded, or is not proven by the video

- The native folder picker (system dialog). Set up off camera instead.
- A Task Manager or network view: not shown, by instruction. The video relies on the in-app label and the earlier runtime evidence.
- An offline run. This recording was made online. The "works offline after setup" caption is supported by `runtime-evidence.md` (no outside connections while generating) and by the product design, not by this clip.
- The first-run download and onboarding screens, the Mac, and the installed or packaged app.
- Playwright's video timing is not exact: the 59.4 s file is shorter than the 66 s of script wall clock, so on-screen pauses in the raw clip are roughly 10% shorter than real. Event order and what the app showed are not affected, and the 3 s AI step comes from the script's wall clock, not from the video.
- Timestamps of the recording clock vs the file differ, so the cut points above were chosen by looking at frames, not from the markers.

## Reproduce

`node submission/tools/record-demo.mjs` (needs playwright-core and the dev model folder), then `node submission/tools/build-demo.mjs`. Both scripts use absolute paths on this PC (E:\nonon-dev, the winget ffmpeg, Edge).

## Other files from this workstream

`submission/SUBMISSION-DRAFT.md`, `JUDGE-QUICKSTART.md`, `SUBMISSION-CHECKLIST.md`, `SCREENSHOTS.md`, `screenshots/` (8 copies from `docs/project/screenshots/`). No app code, contracts or dependencies were changed.
