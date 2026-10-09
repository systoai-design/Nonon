# Model discovery: evidence

Problem: a fresh install only looked for NONON's own two pinned files, by exact name, in NONON's own folder. An AI Kyle already had (LM Studio, Ollama, Hugging Face cache, a .gguf in Downloads, or NONON's own pinned file stored elsewhere) was invisible, so the 3 to 6 GB download was always offered.

Run on Windows 11, RTX 5070 12 GB, 64 GB memory. Build from `app/` with `pnpm build`. Real Electron driven by `E:\nonon-dev\e2e\discover.mjs` (Playwright-electron). Logs: `E:\nonon-dev\e2e\discover-4b-final.log`, `discover-14b-final.log`, `discover-14b-run3..7.log`.

## What discovery looks at

Code: `app/src/main/services/runtime/discover.ts` (no Electron imports). Read-only: it lists folders, reads the first part of each candidate (the GGUF header, in growing chunks, never the weights), and hashes a file only when its size equals a pinned model's size.

| Place | Where it looks | Depth |
| --- | --- | --- |
| NONON's own folder | `NONON_MODEL_DIR` / `<userData>/models` | 1 |
| LM Studio | `~/.lmstudio/models`, `~/.cache/lm-studio/models`, and the `downloadsFolder` written in `~/.lmstudio/settings.json` | 4 |
| Ollama | `OLLAMA_MODELS` or `~/.ollama/models`: `manifests/**` JSON, the layer `application/vnd.ollama.image.model`, blob `blobs/sha256-<64 hex>`, labelled model:tag | manifests 5 |
| Hugging Face | `HF_HUB_CACHE`, `HF_HOME/hub`, `~/.cache/huggingface/hub` (`blobs/` and `refs/` skipped) | 5 |
| Jan, GPT4All, llama.cpp cache | `~/jan/models`, `%APPDATA%\Jan\data\...`, `%LOCALAPPDATA%\nomic.ai\GPT4All`, `%LOCALAPPDATA%\llama.cpp` (Mac and Linux equivalents) | 1 to 3 |
| Your own folders | `~/models`, `~/Downloads`, `~/Documents` (and `OneDrive\Documents`) | 2 for Downloads and Documents |
| Tests only | `NONON_EXTRA_MODEL_DIRS` (folders separated by `;` on Windows, `:` elsewhere), shown as "a folder added for testing" | 3 |

Limits: 4 s budget for listing and header reading (hashing has its own 120 s per file), 400 folders and 300 files per place, 3000 entries per folder, folders reached twice (links, overlapping places) read once by real path, links to folders are followed once, never a whole drive.

Skipped: not GGUF, under 300 MB, embedding architectures (`bert`, `nomic-bert`, ...) or names with embed/rerank, picture projectors (`mmproj`, architecture `clip`), non-first split parts (the first part is listed with the size of all parts), `general.type` other than model, no chat template, context under 8192, and anything where file size plus the estimated 16K window (from the header's layer and head counts, 8-bit cache) is over 70% of this computer's memory. Architectures offered: qwen2, qwen2moe, qwen3*, qwen35*, llama, gemma*, phi3, mistral*, granite*, smollm*, olmo*, deepseek2. Others are `unknown` and only returned when asked for.

Classification: `exact` = size equals a pinned model's bytes AND SHA-256 equals the pin (hashed once per session per file, streaming, cancellable). `compatible` = chat-capable, allowed architecture, not tested with NONON's jobs. Ordered exact first, then by how close the size is to what this much memory handles comfortably (16 GB prefers 4B to 14B; 32 GB prefers 14B). Cap 20.

## Real run on this PC

Scan with the real catalog, `NONON_EXTRA_MODEL_DIRS=E:\nonon-dev\install-test`, empty NONON models folder:

| Kind | Label | Size | Where |
| --- | --- | --- | --- |
| exact | Qwen3.5 9B | 5.3 GB | install-test (hashed, matches the pin) |
| exact | Qwen3.5 4B | 2.6 GB | install-test (hashed, matches the pin) |
| compatible | Qwen2.5 14B Instruct | 8.4 GB | LM Studio (D:\LM Models) |
| compatible | Qwen2.5 Coder 14B Instruct | 8.4 GB | LM Studio |
| compatible | qwen3.5:9b | 6.1 GB | Ollama (E:\Ollama\models, from OLLAMA_MODELS) |
| compatible | Gemma 4 E4B | 5 GB | LM Studio |
| compatible | Qwen3.8 27B | 15.3 GB | LM Studio |
| compatible | Qwen2.5 Coder 7B Instruct | 4.4 GB | Ollama |
| compatible | Qwen2.5 7B Instruct | 4.4 GB | Ollama |
| compatible | Gemma 2.0 2b It Transformers | 1.5 GB | Ollama |

Skipped, with reasons: three `mmproj` picture projectors (Gemma 4, Muse-Glimmer, Qwen3.8), `Muse-Glimmer-30B` (architecture `muse-glimmer`, unknown to the bundled engine), `nomic-embed-text:latest` (Ollama, embedding).

Timings (this PC, several runs):
- Listing and reading headers: 90 to 290 ms for the whole scan.
- Hashing the two exact files (2.7 GB and 5.7 GB, two at once): about 4.0 to 4.4 s. A second discovery in the same session: 0 ms (cached).
- The found-models card appeared 3.8 to 5.6 s after step 3 opened (dominated by the hashing). The "Looking for AI that is already on this computer..." line is visible meanwhile.

Finding on this PC: `C:\Users\Kyle\.lmstudio` is a junction to `F:\ProfileCaches\.lmstudio`, whose `models` entry points at a path that does not exist. The real LM Studio library is `D:\LM Models`, set in LM Studio's own `settings.json` (`downloadsFolder`). Reading that setting is what finds it; the default `~/.lmstudio/models` finds nothing here.

## Real Electron walk-through

Settings: `--user-data-dir` and data folders fresh per stage, models folder empty except the small engine copied from `install-test\runtime` ("engine already present"). No model file was copied, moved, renamed or deleted anywhere.

Exact 4B (`discover-4b-final.log`):
- Step 3 listed Qwen3.5 9B and 4B ("Tested with NONON") and Qwen2.5 14B Instruct ("Works, but not tested with NONON"), plus the button "Or download the AI we recommend (about 5.3 GB)".
- "Use this one" on 4B: runtime phases seen after the click were `["ready"]` only (no engine download), status `modelId qwen3.5-4b`, `customModel.kind exact`.
- Real comparison (expense report vs bank export, 25 and 26 rows): finished in 10 s, explanation written by the model and accepted, results sheet saved. App log: `local AI started: qwen3.5-4b from E:\nonon-dev\install-test\Qwen3.5-4B-Q4_K_M.gguf on cuda, cache q8_0, 3447 ms`. Peak memory 3.6 GB.
- File before and after: same size, same modified time, same SHA-256 `00fe7986...ef11a4`. Byte-identical.
- Settings > Advanced showed "NONON is using Qwen3.5 4B", the list with "In use", and "Stop using it". After pressing it: phase not-installed, `customModel` gone, file untouched.

Compatible 14B (`discover-14b-final.log` and runs 3 to 7): Qwen2.5 14B Instruct Q4_K_M (8.4 GB) from LM Studio's folder.
- Started with `--model D:\LM Models\bartowski\...\Qwen2.5-14B-Instruct-Q4_K_M.gguf`, alias `custom`, same bounded flags (16K window, one slot, 8-bit cache, `--jinja`, thinking off), status `modelId custom`, label "Qwen2.5 14B Instruct". Start time 5.3 to 10.3 s. Peak memory 9.2 GB.
- Speed from llama-server's own timing lines: about 51 to 55 tokens per second writing, 1800 to 2350 tokens per second reading the prompt. The 4B on the same PC: 110 to 120 and 1900 to 3300.
- JSON-schema output works: every reply parsed as JSON in the required shape.
- Comparison explanation, 8 real runs: validated and shown as AI-written in 3 (runs 3, 5, 6); the honest "Standard summary (the AI could not write one this time)" fallback in 5. Four of those five: the model used a number that was not in the facts it was given ("750"), which NONON's check rejects after one retry. One: `fetch failed` from the local server (run 4). The reason for the very first run was not recorded. The 4B passed the same check in all 3 runs.
- Task time: 4B 10 to 12 s. 14B 13 to 32 s typical, 49 and 85 s in two runs where another program was holding about 4.5 GB of graphics memory (another llama-server not started by this work), which forces part of the 14B onto the processor.
- The numbers table, the saved workbook and every check other than "AI explanation" were identical to the 4B runs, since code does the arithmetic.
- File before and after: same size, modified time and SHA-256 `e47ad95d...a87c008`. Byte-identical in every run.

All llama-server processes this work started were stopped by the app on quit. Kyle's own installed app and its data folder were not touched.

## Tests

`pnpm vitest run` from `app/`: 48 files passed, 766 tests passed, 33 skipped (the skipped ones were skipped before this work). New: `discover.test.ts` (34 tests, real temporary folders and real GGUF header bytes written by a helper in the test; labelled real files, no network) and `existing.test.ts` (12 tests; uses the real runtime service with an empty file standing in for the engine, so nothing is launched, and a stubbed network).

Covered: LM Studio layout and the settings.json downloads folder; Ollama manifest plus blob, `OLLAMA_MODELS`, a digest that tries to leave `blobs/` (ignored), embedding model skipped; Hugging Face snapshot symlinks; Downloads and Documents depth; Jan, `~/models`, NONON's folder, `NONON_EXTRA_MODEL_DIRS`; exact by size and SHA-256 (fake catalog passed in, the real models are not downloaded), same size but different content is compatible, hashing only size-matching files and only once per session, cancel while hashing; embedding, projector, no template, adapter, short context skipped; too big for memory (file alone, and file plus window) skipped without opening it; truncated, garbage, zero-filled, bad version, absurd count skipped; split parts; unknown architecture only when asked; 15 architecture families; ordering and the 4B-versus-14B preference; a counting fs wrapper proving a 50 MB file's header reads stay near the header size and non-candidates read at most 64 KB; symlink and junction loops; a link to a folder followed once; time budget with an endless slow tree; cap of 20; files never modified; the same file reached twice listed once.
Runtime: use-existing only accepts ids from the last search (made-up and path-derived ids refused; the channel schema accepts only a 40-character id and `settings:update` drops `customModel`); exact acts like the pinned model at that path; NONON's own file in its own folder makes no custom entry; forget leaves the file in place; file disappearing returns to not-installed with a plain message, or falls back to NONON's own download if present; a file from the dialog goes through the same checks with plain messages; downloading NONON's own AI afterwards replaces the chosen file; engine present means no fetch; engine missing (stubbed network, so mocked) shows a download phase and cancel keeps the choice.

## Not verified end to end

- The native "Choose a file..." dialog was not driven (a real OS dialog). The service call behind it (`useFile`) is unit tested with real files; the dialog wiring in `main/ipc.ts` is only type checked.
- Engine download when the engine is missing: tested with a stubbed network only. The real GitHub download was not run (no network in this work).
- Mac discovery paths and the Mac engine step were not run.
- The 14B's tendency to put a made-up number into its explanation is NONON's existing check doing its job; it is reported here, not changed.
