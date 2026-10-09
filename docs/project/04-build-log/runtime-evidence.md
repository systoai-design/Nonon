# Local runtime evidence (RUNTIME workstream)

Date: 2026-10-09. Every number below was measured by running the real code on this PC:
Windows 11, Intel i7-13700K (24 threads), 64 GB RAM, RTX 5070 12 GB, driver reporting CUDA 13.3.
Outside Electron: `node scripts/run-smoke.mjs <assess|install|evidence>` bundles `scripts/runtime-smoke.ts`
with esbuild and calls the real `HardwareService` and `RuntimeService`. Raw logs are in
`E:\nonon-dev\` (`install-test.log`, `install-9b.log`, `evidence-cuda.log`, `evidence-vulkan.log`,
`evidence-cuda-9b.log`). Unit tests in `app/src/main/services/runtime/*.test.ts` and
`hardware.test.ts` use fixed machines or a fake HTTP server and are labelled MOCKED in the files.

Settings used by the service: window 16,384 tokens (`CONTEXT_TOKENS`), q8 KV cache with flash attention,
one slot, `--jinja`, `--reasoning off`, bound to `127.0.0.1` on a random free port with a per-launch
API key passed in the environment, layers placed by llama.cpp `--fit on`, one model loaded at a time.
Engine: llama.cpp b10909. Models: unsloth Qwen3.5 Q4_K_M GGUF (Apache-2.0). llama.cpp is MIT.

## Install (real download, pinned URLs only)

| Step | Result |
| --- | --- |
| Fresh folder, `install qwen3.5-4b` with cancel at 30% of the model, then install again | Cancel kept the `.part` file, status said "Download paused"; second call resumed with a Range request and finished. Total 64.4 s including the 150 MB CUDA engine, 391 MB CUDA libraries and 2.74 GB model, on this connection. |
| Integrity | Engine zips and model passed their pinned SHA-256 (checked while installing). A wrong checksum deletes the file (unit test, MOCKED network). |
| Engine chosen | `cuda` (driver reports CUDA 13.3, the version the build needs). Vulkan is the fallback and is what `NONON_RUNTIME=vulkan` forces. |
| `install qwen3.5-9b` | 56.5 s for 5.68 GB, ends in phase `ready` (not running). |
| Unpack | system `tar` (bsdtar) read the zip, no new dependency. |

## 4B on CUDA (the path a fresh install takes on this PC)

| Measure | Result |
| --- | --- |
| Cold start (spawn to `/health` ok) | 3.6 s first run, 2.0 s second. The model file was already in the OS disk cache, so this is not a first-boot-after-restart number. |
| 600-token prompt (`promptTokens=600`) first request after start | time to first token 0.18 s (about 3,260 prompt tokens/s), 143 tokens in 1.21 s |
| Generation speed (from llama-server timings) | 138.8 tok/s, then 137.6 tok/s |
| Peak RSS of llama-server (working set, polled every 2 s) | 3,521 MiB |
| GPU memory (whole card, `nvidia-smi`; the shared dev server and desktop are included) | before start 4,918 MiB, running 8,140 MiB, after idle unload 4,917 MiB |
| JSON schema extraction (invoice, nested `lineItems`) | valid JSON, all fields correct: vendor "Bayside Packaging Ltd.", INV-2291, total 247.50, 2 line items |
| Idle unload (setting 10 s) | phase went to `sleeping`; process id gone from the process list; GPU memory returned to baseline |
| Wake on next request | next `chat()` restarted the server transparently: 2.16 s including the one-word reply |
| Abort | `AbortSignal` mid-stream rejected with `AbortError` |

## 4B on Vulkan (same PC, `NONON_RUNTIME=vulkan`)

| Measure | Result |
| --- | --- |
| Cold start | 5.1 s (first run), 2.8 s (second) |
| First request ever on this engine | time to first token 27.2 s (about 22 prompt tokens/s). One-time Vulkan shader compilation; the same request on the next run took 0.20 s. A user on Vulkan will see a slow first answer once. |
| Generation speed, steady | 130.9 tok/s (CUDA 138.8): for a 4B at 16K the engines are close. CUDA costs about 540 MB more to download. |
| Peak RSS | 3,266 MiB |

## 9B on CUDA (the "recommended" model for 16 GB+ machines)

Cold start 3.1 s, 600-token prompt first token 0.26 s (about 2,340 prompt tokens/s), generation 89 to 91 tok/s,
peak RSS 5,807 MiB, GPU memory 4,982 MiB to 10,465 MiB while running. Idle unload released the process;
the GPU reading 1.5 s afterwards was 6,144 MiB (about 1.1 GB above baseline, probably the desktop or driver
lag, not re-checked). Wake on next request 3.2 s. JSON schema extraction valid.

## Offline proof (while generating)

While llama-server streamed a reply, `Get-NetTCPConnection -OwningProcess <pid>` showed:

```
LocalAddress LocalPort RemoteAddress RemotePort State
127.0.0.1        65027 0.0.0.0                0 Listen
127.0.0.1        65027 127.0.0.1          62992 Established   (our own client)
127.0.0.1        65027 127.0.0.1          62684 Established   (our own client)
```

Only a listener on 127.0.0.1 and loopback connections from NONON itself. No remote addresses, and
`Get-NetUDPEndpoint` for the same process returned none. The same shape appeared on Vulkan and on 9B.
This is a point-in-time socket listing, not a packet capture. The only network code in `runtime/` is
`fetchPinned` (used by `install`) plus loopback calls to the server; `assertPinnedUrl` refuses any address
outside `github.com/ggml-org/llama.cpp/releases/download/` and `huggingface.co/unsloth/`, and nothing runs at startup.

## Hardware assessment on this PC

`assess()` returned: i7-13700K, 24 threads, 64 GB RAM, RTX 5070 with 12,227 MiB read from `nvidia-smi`,
accel `cuda`, drive free about 222 GB, recommendation 9B "recommended" with 4B as an alternative,
caveat text "engineering targets ... not guaranteed minimums".

## Not tested (do not claim)

- macOS arm64 / Metal: pins and code paths exist (tar.gz, `llama-b10909/llama-server`, unified memory report), nothing ran on a Mac. Needs the Mac.
- Intel Mac, Linux, Windows on ARM: `supported=false` with a reason (unit test only).
- 8 GB and 6 GB machines, and the 4B "limited" claim on them: no such machine here. The 6/12 GB rule is an engineering target.
- CPU-only machines, AMD and Intel graphics on Vulkan.
- Partial GPU offload when the model does not fit (`--fit` does this in llama.cpp; never triggered here).
- Missing Visual C++ runtime on a clean Windows: the service copies DLLs from `resources/vcruntime/` if the packager ships them and shows a plain message on exit code 0xC0000135; neither was exercised.
- The q8 to f16 cache fallback (GPU without flash attention) and the CUDA to Vulkan fallback: coded, never triggered.
- A true cold start after a reboot (file cache was warm), and orphan cleanup after an app crash.

## Findings worth knowing

- The shared dev server at `http://127.0.0.1:18088` is started without an API key and llama-server allows all CORS origins in that mode. Fine for dev; the product service always sets a key.
- Qwen3.5's chat template returns HTTP 500 when a system message is not first. `systemFirst()` in the client folds extra system messages into the first one, so callers cannot trigger it.
- Thinking is disabled per request (`chat_template_kwargs.enable_thinking=false`) and server-wide (`--reasoning off`).

## Added by the lead 2026-10-09 17:40: CPU-only run, Qwen3.5 4B (constrained-hardware evidence)

Machine: the same PC (RTX 5070 12 GB, 64 GB RAM). The GPU was disabled for the run, so this shows what a computer
with no usable graphics card might experience on THIS CPU. It is not a measurement of an 8 GB or older machine.

- Build: llama.cpp b10909 Vulkan binary started with `--device none -ngl 0 -t 4 -c 16384 --parallel 1 --cache-type-k q8_0
  --cache-type-v q8_0 -fa on` (4 CPU threads, 16K window, one slot).
- Prompt of 2,041 tokens (the bank-export sample twice plus an instruction), 120 tokens generated, thinking off:
  - reading the prompt: 55 tokens/s (about 37 s)
  - writing: 13 tokens/s
  - wall time 46 s
  - process working set 4.45 GiB (peak equal), the 2.7 GB model file plus the 16K window
- For comparison the same prompt on the RTX 5070 (CUDA) reads at about 1,300 tokens/s and writes at about 139 tokens/s.
- What this does and does not show: the model loads and answers in under 5 GiB with no graphics card, so a 16 GB computer
  has headroom and an 8 GB computer is plausible; on an 8 GB computer with a slower CPU, expect longer waits than shown.
  NOT tested: a real 8 GB machine, paging behaviour, thermal throttling, other apps running alongside.
- The spreadsheet comparison sends about 1,000 tokens to the model, so on CPU only the explanation would take roughly
  20 to 30 s. The comparison itself (code) takes well under a second.

## Added by the lead 2026-10-10 02:50: speed test on the MacBook (Metal)

Machine: MacBook Pro (Mac17,6), Apple M5 Max, 18 CPU cores (6 super, 12 performance), 32-core GPU, 36 GB unified memory, macOS 26.6.2, Metal 4.

- Same engine build as the app ships (llama.cpp b10909, macOS arm64, Metal), `qwen3.5-4b` Q4_K_M, `-c 16384 --parallel 1 --jinja`, 8-bit cache with flash attention, thinking off, run with the same flags as the PC test.
- Prompt: the same 2,041 tokens used for the CPU-only test on the PC (the bank-export sample twice plus an instruction), 120 tokens written.
- Server ready (health check) after about 0.5 s with the model file already in the macOS file cache. A first start after a reboot reads the 2.7 GB file from disk and will be slower: not measured.
- First request: 2.1 s wall, reading 3,038 tokens/s, writing 86.7 tokens/s.
- Second request, same prompt (2,037 tokens served from the prompt cache): 1.2 s wall, writing 100.9 tokens/s.
- Resident memory of llama-server after the two requests: 3.15 GiB (measured with `ps`, not a continuous peak sampler). The packaged app's own sampler recorded 3.4 GiB (2026-10-09 run) and 3.71 GiB (2026-10-10 run).
- Not measured: other Macs, battery power, thermal throttling over a long session, the 9B model.
