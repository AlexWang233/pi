# Collaborative execution addendum

This fork adds `/collaboration` and Node-only `/adapters/codex` entry points to the existing
Durable package. It reuses the Session commit line, documents, conversations, native inbox,
tasks, and storage. There is no application-owned queue or second persistence engine.
This addendum expands the fork contract in [specification section 14](spec.md#14-collaborative-threads-in-this-fork)
and is linked from the package [README](../README.md#collaborative-threads). The full core
specification was reviewed for this integration; its transaction/task/submission/watch rules
remain unchanged. This is contract reconciliation, not a fresh audit of all core implementations.

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

The demo also composes a keyless local Ollama provider through Pi AI's existing compatible chat
API; it is host configuration, not another external harness. A real two-user/two-agent browser
check against the normal SQLite host completed five commands, verified file bytes and native
follow-up ordering, reconnected an offline viewer and reopened the idle host with stable receipts.
See [local setup/evidence](../../../apps/collab-demo/LOCAL_MODELS.md). This does not verify hosted
provider authentication, a Codex turn, active-shell cleanup or production model quality.

## Thread ownership

One thread occupies one Harness/store. Configuration is fixed, serialized, and compared on
reopen; changing it through `open` is rejected. The host authenticates callers and supplies
the caller ID. The package checks stored membership for submit, command, history, watch,
and stop. Members can view peer histories/projections and stop a peer's lane; command lookup
uses the requesting author's identity. Histories remain separate even though files are shared.

## Admission and ordering

### Model-facing collaboration awareness

Agents receive a collaboration policy, not just a shared directory. Before each native model
request, the extension renders a `collaboration` system-prompt section from saved thread state:
self/peer identities, members, active request authors and recent accepted-request metadata.
External drivers receive the same policy in their instructions at each turn open/resume. Custom
agent instructions and the original user text remain unchanged.

For example, if GPT replaces a file Ollama previously wrote, Ollama is instructed to treat the
different bytes as a possible peer/human edit, reread before editing, and avoid assuming its
earlier write failed. It should preserve unrelated changes and ask when conflicting intent is
unclear. A reread is not a lock, and a recent GPT request is not proof that GPT wrote that file.
The policy does not fabricate file authorship, prevent reversions, share full peer histories,
or enforce model compliance. Conflicting requirements and uncoordinated writes remain risks.

Context includes up to eight members/agents, six recent receipts and four active requests,
with identifiers abbreviated to 64 characters and full participant counts retained. Peer prompt
text, answers and tool outputs are not promoted into the system section. Metadata is a recent
observation, not an atomic view of filesystem effects or a complete event journal. Updating
sections costs prompt tokens and can add ordinary system-section entries when metadata changes.

Existing compatible stores receive this context on their next model request after installing
the updated extension/restarting the owner; no fixed configuration rewrite or new database is
required. Already-sent model requests are not updated mid-flight. External context refreshes at
turn start, not continuously inside another harness. See [implementation](../src/collaboration/context.ts)
and [request/file/reopen tests](../test/collaboration-context.test.ts). Tests use simulated models;
real OpenAI/Ollama interpretation and current Codex behavior require separate live checks.

### Request receipts and scheduling

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

Retrying an interrupted command with its original identity returns the existing receipt and
does not rerun it. Inspect uncertain effects before explicitly submitting a new command ID.

Native recovery retains the existing Durable semantics. External successes store a private
continuation reference; later commands can resume the provider thread. Real Codex continuation
and descendant-process cleanup still require additional verification.

### Admission acknowledgement and native recovery boundaries

[`collaboration-boundaries.test.ts`](../test/collaboration-boundaries.test.ts) adds 12 cases
using real SQLite, six forced owner kills and injected storage failures on Windows/Node 22:

| Boundary | Observed result |
| --- | --- |
| Native/external admission before SQLite persistence | No receipt or executable work survives; retry admits one command |
| Native/external admission persisted, durability acknowledgement withheld, then owner killed | Receipt and intent survive; original-ID retry executes once |
| Admission storage call throws before or after persistence | Submit rejects and Harness fails; after reopen, original-ID retry works whether receipt was absent or present |
| Native model request interrupted by owner death | One command receipt, two model requests across restart; command eventually answers |
| Unsafe native tool appends a file, then owner dies | File effect remains once; tool is not rerun, interrupted tool result is visible and model generation can continue |
| External result storage call throws before or after persistence | File effect remains once; reopened command is interrupted before persistence, completed after persistence; neither path resends it |

A callback error before storage and a storage error are different. The latter can mean
the database committed but its caller did not receive success. **An exception is not proof
of rejection.** Preserve the original command identity/text, stop the failed owner and inspect
or reopen the store. No automatic failed-Harness reopen loop is added. Storage failure affects
the whole Harness/thread, including peer submissions and watches, not just one agent lane.

Command deduplication does not promise one model request: native generation recovery may resend.
The unsafe-tool test uses a declared unsafe append tool, not an arbitrary shell. It does not
prove every model-selected mutation is replay-safe or that a surviving old writer has stopped.

External status and admission capacity also consult the underlying task. If collaboration
metadata still says queued/running after that task becomes terminal, the public command is
`interrupted` with a reason naming the task outcome. It no longer consumes pending capacity
or displays stale running progress. Metadata and task are read on the same transaction line,
so ordinary completion between separate reads cannot produce false interruption. This is a
derived status, not a background metadata rewrite or a newly appended outcome-history entry.
Already settled command outcomes remain authoritative. Nonterminal tasks blocked by a missing
definition/migration remain blocked; this rule does not label them completed or restart them.

[`collaboration-recovery.test.ts`](../test/collaboration-recovery.test.ts) adds real owner-process
termination with SQLite at explicit barriers, using a deterministic external driver:

| Kill boundary | Verified result after reopen |
| --- | --- |
| Dispatch memo committed, driver open reached, turn not started | Interrupted; no second driver open and no file effect |
| File effect complete, result not committed | Interrupted; effect remains once, no second driver open |
| Result committed before owner termination | Completed answer/identity retained; same-ID retry does not run again |
| File effect complete, then reopen at restart limit | Scheduler records a faulted task; derived command is interrupted and fresh work can be admitted |

The first two cases also retain an already queued successor and verify it stops after the
uncertain predecessor. A separate test injects a result-settlement fault and checks status,
watch idleness/progress and capacity recovery; other cases verify late progress cannot revive
a settled command and live progress survives a full receipt window. These tests were run on
Windows with Node 22 and kill only the spawned
owner process. They do not verify a real CLI's grandchildren, Linux process groups, all native
crash boundaries, filesystem rollback, or host/power-loss durability.

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
The projection combines separate source watches and command reads; it is convergent presentation,
not an atomic snapshot across those sources. Native completed-answer status can precede lane
idleness when after-run hooks are selected, as described in specification section 8.3.

External progress requests deferred persistence but updates a session-scoped document. That
scope is ineligible for holding under [specification section 4.1](spec.md#41-deferred-commits),
so these progress commits are stored immediately. Native `pi.live` progress can be held.
This is a write-cost limitation; the external `withinMs` option does not establish batching.

External retained progress/results default to 65,536 characters. Native model/tool budgets
and shell timeouts still require host/tool configuration; display clipping does not limit
provider spend, stored native history, or arbitrary shell work. Limits are characters, not
an encoded-byte or whole-process memory guarantee.

## T3 and known limitations

The Codex adapter uses vendored T3 typed client/protocol/replay code with upstream notices.
Effect/platform libraries are exact optional peers and development dependencies; generic
collaboration imports do not load them. Initialization was verified against local Codex
`0.164.0-alpha.11.1`; the adapted replay originates from upstream `0.156.1`. This does not
certify all current CLI features or protocols. No real Codex model turn has been run yet.

The first adapter projects agent text and final results, rejects known interactive approval/
user-input requests, and uses workspace-write with approval policy never. Rejected requests
are visible failures, not automatic approvals. Once a turn ID is known, later start notifications
cannot retarget it. An initial notification that disagrees with the `turn/start` response fails
instead of selecting an unrelated result. Completion before the start response is awaited is
supported; an item completion alone is not a root outcome.

On cancellation, the adapter attempts `turn/interrupt` independently of the aborted turn
signal, and waits for acknowledgement or its one-second limit before returning to the caller
for process cleanup. Missing acknowledgement does not prevent cleanup or prove the turn stopped
cooperatively. The caller/runtime still owns `close()`, including on failure.

[`codex-process.test.ts`](../test/codex-process.test.ts) has 18 cases through the actual
`createCodexDriver`, reused T3 client, JSONL stdio and OS child-process scope. A scripted Node
app-server supplies recorded initialization/thread replies and synthetic events. Coverage:
root/early/unrelated/mismatched turn correlation, item-only completion, root failure,
`thread/resume`, file/command approval and user-input/unknown requests, unexpected exit with
stderr, malformed JSONL, initialization failure, and interrupt with/without acknowledgement.
The child PID is confirmed absent after normal closure and initialization exit on Windows.

Two Windows-only cases also spawn an attached Node descendant and verify both PIDs are absent
after normal close or unexpected leader exit in this fixture. This is attached-tree evidence,
not arbitrary detached/orphan containment or real Codex tool-process evidence.

The adapter requests forced-kill escalation after one second via the installed spawner API.
On POSIX this avoids an unlimited cooperative SIGTERM grace period; the spawner can also wait
after escalation. It is not a hard end-to-end shutdown deadline or a termination certificate.
Windows uses the spawner's tree-kill behavior. Escaped writers, abrupt owner death and Linux
cleanup still require host supervision/verification before safe workspace takeover is claimed.

An unmodified native Bash interruption/reopen regression takes about 30 seconds on this Windows
setup and times out at its default five-second test limit. It passes with a 40-second runner
limit. The cause of that delay is not localized here; prompt Bash cancellation remains open.
No test timeout or native runtime behavior was changed to conceal it.

These are process/adapter tests, not real Codex model/authentication tests.
The resume case verifies protocol selection against a scripted response, not safe live
continuation after uncertain effects. Malformed JSONL terminates the transport; known typed
notifications that fail schema validation are instead warned about and dropped by the vendored
client, so a missing valid completion still relies on the external deadline. Rich approval UI,
tool summaries, Linux cleanup and live compatibility remain follow-up work.

Shared cwd is not security isolation or conflict prevention. Codex and shell writers bypass
Pi's in-process edit/write queue. This prototype assumes trusted collaborators, one owner per
store, and disposable repositories. GCP deployment and hostile tenant protection remain open;
the separate [deterministic load report](../../../apps/collab-demo/load/README.md) measures
SQLite/HTTP/SSE with simulated execution rather than real Codex capacity.

An opt-in [`ManagedFile` API](managed-files.md) now implements conditional publication for
one bounded text file, retained base/current/proposed evidence, stable retries and conservative
blocking after uncertain writes. It uses the existing documents and file-mutation gate. It is
not wired into normal model tools or Codex; the HTTP/browser demo uses it only in a separate
scripted conflict scenario. Direct writers remain unprotected.

The separate [HTTP/browser demo](../../../apps/collab-demo/README.md) now hosts this package
API with bearer authentication, bounded SSE fanout, and a minimal client. Its credential-free
preview runs real Durable/tools with simulated provider/CLI I/O; the live composition uses
SQLite, the four hosted-provider factories, optional local Ollama composition, and optional
Codex lanes. The preview itself does not establish live model, load or GCP evidence; the
selected owner-crash evidence above comes from separate package tests.

The demo's file viewer is an authenticated, manually refreshed read-only transport feature;
it does not participate in publication or create a managed-file policy. Small UTF-8 files and
bounded folder listings can be inspected directly without asking an agent to describe them.
