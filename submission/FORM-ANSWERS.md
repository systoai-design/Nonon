# Hackathon form answers (copy and paste)

Status: DRAFT for Kyle. Nothing was submitted. Facts come from `SUBMISSION-DRAFT.md`, `docs/project/DELIVERY-LEDGER.md` and `NOTICE`.

## Team Name (top field) and Team Name (final name of your team)
Systo

## Team Members
Kyle Cabahug (already added on the form)

## Team Members (separated by comma)
Kyle Cabahug

## Project Name
NONON

## Project Description
NONON is a Windows and Mac desktop app that finishes everyday file work, like comparing a spreadsheet with a bank export, using an AI that runs on your own computer. Good AI usually costs money each time and needs the internet; NONON's built-in AI is free and its core jobs keep working offline after a one-time download. Code does the arithmetic so totals are exact, the AI explains the differences in plain words, and NONON shows every change before it touches a file, saves a recovery copy first, and can undo it. It also drafts meeting follow-ups and study packets, tidies folders, and runs scheduled routines. Claude, Codex, Antigravity and Gmail are optional connections.

Website: https://trynonon.xyz/

## Public GitHub Repository
https://github.com/systoai-design/appbuildersph-nonon

## Demo Video
https://youtu.be/zwAGvHim_kw

## X / LinkedIn Video URL
https://www.linkedin.com/feed/update/urn:li:share:7514393502617698304/

## Technical Disclosures
AI models: Qwen3.5 4B and 9B (Q4_K_M GGUF, Alibaba Cloud Qwen team, Apache-2.0; GGUF files by Unsloth) run locally through llama.cpp b10909 (MIT). Both are downloaded on first use and not modified. Optional online connections the user can turn on: Claude, Codex, Antigravity (the user's own installed, signed-in tools; not bundled) and a read-only Gmail connection.

Frameworks and libraries: Electron, React, TypeScript, Vite, Tailwind CSS, ExcelJS, Papa Parse, docx, mammoth, unpdf (PDF.js), Croner, JSZip, fflate, zod, lucide-react, selfsigned. Nunito typeface (SIL OFL 1.1). Tested with Vitest (716 passed, 33 skipped because they need a model, a CLI or an account). Hosting: Cloudflare Workers and R2 at trynonon.xyz.

AI development tools: Claude (Anthropic) wrote most of the code and tests under my direction. Codex (OpenAI) and Manus were used for administrative work and planning.

Video and audio tools: the film linked as the demo video is a one-minute product preview made from sample data, not footage of the app. Its motion graphics are built and animated in Blender 5.2 from the brand's own logo, icons and Nunito font. Its narration, sound effects and instrumental music bed are generated with ElevenLabs (eleven_v4 speech with a premade account voice, eleven_text_to_sound_v2 for effects, and the ElevenLabs Music API), then mixed and encoded with ffmpeg. A separate recording of the real app, made with Playwright and edited with ffmpeg, is in the repository at submission/demo-1min.mp4.

Existing code and assets: reused from Pragma by Systo AI (Apache-2.0, itself derived from OpenMausBot, Apache-2.0): the pinned llama.cpp and Qwen3.5 download links and checksums, the download/unpack and llama-server launch approach (adapted), the observed event format for driving Antigravity, and the mascot artwork Pip, shown as Non. Every reused file is listed in docs/project/reuse-inventory.md and NOTICE. Everything else (app shell, spreadsheet comparison, change staging and undo, document procedures, scheduler, Gmail reader, roles, LAN sharing, site and download pipeline, branding) was built during the hackathon.

Known limits: Gmail was not tried with a real Google account (needs an OAuth client file). The Claude connection is installed but was not signed in, so its turn was tested with a mock; the Codex and Antigravity sign-in buttons were not run. 8 GB computers were not tested. The Windows installer is not code-signed, so Windows SmartScreen shows an unknown-publisher warning. Sharing one computer's AI with another was tested between a Windows PC and a MacBook on one home network.
