# Reuse inventory

Source for all reuse: Pragma (Apache-2.0, derived from OpenMausBot), local checkout
`E:\New Claude\pragma-mac-wt` at commit `7d506dd6` (1.3.59, branch mac-local-ai).
The October 2 preview under `D:\New Claude\Pragma\output\...` was NOT used: it is a packaged
snapshot without buildable source.

Rule: copy with adaptation, one bullet per file, append only. Format:
`- <our file> <- <pragma file> @ 7d506dd6 : kept/adapted what`

Not inherited on purpose: Pragma's multi-companion UI, connected-app catalogue (Composio),
128K default context, 4-slot server, background resource use, permissions model, skills library.

- app/src/main/services/runtime/catalog.ts <- pragma server/local-runtime.ts @ 7d506dd6 : kept pinned llama.cpp b10909 URLs/sizes/sha256 (vulkan, cuda 13.3 + cudart, macos-arm64) and Qwen3.5 4B/9B GGUF pins verbatim; dropped the 27B/35B models and vision mmproj files; added a 16K context constant
- app/src/main/services/runtime/download.ts <- pragma server/local-runtime.ts @ 7d506dd6 : adapted fetchPinned (Range resume, streaming sha256, rename-after-verify) and extractWithTar (system bsdtar); added an approved-host allowlist, cancel via AbortSignal and a skip for an already-complete .part
- app/src/main/services/runtime/index.ts <- pragma server/local-runtime.ts @ 7d506dd6 : adapted the launch flow (random loopback port, key in LLAMA_API_KEY env, q8 cache with f16 fallback, waitUntilReady on /health, VC++ DLL staging, exit-code 0xC0000135 message); replaced Pragma's 128K/4-slot/holders logic with 16K, one slot, idle unload and RSS sampling
- app/src/main/services/runtime/sys.ts <- pragma server/local-runtime.ts @ 7d506dd6 : adapted nvidia-smi CUDA version check, free-space probe and registry qwMemorySize GPU memory read
- app/src/main/services/runtime/llama-client.ts <- pragma server/index.ts @ 7d506dd6 : reused only the chat_template_kwargs enable_thinking=false idea; client, SSE streaming and json_schema handling are new
- app/src/main/services/providers/bin.ts, process.ts <- pragma server/procs.ts, env-path.ts @ 7d506dd6 : re-implemented only the ideas (npm .cmd shim parsed to the real exe or node script with no shell, taskkill /T /F tree kill); no code copied, env handling is an allowlist instead of Pragma's blocklist
- app/src/main/services/providers/agy.ts <- pragma server/drivers/antigravity.ts @ 7d506dd6 : reused the observed stream-json event shapes (init, step_update, result) and the prompt-on-argv fact; permission flags, throwaway home and result validation are new
- app/src/renderer/src/assets/non/pip-rest.png, pip-wave.png, pip-cele.png <- Pragma Videos/pragma-usecases/bring-companions/assets/ (same names; not the pragma-mac-wt repo) : kept byte-for-byte (sha256 in assets/non/PROVENANCE.md); the mascot Pip is shown in NONON as Non; the non-*.png files are cropped and shadow-trimmed derivatives, and build/icon.* composite the original face art
- app/src/renderer/src/assets/non/non-rest.webp, non-wave.webp, non-success.webp <- Pragma Videos/pragma-usecases/bring-companions/assets/pip-rest.png, pip-wave.png, pip-cele.png via brand/NONON-brand-pack-v1/mascots (the earlier pip-*.png stand-ins are removed) : adapted, same pixels cropped to one shared 325x461 frame with the baked edge shadow faded to alpha 0 (brand/derived/non-*-fit.webp); originals untouched in brand/
- site/public/assets/base.css <- pragma site/base.css @ 7d506dd6 : adapted the token structure (ground/paper/ink/line scale, radii, three shadows, expo curve, gutter clamp), the type system (tight display, balanced h2, kicker with a dash), the pill nav with its sliding marker and blur surface, the details-based phone menu, the footer grid and the giant footer word. Re-coloured to black/white/orange, Inter replaced by Nunito, orange button replaced by black, buttons changed to the three-option download cards
- site/public/assets/home.css <- pragma site/home.css @ 7d506dd6 : adapted the hero (dot grid, news pill, facts row, pinned layout applied from first paint), the window frame, ink-in statement, contacts list + profile panel (now radio inputs, so it works without script), pointer-lamp tiles, the dark wipe section (now the internet switch), marquee, FAQ, download panel with the peeking mascot. Not copied: the 3D team stage, the live chat demo, compare tabs, film, bento demos, Pragma copy and mascots
- site/web/home.js (built to public/assets/home.js) <- pragma site/home.js @ 7d506dd6 : adapted the architecture only: gsap.matchMedia with a reduced-motion branch, hero pin timeline (copy leaves, window rises with rotationX), scrubbed word ink-in, once-only reveals with the already-past guard, sliding thumb helper, scroll-pushed marquee, magnetic buttons, pointer lamp, dark-wipe switch, peek-on-hover CTA. Word splitting moved to build time (scripts/build-pages.mjs) so no layout shift; Lenis, three.js, springs (motion.js, clock.js), mascot.js and every Pragma demo removed
- site/public/assets/boot.js <- pragma site/boot.js @ 7d506dd6 : kept the idea (arm the entrance states before first paint, give up after 4 s); added a js class
- site/public/vendor/gsap.min.js, site/public/vendor/ScrollTrigger.min.js <- pragma site/vendor/gsap.min.js, ScrollTrigger.min.js @ 7d506dd6 : copied unmodified (GSAP 3.15.0, GreenSock Standard License, credited on /licenses); self-hosted so the CSP stays script-src 'self'
