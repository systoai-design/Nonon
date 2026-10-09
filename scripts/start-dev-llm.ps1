# Starts the shared dev llama-server (Qwen3.5 4B) on 127.0.0.1:18088, detached, and records the URL.
# Same bounded settings the product uses: 16K window, q8 KV cache, one slot, loopback only.
param(
  [string]$ModelDir = 'E:\nonon-dev\models',
  [string]$Runtime = 'b10909',
  [int]$Port = 18088
)
$exe = Join-Path $ModelDir "runtime\$Runtime\llama-server.exe"
$model = Join-Path $ModelDir 'Qwen3.5-4B-Q4_K_M.gguf'
if (-not (Test-Path $exe) -or -not (Test-Path $model)) { throw "Install first (scripts/run-smoke.mjs install). Missing: $exe or $model" }
try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/health" -TimeoutSec 2 | Out-Null; Write-Host "Already running on $Port"; exit 0 } catch {}
$args2 = @('--model', $model, '--ctx-size', '16384', '--host', '127.0.0.1', '--port', "$Port", '--alias', 'qwen3.5-4b',
  '--parallel', '1', '--jinja', '--reasoning', 'off', '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0',
  '--flash-attn', 'on', '--fit', 'on', '--no-webui')
$p = Start-Process -FilePath $exe -ArgumentList $args2 -RedirectStandardOutput 'E:\nonon-dev\llama-dev.out.log' `
  -RedirectStandardError 'E:\nonon-dev\llama-dev.log' -WindowStyle Hidden -PassThru
for ($i = 0; $i -lt 120; $i++) {
  try { if ((Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/health" -TimeoutSec 2).StatusCode -eq 200) { break } } catch {}
  Start-Sleep -Milliseconds 500
}
[IO.File]::WriteAllText('E:\nonon-dev\llm-url.txt', "http://127.0.0.1:$Port")
Write-Host "llama-server pid $($p.Id) ready at http://127.0.0.1:$Port"
