# Run the workspace-local Ollama server in this terminal; Ctrl+C stops it. No permanent environment changes.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$runtime = Join-Path $repo '.artifacts/ollama/runtime/ollama.exe'
if (-not (Test-Path -LiteralPath $runtime)) { throw 'Install the portable runtime described in LOCAL_MODELS.md first' }
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_MODELS = Join-Path $repo '.artifacts/ollama/models'
$env:OLLAMA_CONTEXT_LENGTH = '8192'
$env:OLLAMA_NUM_PARALLEL = '1'
$env:OLLAMA_MAX_LOADED_MODELS = '1'
$env:OLLAMA_NO_CLOUD = '1'
& $runtime serve
exit $LASTEXITCODE
