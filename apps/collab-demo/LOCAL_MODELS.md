# Local-model setup and verification

Local inference exercises actual streamed responses and tool calls without a paid-provider key.
Use Ollama with **Qwen3 4B Instruct**, not MiniLM: the commonly used
[all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) encodes sentences
for similarity/search; it is not a conversational tool-calling model. Embeddings are not needed
for the current assignment.

The app registers a local provider through Pi AI's existing compatible chat API. Durable's
collaboration contracts, inbox, storage and scheduler are unchanged. The
[Ollama API](https://docs.ollama.com/api/openai-compatibility) accepts an ignored placeholder
key; no real OpenAI credential is sent to this endpoint. No npm dependencies were added.

## Installed configuration

| Item | Local setup |
| --- | --- |
| Runtime | Portable Ollama `0.40.15`, `.artifacts/ollama/runtime/ollama.exe` at repository root |
| Runtime archive SHA-256 | `9ca74a7ab66ec86870b1eecac7df160df08dc4e3a291ab5d2d59bcf9310221c6` |
| Model | `qwen3:4b-instruct-2507-q4_K_M`; about 2.5 GB, Q4_K_M quantization, Apache 2.0 |
| Model cache | `.artifacts/ollama/models/`, ignored by Git |
| Endpoint | `http://127.0.0.1:11434/v1`; configurable with `COLLAB_OLLAMA_URL`, restricted to loopback HTTP |
| Local limits | 8192-token context, 1024 output tokens per response, one loaded model and one concurrent inference |
| Machine | RTX 4070 Laptop GPU, 8 GB VRAM; approximately 32 GB RAM |

The [model page](https://ollama.com/library/qwen3:4b-instruct-2507-q4_K_M) describes its
quantization/license. These limits are deliberately modest, not claims of model quality or
whole-process resource bounds. Two Durable agents have separate histories but share one model
backend; Ollama serializes inference under this setup. Larger contexts/concurrency cost memory.

## Start and stop

From the repository root, in a dedicated PowerShell terminal:

```powershell
& .\apps\collab-demo\scripts\start-ollama.ps1
```

The script uses the portable executable, local cache, loopback binding, 8192-token context and
`OLLAMA_NO_CLOUD=1`. It changes only the current process environment. Ctrl+C stops the server;
it does not install a Windows service, open firewall ports or modify permanent PATH. Do not
start a second server on the same port. The installation remains available after stopping it.

For a fresh machine, use the official
[Windows portable distribution](https://docs.ollama.com/windows), with this pinned archive:

```powershell
New-Item -ItemType Directory -Force .artifacts/ollama | Out-Null
curl.exe --fail --location --output .artifacts/ollama/ollama-windows-amd64.zip https://github.com/ollama/ollama/releases/download/v0.40.15/ollama-windows-amd64.zip
$actual = (Get-FileHash .artifacts/ollama/ollama-windows-amd64.zip -Algorithm SHA256).Hash
if ($actual -ne '9ca74a7ab66ec86870b1eecac7df160df08dc4e3a291ab5d2d59bcf9310221c6') { throw 'Checksum mismatch' }
Expand-Archive .artifacts/ollama/ollama-windows-amd64.zip .artifacts/ollama/runtime
```

After starting the server, download the model from another terminal, at repository root:

```powershell
$env:OLLAMA_HOST = '127.0.0.1:11434'
& .artifacts/ollama/runtime/ollama.exe pull qwen3:4b-instruct-2507-q4_K_M
& .artifacts/ollama/runtime/ollama.exe list
```

Only installation/model downloads require internet. Once cached, the demonstrated inference
uses localhost with cloud features disabled. Model tags can change upstream: record the actual
digest from `ollama list`/`/api/tags`, not just the tag, when repeating evidence.

## Run the browser with real local inference

From repository root, in another PowerShell terminal:

```powershell
. .\.artifacts\env.ps1
Set-Location apps/collab-demo
$env:COLLAB_CONFIG = 'config.ollama.example.json'
$env:COLLAB_DATA = 'data/ollama'
$env:COLLAB_TOKEN_ALICE = node -p "require('node:crypto').randomBytes(24).toString('base64url')"
$env:COLLAB_TOKEN_BOB = node -p "require('node:crypto').randomBytes(24).toString('base64url')"
npm run build
node --conditions=source --experimental-strip-types src/preflight.ts
npm start
```

Open `http://127.0.0.1:4310` in two profiles and use the generated token values privately. Both
members can use both lanes. Start with distinct small files. This is the regular live host,
with SQLite and actual model responses; `npm run preview` still uses deterministic simulated
providers. The normal host exposes its coding tools, including Bash. Use a disposable workspace;
local inference does not add a filesystem sandbox or resolve the deferred Bash shutdown issue.

Use a fresh data directory when changing fixed agents/models. Provider keys are unnecessary for
these local lanes. Preflight validates declared local configuration without contacting Ollama;
it does **not** verify that the model exists, is loaded, supports tools or honors context limits.
Keep the server context consistent with the app's 8192-token declaration.

## Explicit local smoke check

From `apps/collab-demo`, after activating repository tools and starting Ollama:

```powershell
node --conditions=source --experimental-strip-types scripts/ollama-smoke.ts --run
```

This is a manual integration check, excluded from normal Vitest runs. It uses two members and
two native agents, real HTTP admission and disposable SQLite. It submits all four member/agent
pairings, retries one receipt, checks attributed peer observations and **actual file contents**,
then closes/reopens SQLite and verifies completed receipts and stable retries. Only read/write
tools are installed; no Bash, Codex, external harness or hosted-provider request is configured.
After 120 seconds it requests lane stop. This is a cancellation guard, not certified process containment.

The smoke report is written to ignored `.artifacts/ollama-smoke.json`; override its path with
`COLLAB_SMOKE_REPORT`. Its temporary database/workspace are removed on normal exit. It tests
graceful reopen, not crash/power-loss recovery or inference parallelism. A model can finish a
turn without doing the requested work; the file assertions deliberately fail in that case.

Initial trial: `qwen2.5-coder:3b` returned completed responses but failed the first file-content
check because the requested file did not exist. It is not accepted as coding-tool evidence.
The default was changed to the small Qwen3 instruction model rather than weakening assertions.

**November 8 result:** Qwen3 completed all four commands and wrote all four expected files in
26.418 seconds, with stable retries before/after graceful SQLite reopen. `ollama ps` reported
8192 context and 100% GPU placement. The [portable result](scripts/results/2026-11-08-ollama.json)
records runtime/model digest and limits. This is one smoke run, not a quality/capacity benchmark.
A subsequent verification with the model already loaded also passed in 3.254 seconds. The
temporary server was stopped after testing; the successful model/runtime remain installed.
The failed 3B trial model was removed from this session's cache to recover its disk space.

## Regular-host browser verification

**November 8 result:** Chrome 156.0.8078.80 exercised the actual `src/main.ts` host and
`config.ollama.example.json` with two authenticated page identities, temporary SQLite and
actual Ollama inference. Five commands completed across all four user/agent pairings:

- Alice created `alice.txt`; Bob's follow-up queued on the same agent and edited its contents.
- Bob created `bob.txt` on the second agent; Alice used that agent to read it.
- Both users inspected the actual files through the browser panel. While Alice was offline,
  Bob replaced `bob.txt`; reconnect restored the input once and manual refresh showed current bytes.
- Idle shutdown/reopen retained files and receipts. Retrying the original ID/text produced no
  new model request during the checked interval.

The [portable report](scripts/results/2026-11-08-ollama-browser.json) records five commands,
eleven model requests and 30.772 seconds including startup/reopen. Desktop/mobile screenshots
were inspected; local evidence is ignored `.artifacts/ollama-browser-*` at repository root.
Only owned temporary processes, profile and data were removed afterward. The installed runtime
and cached model remain available.

This is one integration run, not a throughput or coding-quality benchmark. A model reply described
an edit mismatch despite correct final file bytes; outcomes were independently asserted. A QA-only
IPC preload delivered the ordinary host's SIGTERM event on Windows while idle. This does not
verify active-shell shutdown, escaped descendants, hosted-provider authentication, Codex or GCP.
The backend still serializes inference. No runtime changes were needed after this walkthrough.

Use the [presentation runbook](../../TAKE_HOME_PRESENTATION.md) to repeat the interaction manually.
The ad-hoc browser automation is separate from the committed tool smoke and normal Vitest suite.

## What still needs external access

| Work | Required access | Local models cover it? |
| --- | --- | --- |
| Runtime/API/UI changes, deterministic failure tests and documentation | None | Yes; keep implementing locally |
| Real streaming and simple native tool-use smoke | Downloaded local chat model | Yes, with explicit outcome assertions |
| OpenAI/Claude/Gemini/DeepSeek authentication, exact wire behavior, quota/errors and hosted-model quality | The selected provider's private credentials | No; only OpenAI live access is currently planned |
| T3-backed real Codex turns, continuation and real CLI tool lifecycle | Installed Codex and working authentication for the current hosted-provider configuration | Native smoke does not exercise Codex; a Codex/local-backend composition is not implemented or verified |
| Final GCP service, mounted disk, restart/reboot, Linux descendant cleanup, backup/restore and evaluator access | Selected GCP project/billing/IAM and Linux deployment | No; service templates alone do not establish these |

The local browser gate now passes. Remaining independent specification review and presentation
rehearsal require no key or GCP project. The next hosted native/Codex check requires private
OpenAI credentials and separate Codex authentication; this is the current credential gate.
GCP project/billing/IAM is required only for the later deployment checks.
Configure credentials privately in the launching environment, never in chat or committed files.
