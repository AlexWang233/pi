# Assignment development environment

This checkout uses repository-local tools under `.artifacts/`. They do not replace the system Node/Python installations or permanently modify PATH. Dependencies are for approach A; T3's vendored adapter subset is installed with this fork, without installing the reference checkout's full toolchain.

## Activate tools

Open PowerShell in `E:\Github\pi` and run:

```powershell
. .\.artifacts\env.ps1
node --version
npm --version
gcloud --version
```

Repeat activation in each new terminal. Dot-sourcing (the leading `. `) updates the current terminal's environment. Git Bash is placed before Windows' WSL `bash.exe` so coding tools can use the existing Git for Windows shell.

The system `C:\Program Files\nodejs\node.exe` is Node 22.12.0 and does not expose `node:sqlite`
without its experimental opt-in. The prepared 22.23.4 supports it without that flag. The demo
requires 22.19+ and now checks version/SQLite availability before start, preflight or preview.
If startup reports `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`, activate the prepared tools in
that same terminal; changing `.env` or installing a SQLite npm dependency does not fix this mismatch.

## Installed components

| Component | Location / version |
| --- | --- |
| Node.js | `.artifacts/tools/node-v22.23.4-win-x64`, v22.23.4 |
| npm | Bundled with the local Node installation, v10.9.9 |
| Google Cloud CLI | `.artifacts/tools/google-cloud-sdk`, archive version 592.0.0, bundled Python |
| TypeScript | Repository dependency, 7.0.2 |
| Vitest | Repository dependency, 4.1.12 |
| Biome | Repository dependency, 2.3.5 |
| Remaining npm dependencies | Installed from the existing `package-lock.json` with `npm ci --ignore-scripts --no-audit --no-fund` |
| Git, Git Bash, SSH | Existing system installations |
| SQLite | Provided by Node; no SQLite server or standalone installation needed |
| Local inference | Portable Ollama 0.40.15 under `.artifacts/ollama/runtime/`; model cache under `.artifacts/ollama/models/`. [Setup, evidence and limits](apps/collab-demo/LOCAL_MODELS.md) |

Node and Google Cloud archives were downloaded from their official sites and checked against published SHA-256 checksums. See [Node releases](https://nodejs.org/dist/latest-v22.x/) and [Google Cloud versioned archives](https://docs.cloud.google.com/sdk/docs/downloads-versioned-archives).

The activation script keeps npm cache and gcloud configuration under ignored `.artifacts` paths. Credentials created there are local to this checkout; do not share or publish that directory. The existing system Python 3.6 is not used by this gcloud installation.

## Build and verification

The setup hydrated ignored model data from the immutable revision in `nix/model-catalog.json`, verified its checksum, and built with:

```powershell
npm run build:offline
```

This avoids refreshing tracked model definitions during environment setup. Existing Durable examples verified tool execution and SQLite reopen/recovery without API keys:

```powershell
Set-Location packages/durable
node --conditions=source --experimental-strip-types test/examples/25-coding-agent.ts
node --conditions=source --experimental-strip-types test/examples/12-recovery.ts
```

Node 22 prints an experimental SQLite warning; the recovery example still completes. No full test suite or paid model request was run. Package lifecycle scripts were disabled, so optional native packages that require install scripts have not been built; the assignment's demonstrated runtime paths work without them.

Docker, Terraform, Bun, a database server, and T3's full toolchain are not required for the chosen prototype. Add further packages only when the new application's implementation needs them.

## Interactive steps before deployment

After activating the environment, authenticate and select your Google Cloud project:

```powershell
gcloud init
```

Complete the browser login yourself. Confirm billing and Compute Engine access for the chosen project before provisioning resources. Installing the CLI does not create a project, enable billing, or deploy anything. Application Default Credentials are not needed merely to deploy with the gcloud CLI.

For a hosted-provider demonstration, choose one supported model provider and configure its API credential privately. Do not paste credentials into chat, source files, or committed configuration. Deterministic provider examples and automated tests need no real provider credentials.

The demo supports persistent local settings in `apps/collab-demo/.env`. Start from its
[`.env.example`](apps/collab-demo/.env.example), fill in `OPENAI_API_KEY`, unique private user
tokens, and config/data paths once. The default `config.local.json` copied from the example
uses native OpenAI `gpt-5.4-mini` plus local Ollama Qwen3 4B; model choices can be edited later.
Both `npm start` and `npm run preflight` from that app directory load `.env` automatically;
existing terminal variables override it. Root `.env` and the simulated preview are not loaded
through this mechanism. No additional dependency or machine-wide environment change is needed.
Start the installed Ollama server separately for this default. Codex is optional through
`config.codex.example.json`; it uses cached CLI login and is not required for OpenAI + Ollama.

For actual local-model responses without provider keys, use the [Ollama instructions](apps/collab-demo/LOCAL_MODELS.md).
The app supports two native lanes on one small local chat model. MiniLM embeddings do not
exercise conversational tool use. Hosted-provider compatibility, authenticated Codex turns and
final Linux/GCP operations remain separate access-dependent checks; they do not block independent local coding.
