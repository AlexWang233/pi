# Collaborative Durable demo

A thin HTTP/browser host for this fork's collaborative Durable API. Durable owns membership,
receipts, admission, execution, ordering, recovery and observations. The server owns bearer
tokens, wire validation, HTTP/SSE buffers and process lifetime. No additional framework or
external dependencies were added.

The interface uses a compact workspace/member sidebar, two agent conversations on desktop,
attributed message cards, live state badges, command activity, and a composer for each agent.
Open **Access & coordination** to inspect the M:N matrix and shared-file limitations. Small
screens stack the conversations and provide a **Workspace & sign in** navigation drawer.
Visual hierarchy was informed by T3 Code; this remains an original plain DOM/CSS frontend.

## Try without credentials

Use the prepared repository tools. Workspace packages must already be built; after a fresh
checkout/install, run `npm run build:offline` from the repository root first.

From the repository root in PowerShell:

```powershell
. .\.artifacts\env.ps1
Set-Location apps/collab-demo
npm run preview
```

After changing browser assets, restart the preview host and reload the page. The host loads
assets into memory at startup; refreshing an already running host alone does not load a new build.

Open **http://127.0.0.1:4311** in three browser profiles. Connect with `preview-alice`,
`preview-bob`, and `preview-carol`. The access matrix shows all six user/agent pairs. These
public tokens belong only to the loopback preview. All members can submit
follow-ups, see peer messages/command states, reconnect, load history and stop a lane.

The preview uses a simulated native model and a simulated external driver. Each native command
runs Pi's actual write tool on `native-preview.txt`; each external command waits briefly, then
writes its submitted text to `external-preview.txt` in the same temporary directory. Responses
are scripted; the preview does not interpret arbitrary coding instructions, contact a provider,
or exercise Codex. It uses memory storage and removes the temporary directory on graceful exit.
Ctrl+C stops the host. A forced termination may leave that directory behind.

For an explicit M:N walkthrough, same-agent queue behavior, and reproduced shared-file conflicts,
see [Problem scenarios, current handling, and open risks](PROBLEM_SCENARIOS.md). It covers
interaction, filesystem, recovery, security and operational failures, separating current
evidence from proposed protections. Both preview agents also accept
`shared: <replacement text>` to overwrite the same `shared-preview.txt`. This demonstrates
the current absence of file-conflict protection; no merge or rollback is promised.

## Run with real agents

For real local inference without provider keys, follow [Local models](LOCAL_MODELS.md).
`config.ollama.example.json` configures two shared native lanes on one small Ollama model;
this exercises native Pi, not the external Codex adapter. The setup includes an opt-in
HTTP/SQLite/tool-use smoke check and an explicit list of checks that still need credentials/GCP.

1. Copy `config.example.json` to the ignored `config.local.json`.
2. Replace the native model placeholder with an ID from the local catalog:

   ```powershell
   node --conditions=source --experimental-strip-types ../../packages/durable/test/examples/40-native-providers.ts openai --list-models
   ```

3. Set `OPENAI_API_KEY` privately in the launching environment. Generate private user tokens:

   ```powershell
   $env:COLLAB_TOKEN_ALICE = node -p "require('node:crypto').randomBytes(24).toString('base64url')"
   $env:COLLAB_TOKEN_BOB = node -p "require('node:crypto').randomBytes(24).toString('base64url')"
   node --conditions=source --experimental-strip-types src/preflight.ts
   npm start
   ```

Open **http://127.0.0.1:4310**. Give each user their token privately; enter the token's value in
the browser. Tokens remain in page memory and Authorization headers, never URLs or browser
storage. API keys stay in the host environment. There is no `.env` loader in this application.

Preflight validates configuration, tokens, selected local model IDs, browser assets and selected
native API-key environment presence. It opens no store/socket, spawns no CLI and makes no provider
request. `configuration-valid` does not verify authentication, filesystem permissions or live
model access. This check targets API-key setup; alternate OAuth/federation setup is not verified.

The example includes native Pi and external Codex. Codex requires its own installed CLI and
working authentication; a native OpenAI API call does not establish Codex access. To start with
only the OpenAI key, replace the Codex entry with another native agent using a different ID and
the same OpenAI model. This demonstrates two agents with one provider; live multi-harness
verification still requires a successful Codex turn later.

Native provider IDs: `openai`, `anthropic`, `google`, `deepseek`. Corresponding environment keys:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`. All factories are
registered; only selected native agents need keys. No multi-key live checks run automatically.

| Setting | Default / purpose |
| --- | --- |
| `COLLAB_CONFIG` | `config.local.json`; private host configuration path |
| `COLLAB_DATA` | `data`; SQLite database and its shared `workspace/` subdirectory |
| `COLLAB_PORT` | `4310`; bind only to `127.0.0.1` |
| `CODEX_BIN` | `codex`; installed CLI executable |
| `COLLAB_OLLAMA_URL` | `http://127.0.0.1:11434/v1`; loopback-only local inference, no real provider key |

The real host uses SQLite. Agent/member/workspace configuration is fixed for a store; reopening
with a different configuration refuses rather than silently migrating it. Use a new
`COLLAB_DATA` directory to try another configuration. Keep exactly one owner per store.

Commands can spend provider tokens and modify files. Native shells have a configured 60-second timeout;
external turns use the package's 120-second default. These limits are not a total spend/memory
budget or filesystem sandbox. The host environment and its credentials are accessible to
trusted local execution. Use disposable workspaces and minimal credentials.

Prompt native Bash shutdown on Windows is not verified: an existing interruption/reopen test
takes about 30 seconds on this host. Codex requests one-second forced-kill escalation, with
scripted attached-child cleanup tested on Windows; detached writers and Linux remain open.
Do not start a replacement owner until former workspace writers are confirmed stopped.

## Transport contract

All API routes require `Authorization: Bearer <user token>`.

| Route | Behavior |
| --- | --- |
| `GET /api/threads` | User identity, accessible threads, named agents and recovery descriptions |
| `POST /api/threads/:thread/agents/:agent/commands` | JSON `{id,text}`; durable `202` receipt |
| `GET /api/threads/:thread/agents/:agent/commands/:id` | Requesting user's command status |
| `GET /api/threads/:thread/agents/:agent/state` | Current bounded package snapshot |
| `GET /api/threads/:thread/agents/:agent/events` | Authenticated fetch/SSE snapshots |
| `GET /api/threads/:thread/agents/:agent/history?limit=20&cursor=...` | Projected history; round-trip `next` as an encoded query value |
| `POST /api/threads/:thread/agents/:agent/stop` | Stop this lane's work and queued inputs; peers continue |

Submit validates a 64-KiB encoded body before parsing, a 128-character command ID, and the
package's input rules. Author, workspace, provider and thread configuration cannot be supplied
in a command body. Membership is enforced by the package for commands and observation reads.
Errors map to 400/401/403/404/409/413/415/429/503 as applicable; unexpected runtime failures
return a generic 500. Retry ambiguous submit failures using the original ID and text.

A storage exception can occur after SQLite persisted the command. It fails the entire thread's
Harness, not just one lane; restart only after old-owner cleanup. Do not interpret the error
as proof of rejection or generate a new ID for the same ambiguous submission.
The host observes Harness closure, closes HTTP and attempts cleanup, then exits with an error
on failure. It does not automatically reopen the store. Shutdown can still wait on tool cleanup.

The [Linux/GCP preparation kit](deploy/README.md) includes a manual-start systemd template,
private environment template, stopped-store backup script, SSH access and restore/teardown
instructions. It has not been deployed or runtime-verified on Linux. GCP remains deferred.

The browser retains that draft/ID until acceptance or explicit discard. It does not persist
ambiguous drafts across a page reload. Discarding a retry does not cancel already accepted
work. Transcript entries merge by stable ID and retain at most 200 entries per lane; the
current command panel shows the package's latest eight. Text renders through `textContent`.

Each configured lane has one package watch, regardless of viewer count. Each lane allows 32
viewers. A viewer has at most one pending snapshot behind a blocked socket; progress is
coalesced and the latest snapshot includes recent terminal outcomes. Frames over 1 MiB or a
socket write that would exceed the 2-MiB application buffer threshold disconnect the viewer.
These thresholds exclude kernel buffers and are not a whole-process memory bound. Heartbeats
run every 15 seconds. Browser reconnect fetches current state; SSE has no durable replay cursor.
Disconnecting a browser never sends Stop. State/history provide recovery after a long absence.

## Checks and remaining evidence

The [deterministic load runner and measurement report](load/README.md) exercise the real
authenticated HTTP/SSE server and SQLite with simulated execution. Run from this directory:

```powershell
node --conditions=source --experimental-strip-types load/run.ts 600 ../../.artifacts/collab-load.json
```

This uses fresh disposable stores and no provider keys or Codex processes. It does not change
the running preview or establish live harness capacity.

Run from this directory, using repository dependencies:

```powershell
npm run check
npm run build
node ../../node_modules/vitest/dist/cli.js --run test/http.test.ts test/streams.test.ts test/configuration.test.ts test/preview.test.ts test/concurrency.test.ts test/load.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/startup.test.ts test/lifetime.test.ts test/preflight.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/ollama.test.ts
```

Tests exercise real HTTP and Durable with deterministic I/O: authorization, scoped retry,
conflicts/capacity, body validation, both execution kinds, two viewers, late join, disconnect,
reconnect, stop isolation, viewer limits, UTF-8/chunk framing, and actual shared-file writes.
Backpressure/coalescing is also checked with controlled response writes. The built browser
modules are served by the end-to-end preview test; this is not an automated browser-click test.
Startup/lifetime tests cover selected-provider requirements, environment validation, actual
Harness storage failure, signal cleanup and read-only preflight subprocesses, including missing keys.

A separate ad-hoc Chrome 156.0.8078.80 check executed the actual browser modules with Alice,
Bob and Carol: shared messages/queues, reconnect without duplicate messages, stop, draft clearing,
history, mobile sign-in and text-only rendering. Desktop (1440×960) and mobile (390×844)
screenshots were inspected. Local evidence is under the ignored repository `.artifacts/`
directory (`collab-ui-browser-check.json` and `collab-ui-*.png`); it is not part of the Vitest suite.

Still pending: live provider/Codex coding turns, remaining forced-process
crash boundaries and real descendant cleanup, broader capacity measurements, and GCP deployment. The current host
is for a trusted local team, without public HTTPS, distributed ownership, rich tool rendering,
or an approval UI. Track those separately in [the implementation record](../../TAKE_HOME_PROGRESS.md).
