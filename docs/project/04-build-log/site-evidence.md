# Site (trynonon.xyz): evidence

Date: 2026-10-09. Workstream: SITE. Nothing was deployed, no DNS or R2 bucket created, no login run.

## What was built
`site/`: Cloudflare Worker (`src/worker.ts`) + Static Assets (`public/`), hand-written HTML/CSS/JS,
system fonts only, no third-party requests, no cookies, no analytics. Pages: `/`, `/download`,
`/status`, `/privacy`, `/licenses`, 404. Worker routes `/api/latest` (validated R2 `latest.json`)
and `/dl/<file>` (R2 stream, range, ETag, conditional, immutable cache for versioned names), www ->
apex 301, strict CSP and other security headers on every response. Runbook: `site/DEPLOY.md`.

## Verification (how, result)
All against `wrangler dev` (wrangler 4.149.0, local simulated R2). Edge/Chromium on this machine.

| Check | How | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` in `site/` (types from `wrangler types`) | clean |
| Bundle | `npx wrangler deploy --dry-run --outdir dist` | OK, bindings DOWNLOADS (nonon-downloads) + ASSETS |
| Routes | curl on `/ /download /status /privacy /licenses /nope /api/zzz /dl/latest.json /robots.txt /og.png`; POST `/` | 200s; 404 branded HTML for unknown pages, JSON 404 for unknown API; 405 + Allow on POST |
| www redirect | `curl -H 'Host: www.trynonon.xyz'` | 301 to `https://trynonon.xyz/download?x=1` |
| Security headers | curl -i on page, API, asset | CSP, HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP present |
| Download path | `scripts/check-downloads.mjs` with 2 dummy files (3 MB .exe, 2 MB .dmg) + fake manifest | 31/31 PASS: full 200 + sha256 equals manifest, attachment disposition, Accept-Ranges, ETag, immutable cache, range 10-109 -> 206 with correct Content-Range and bytes, suffix range, open-ended range, past-end -> 416, If-None-Match -> 304, HEAD, missing -> 404, `/dl/latest.json` 404, non-installer extension 404, path traversal 404. Also by hand: If-Range stale -> 200 full, If-Match mismatch -> 412 |
| Manifest validation | fake manifest included a bad platform/sha and `../evil.exe` | both entries dropped by `/api/latest` |
| Manifest missing | deleted local `latest.json`, loaded `/download` | `{"available":false}`, page shows "Downloads open soon" with a link to /status; verify block hidden |
| Manifest present | loaded `/download` | both platform cards filled (file, size, version, sha256, copy button), Windows card promoted on a Windows UA, mobile UA shows "open on your computer" note, notarized=false shows the Open Anyway note, signed=false shows SmartScreen note |
| Console/network | built-in browser: resource list on `/download`, console errors | 4 requests, all 200, own origin only; no console errors from real pages (the one 404 entry came from the deliberate `/nonexistent` test) |
| Responsive | built-in browser at 375x812 (mobile emulation): overflow check on `/ /download /status /privacy /licenses /404`; headless Edge full-page shots at 1280 and 768 | no horizontal overflow at 375; layouts checked by eye at 1280, 768, 375 |
| Lighthouse 13 (Edge, local, no compression) | `lighthouse` on `/` mobile and desktop; `/download`, `/status` mobile | all four categories 100 on every run after fixing two low-contrast text colors (first run: home accessibility 96); LCP 0.9 s, CLS 0 on mobile throttling |
| HTML validity | `html-validate` recommended preset on `public/*.html` | only complaint was lowercase doctype; fixed and re-run: 0 problems |
| Non-ASCII, inline style/script, em dashes | grep over sources | none |

After testing: dummy R2 objects removed (deleted `site/.wrangler/` local state), `dist/` removed.

## Not verified / honest limits
- Not deployed: HSTS, edge compression, custom-domain routing, real R2 and the 300 MiB `r2 object put`
  limit are untested. Cache headers were checked, not their edge behaviour.
- Real installer download of 100+ MB through the Worker not exercised (dummy files were 2-3 MB).
- Lighthouse numbers are local (no network latency, no compression).
- Lighthouse was not run on `/privacy` and `/licenses` (same template, overflow-checked only).
- The `/status` page is conservative by design (mostly "In progress"/"Planned"); it must be
  reviewed against the final build before deploy.
- Product screenshots: `docs/project/screenshots/` now holds renderer captures, but they are a dev
  harness with mocked data ("Demo data" badge) and show unfinished states, so the site keeps the
  three concept images clearly labelled "Concept" and says they are not screenshots.
- Claims taken from the plan/NOTICE and not independently checked: Qwen3.5 is Apache-2.0; llama.cpp
  is MIT (the brief grouped it under Apache-2.0; the site says MIT, matching `NOTICE`); "no analytics"
  in the app (grep of `app/src` for telemetry/analytics libraries found none).
- No contact address on the site (none was given).
