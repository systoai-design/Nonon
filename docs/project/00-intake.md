---
type: intake
client: Kyle (internal)
project: nonon
date: 2026-10-09
status: confirmed
mode: new
---

# Intake: NONON

> `client` / `project` map to `System/project-map.json` keys `e:/new claude/nonon` and
> `d:/new claude/nonon`. Do not rename them.

## Core
- **What are we building:** NONON, a downloadable desktop app (Windows and macOS) that helps
  ordinary people finish everyday work with their own files, using a local AI that keeps
  working with no internet, and optional connected AI (Claude, Codex, Antigravity).
- **Why now:** hackathon entry. Submission deadline 2026-10-10 10:00 Asia/Manila (to be
  reconfirmed with the host). Build window: about 18 hours from 2026-10-09 16:00 Manila.
- **Audience:** small-business owners, freelancers, office staff, bookkeepers, teachers,
  students. People who do not want to learn prompting or configure AI.
- **Brand:** NONON. Site: trynonon.xyz (domain bought by Kyle, zone active in his
  Cloudflare account). Quiet light UI, sage green, one pebble companion.
- **Scope IN:** Electron app; local llama.cpp inference (Qwen3.5 GGUF); packs: Business and
  office, Bookkeeping, Education, General; spreadsheet comparison (lead demo), meeting
  follow-up, study packet; staged changes with review/apply/recover; persisted local
  scheduler; direct Gmail brief; optional Claude/Codex/Antigravity adapters with sequential
  roles; Cloudflare-hosted site with Windows and Mac downloads.
- **Scope OUT (initial entry):** mobile, unrestricted GUI control, Composio and broad
  integrations, default parallel agents, local image generation, model training. LAN pairing
  is last priority and reported honestly if not built.
- **Sources of truth:** `docs/reference/NONON-PROJECT-PLAN.md` and
  `docs/reference/NONON-CLAUDE-HANDOVER.md` (copies of the files in
  the owner's planning folder, outside this repository).

## Decisions made at kickoff (2026-10-09)
- Project path is `E:\New Claude\Nonon` (Kyle's standard root and this session's folder), not
  the handover's OneDrive path. Reason: OneDrive syncs `node_modules` and build output.
- Fresh lean Electron app, not a stripped fork of Pragma. Pragma (Apache-2.0, derived from
  OpenMausBot) is a read-only source for pinned llama.cpp runtimes, model pins, and the
  Claude/Codex/Antigravity driver behaviour. Every reused piece is logged in
  `docs/project/reuse-inventory.md` and the NOTICE file.
- Kyle's latest chat instruction (Cloudflare for all deploys, Mac and Windows downloads)
  supersedes the handover's "do not deploy". Publishing still needs his explicit OK at
  the moment it happens.
- Mac builds run over SSH on Kyle's MacBook, signed only with his own Developer ID, never
  any Apple team other than the developer's own personal one.
