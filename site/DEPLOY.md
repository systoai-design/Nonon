# NONON site: deploy and release runbook

Nothing here has been run against Cloudflare. Everything below `Local` was tested locally with
`wrangler dev`; everything under `Deploy` is for the lead to run, after reading the checklist.

Layout: `pages/` + `partials/` are the sources, `scripts/build-pages.mjs` writes `public/*.html` (it also splits
headline words into spans at build time, inlines the animated Non face and the official icons).
Scripts: `web/*.js` are the sources, `scripts/build-js.mjs` minifies them into `public/assets/`.
Styles: `public/assets/base.css` (all pages), `home.css` (home), `inner.css` (everything else). `boot.js` is hand-written.
Motion: GSAP 3.15.0 and ScrollTrigger, self-hosted in `public/vendor/` (unmodified, credited on /licenses).
Brand: black and white with orange (`#F47B32` for marks and icons next to words, `#A84208` for anything read or
pressed), Nunito (variable, Latin subset, `public/fonts/nunito-var-latin.woff2`). Official sources are copied from the
brand pack into `brand-src/` so the site builds without the pack. `node scripts/contrast.mjs` prints the contrast table.
Pictures: `scripts/images.config.mjs` says which real screenshots (`docs/project/screenshots/brand2-*`) and which fitted
Non poses the site shows; `scripts/build-assets.mjs` makes favicons, the Non WebP/AVIF, the screenshot WebPs and `og.png`.
Font: `node scripts/build-font.mjs` (needs fontTools + brotli in the venv at E:/nonon-dev/venv-fonts) makes the woff2 and
the static instances that og.png uses. Full rebuild: `build-font`, `build-assets`, `build-js`, `build-pages`, in that order.
Worker: `src/worker.ts`. Config: `wrangler.jsonc`. Release data lives only in R2 (`latest.json`).

## Before the first deploy (checklist)

1. **Status page** (`pages/status.html`): three levels (Works, Works with limits, Built but not fully
   tested yet), written from `docs/project/04-build-log/`. Re-check each row against the evidence
   before you deploy, then change "Last reviewed". Do not leave a claim the demo cannot back up.
2. **Screenshots**: every picture of the app is a real screenshot from `docs/project/screenshots/`
   (now `brand-12`, `brand-04`, `brand-10`, `brand-13`). To change one, edit its `src` and `alt` in
   `scripts/images.config.mjs`, then run `node scripts/build-assets.mjs` and `node scripts/build-pages.mjs`.
   Never use a mockup or concept image.
3. **Signing flags**: pass `--win-signed` / `--mac-notarized` to `make-manifest.mjs` only if true.
   Without them the download page shows the SmartScreen / Open Anyway notes. The Mac text says
   "signed by its developer and notarized by Apple" only when the manifest has `notarized: true`.
4. **Brand pack**: the official logo, icons, favicons, Nunito and the animated Non face are in place (copied into
   `brand-src/`). The static 3D Non poses are the fitted copies from `brand/derived/non-*-fit.png`. The footer and
   licenses page carry "Non is the Pragma mascot Pip, used with permission of its owner."
4b. **GitHub link**: the three download options end with "GitHub (public repository)" pointing at
   `https://github.com/systoai-design/Nonon`. The repository must be public before the site is published, or that link and
   the "open source" lines on `/`, `/status` and `/licenses` are not true yet.
5. **Contact**: the site lists no contact address (none was provided). Add one to
   `partials/footer.html` and `pages/privacy.html` if you want one, then `node scripts/build-pages.mjs`.
6. After any edit to `pages/` or `partials/`: `node scripts/build-pages.mjs`.

## Local

```powershell
cd "E:\New Claude\Nonon\site"
$env:npm_config_cache = "E:\npm-cache"
pnpm install --store-dir E:\pnpm-store      # first time only
node scripts/build-pages.mjs
npx wrangler dev --port 8799                # not 8787: another local service uses it
```

Seed the LOCAL simulated R2 (never `--remote`) and run the black-box checks:

```powershell
node scripts/make-manifest.mjs --version 0.1.0 --win .\some.exe --mac .\some.dmg --out $env:TEMP\latest.json
npx wrangler r2 object put nonon-downloads/latest.json --file $env:TEMP\latest.json --local
npx wrangler r2 object put nonon-downloads/<file name> --file <path> --local
node scripts/check-downloads.mjs http://127.0.0.1:8799
```

## Deploy (lead only; wrangler is already logged in)

```powershell
cd "E:\New Claude\Nonon\site"
$env:npm_config_cache = "E:\npm-cache"

# 1. Create the bucket once.
npx wrangler r2 bucket create nonon-downloads

# 2. Upload the real installers (file names come from electron-builder:
#    NONON-<version>-win-x64.exe and NONON-<version>-mac-arm64.dmg).
npx wrangler r2 object put nonon-downloads/NONON-0.1.0-win-x64.exe --file "E:\path\NONON-0.1.0-win-x64.exe" --content-type application/vnd.microsoft.portable-executable --remote
npx wrangler r2 object put nonon-downloads/NONON-0.1.0-mac-arm64.dmg --file "E:\path\NONON-0.1.0-mac-arm64.dmg" --content-type application/x-apple-diskimage --remote

# 3. Build the manifest from the real files (size and sha256 are computed), upload it LAST.
node scripts/make-manifest.mjs --version 0.1.0 --win "E:\path\NONON-0.1.0-win-x64.exe" --mac "E:\path\NONON-0.1.0-mac-arm64.dmg" --out latest.json
#   add --win-signed and/or --mac-notarized only if true
npx wrangler r2 object put nonon-downloads/latest.json --file latest.json --content-type application/json --remote

# 4. Deploy the Worker (this creates the workers.dev URL first).
npx wrangler deploy
```

`wrangler r2 object put` handles files up to about 300 MiB. A larger installer must be uploaded
with the S3 API (rclone or aws cli against the bucket's R2 endpoint) instead.

### Custom domains (trynonon.xyz and www)

Uncomment the `routes` block in `wrangler.jsonc`, then `npx wrangler deploy` again. Cloudflare
creates the DNS records itself. Preconditions: the `trynonon.xyz` zone is active in the same
account, and no existing A/AAAA/CNAME record already sits on the apex or `www` (delete it first,
or the deploy fails). The Worker redirects `www.trynonon.xyz` to the apex with a 301.

### Verify after deploy

```powershell
node scripts/check-downloads.mjs https://trynonon.xyz
curl.exe -sI https://trynonon.xyz/ | findstr /i "strict content-security x-content"
curl.exe -s https://trynonon.xyz/api/latest
curl.exe -sI https://www.trynonon.xyz/download      # expect 301 to https://trynonon.xyz/download
```

Also open `/download` in a browser and click each button once.

## Publishing a new version

1. Upload the new installers (step 2 above). Versioned names are cached as immutable, so a given
   file name must never be re-uploaded with different bytes: bump the version instead.
2. Rebuild and upload `latest.json` last (step 3). `/api/latest` is cached for 60 seconds.
3. Rollback: upload the previous `latest.json` again.
4. No HTML change is ever needed for a release.

## Behaviour notes

- Worker routes: `/api/latest`, `/dl/<file>`, everything else is static assets. Every request goes
  through the Worker (`run_worker_first`) so security headers, the www redirect and the 404 page
  are in one place. On the free plan that counts toward the 100,000 requests/day Worker limit.
- Allowed downloads: `.exe .dmg .zip .blockmap .yml .txt` with names `[A-Za-z0-9._-]`; `latest.json`
  is never served from `/dl/` (read it through `/api/latest`, which validates it).
- `/api/latest` returns `{"available":false}` (HTTP 200) when the manifest is missing or invalid,
  and the page then shows "Downloads open soon". Invalid file entries in the manifest are dropped.
- Compression (gzip/brotli) is applied by Cloudflare's edge on custom domains and workers.dev;
  `wrangler dev` does not compress.
- Optional manifest fields: per-file `signed` (Windows) and `notarized` (macOS) booleans.
- CSP is `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; ...`, so
  no inline script or style may be added to any page; put them in `public/assets/`.
- To regenerate raster assets: `node scripts/build-assets.mjs` copies the favicons and logos from `brand-src/`, makes the
  Non art (WebP and AVIF), the screenshot WebPs and `public/og.png` (sharp draws it with the static Nunito instances from
  `node scripts/build-font.mjs`). `scripts/og.html` is no longer used.
- Home page motion is GSAP + ScrollTrigger inside `gsap.matchMedia()` (`web/home.js`). The hero headline rises on a CSS
  animation so the largest text paints without waiting for GSAP. `boot.js` arms the hidden entrance states only when motion
  is allowed and removes them after 4 s if `home.js` never confirms. With reduced motion, or with scripts off, every block
  is visible and static. `assets/site.js` closes the mobile menu, marks the download option for this computer and fills
  version and size from `/api/latest`. The JSON-LD block is data, not script, so it passes the CSP.
- Static asset cache: `/fonts/` and `/vendor/` 30 days, `/img/` and `/brand/` 1 day, `/assets/` 1 hour. When testing CSS
  locally, hard-reload once to bypass the cache.
