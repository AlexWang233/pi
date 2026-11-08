# Collaborative execution addendum

This fork adds `/collaboration` and Node-only `/adapters/codex` entry points to the existing
Durable package. It reuses the Session commit line, documents, conversations, native inbox,
tasks, and storage. There is no application-owned queue or second persistence engine.
This addendum documents the first implemented slice; integrating it into the main normative
specification and README remains follow-up documentation work.

## Current API

```typescript
const collaboration = createCollaboration([createCodexDriver()]);
registry.install(collaboration.extension); // before opening/recovering the Harness
const thread = await collaboration.open(harness, {
  id: "project",
  workspace: "/work/project",
  members: ["alice", "bob"],
  agents: [
    { id: "pi", kind: "native", model: { provider: "openai", modelId: "configured-model" } },
    { id: "codex", kind: "external", driver: "codex" },
  ],
}, context);
await thread.submit("alice", { id: "request-1", agentId: "codex", text: "Inspect the project" }, context);
const state = await thread.command("alice", "codex", "request-1", context);
const watch = await thread.watch("bob", "codex", context);
watch.start(async (snapshot) => render(snapshot));
await watch.stop(); // stops observation, not the agent
```

The model ID above is a configuration placeholder, not a runnable provider recommendation.
See examples `38-collaborative-thread.ts` (deterministic, shared files) and
`39-codex-initialize.ts` (real CLI, no model turn).

## Native model providers

Native agents reuse Pi AI's existing providers; no additional provider SDK or driver is
needed. Register these factories in the host's `Models` collection before opening the Harness:

| Model family | Provider ID | Factory | API-key environment variable |
| --- | --- | --- | --- |
| GPT / OpenAI | `openai` | `openaiProvider()` | `OPENAI_API_KEY` |
| Claude | `anthropic` | `anthropicProvider()` | `ANTHROPIC_API_KEY` |
| Gemini | `google` | `googleProvider()` | `GEMINI_API_KEY` |
| DeepSeek | `deepseek` | `deepseekProvider()` | `DEEPSEEK_API_KEY` |

Factories come from `@earendil-works/pi-ai/providers/<provider ID>`. Registering a
provider does not make an API request or require its key. Each native agent selects its
own `{ provider, modelId }`; only providers actually used need credentials. Keep keys in
the host environment, outside thread configuration, stored documents, browser code, and Git.

Example `40-native-providers.ts` registers all four and selects one per invocation.
From `packages/durable`, list the local catalog without credentials or network calls:

```powershell
node --conditions=source --experimental-strip-types test/examples/40-native-providers.ts openai --list-models
```

Set `OPENAI_API_KEY` privately in the launching shell, then set `PI_LIVE_MODEL` to a
model ID from that list and explicitly opt into one paid smoke turn:

```powershell
$env:PI_LIVE_MODEL = "<model ID from the catalog>"
node --conditions=source --experimental-strip-types test/examples/40-native-providers.ts openai --run
```

Substitute another provider ID and its key to check it later. Without `--run`, the example
never starts a turn, even if credentials are present. This is a single-provider greeting and
peer-visibility check using memory storage; coding tools and SQLite recovery are demonstrated
separately in example 38. Live multi-provider checks remain deferred until more keys are
available. Registration and deterministic tests do not certify live API compatibility.

The external Codex driver is a separate harness integration with its own CLI authentication.
A native OpenAI turn does not verify Codex authentication. Gemini API-key access uses Google's
direct API and does not require provisioning the eventual GCP deployment.

## Thread ownership

One thread occupies one Harness/store. Configuration is fixed, serialized, and compared on
reopen; changing it through `open` is rejected. The host authenticates callers and supplies
the caller ID. The package checks stored membership for submit, command, history, watch,
and stop. Members can view peer histories/projections and stop a peer's lane; command lookup
uses the requesting author's identity. Histories remain separate even though files are shared.

## Admission and ordering

Command identity is `(thread, actorId, agentId, commandId)`. Equal text under the same identity
returns its original receipt; changed text conflicts. Membership, payload comparison, pending
capacity, receipt creation, and executable intent are decided in one transaction. A failed
callback leaves no accepted command. Acceptance is durable admission, not completed execution.

Native agents use existing transactional submit and native generation/inbox rules. External
commands create ordinary Durable tasks. Each task waits on its unfinished predecessor, so work
is serial per external lane and concurrent across lanes. A failed external predecessor stops
already queued successors; a fresh command after settlement can start again. Lane stop aborts
ordinary work and pending inputs without cancelling peers. Native failed-run queue behavior
still follows host Harness settings; use `afterFailedRun: "withdraw"` for the planned demo.

Receipts are retained up to the configured lifetime command cap (default 256). New admission
then rejects; existing receipts remain retryable. Pending capacity defaults to 16 per agent,
including running/placed commands. This is an explicit bounded prototype, not a retention service.

## Recovery and external effects

External dispatch stores a memo before opening/sending to the driver. Re-entry with the memo
and no outcome settles `interrupted` without sending again. A crash between memo storage and
send can therefore interrupt an attempt that never reached the provider. A lost result can
leave effects on disk; the runtime does not claim exactly-once shell execution.

Native recovery retains the existing Durable semantics. External successes store a private
continuation reference; later commands can resume the provider thread. Real continuation and
forced-process-kill behavior still require additional verification. The current interruption
test uses close/reopen of an active task, not a power-loss or forced-kill test.

Adapter sessions must honor AbortSignal, stop producing progress when their turn ends, and
release processes/resources in close. External deadlines default to 120 seconds. Driver code
is trusted process code, not untrusted input; this is not a sandbox. Missing driver registration
settles a clear failure rather than invoking native generation as a fallback.

## Observations and limits

Package watches combine native conversation state and collaboration metadata. They expose
the latest 8 command summaries and up to 20 recent transcript entries, with 8,192-character
display previews. Native watch folding bounds a stalled listener's pending frames. The host
still owns network buffer limits and fanout. There is no global durable stream cursor or
cross-agent total order; reconnect gets current bounded state and may page earlier history.

External retained progress/results default to 65,536 characters. Native model/tool budgets
and shell timeouts still require host/tool configuration; display clipping does not limit
provider spend, stored native history, or arbitrary shell work. Limits are characters, not
an encoded-byte or whole-process memory guarantee.

## T3 and known limitations

The Codex adapter uses vendored T3 typed client/protocol/replay code with upstream notices.
Effect/platform libraries are exact optional peers and development dependencies; generic
collaboration imports do not load them. Initialization was verified against local Codex
`0.164.0-alpha.11.1`; the adapted replay originates from upstream `0.156.1`. This does not
certify all current CLI features or protocols. No real model turn has been run yet.

The first adapter projects agent text and final results, rejects known interactive approval/
user-input requests, and uses workspace-write with approval policy never. Rejected requests
are visible failures, not automatic approvals. A richer approval UI, tool-progress rendering,
more protocol error cases, and resumption tests remain future slices.

Shared cwd is not security isolation or conflict prevention. Codex and shell writers bypass
Pi's in-process edit/write queue. This prototype assumes trusted collaborators, one owner per
store, and disposable repositories. GCP deployment, stress measurements, and hostile
tenant protection are not implemented by this slice.

The separate [HTTP/browser demo](../../../apps/collab-demo/README.md) now hosts this package
API with bearer authentication, bounded SSE fanout, and a minimal client. Its credential-free
preview runs real Durable/tools with simulated provider/CLI I/O; the live composition uses
SQLite, the four native provider factories, and optional Codex lanes. This does not establish
live model, browser walkthrough, forced-crash, load, or GCP deployment evidence.
