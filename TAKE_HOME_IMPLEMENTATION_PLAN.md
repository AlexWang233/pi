# Implementation plan: evolve Pi Durable in this fork

Implement a version of Pi Durable that supports multiple people interacting with independently addressable coding agents in shared conversation threads. **The runtime feature belongs in `packages/durable`; the HTTP application is a small demonstration of it.** This is the chosen interpretation of [the assignment](PROJECT_INSTRUCTIONS.txt), not a claim that its wording has only one possible interpretation.

This plan supersedes the earlier wrapper-first design. The [commit plan](TAKE_HOME_APPROACH_A_COMMIT_PLAN.md) gives the coding sequence. The [project guide](TAKE_HOME_PROJECT_GUIDE.md) explains existing mechanisms; its original recommendation of a separate runtime wrapper is no longer the selected architecture.

Budget: **18 planned hours plus 2 hours contingency**, including implementation, checks, GCP deployment, stress testing, and presentation. This is an ambitious proof of concept, not production collaboration infrastructure. Work in the user's fork; upstream acceptance and preserving hypothetical integrations are not design goals. Preserve useful existing native execution rather than replacing it unnecessarily.

## 1. Deliverable and scope

The finished demo must show two authenticated people, one native Pi agent, and one Codex agent using T3 Code's implementation, concurrently operating in the same thread/workspace. Both users see attributed requests, live progress, queued follow-ups, stop outcomes, committed answers, and reconnect state. Restart and overload behavior have reproducible evidence.

The package itself must demonstrate these behaviors through its public API and runnable examples **without importing the demo server**. That establishes an evolved Durable runtime rather than an application queue relocated into another wrapper.

| Required | Deferred to protect the 20-hour scope |
| --- | --- |
| Package-owned threads, named agents, attributed durable commands | Dynamic membership/room administration, production identity integration |
| Native Pi plus a T3-backed Codex adapter | More harnesses, provider switching/account catalog, automatic delegation |
| One shared workspace per thread, separate agent histories | Shared-file conflict prevention, branching/merge, hostile tenant isolation |
| Follow-up queueing, status, lane-wide stop, bounded observations | Live steering, individual queued-command withdrawal, terminal emulator |
| Process-restart behavior, deterministic tests/load, GCP demo | Distributed ownership, autoscaling, multi-zone availability |

Sharing a thread does not automatically copy all messages into every model context. Users explicitly target agents. Agent-to-agent autonomous conversation is not required by the assignment's description of people talking to multiple agents.

## 2. Extend the existing package, not a parallel runtime

Durable already has conversations, attribution-capable input entries, inboxes, task ownership, atomic commits, watches, and SQLite recovery. Reuse them. The missing package feature is a coherent collaborative API that makes these mechanisms work across native and externally managed coding agents.

| Responsibility | Owner in this fork |
| --- | --- |
| Thread/member records, agent IDs and conversation mapping | Durable collaboration API and documents |
| Membership decisions, attribution, idempotent admission, limits | Durable, in the admission transaction |
| Native work | Existing Durable submission/generation/inbox machinery |
| External work, queue, dispatch marker, settlement | Durable external-execution task using the existing scheduler/storage |
| Native/external status, history, progress, cancellation | Durable collaboration views/API |
| Codex protocol/session/process integration | Adapter subpath inside the Durable package, reusing T3 implementation |
| Token verification, HTTP parsing/status codes, SSE socket buffers, UI | Thin demo application |
| Exclusive process ownership, persistent disk, supervision | Deployment configuration |

The server converts a verified token into a caller identity, then calls a Durable operation. It cannot make an uncommitted command look accepted or bypass package membership checks. The package trusts the host's authenticated identity; it does not implement an identity provider.

Proposed package layout, to refine after reading the relevant source in full:

```text
packages/durable/
  src/collaboration/
    index.ts                 # public exports
    types.ts                 # thread/agent/command and external-session contracts
    thread.ts                # open/configure thread; membership and agent mapping
    commands.ts              # atomic admission, receipt lookup, status, lane stop
    external.ts              # registered external-execution task and recovery rules
    view.ts                  # common bounded native/external presentation
  src/adapters/codex/
    index.ts                 # Node-only T3-backed adapter entry point
    session.ts               # lifecycle and normalized protocol events
    vendor/                  # required T3 source closure, license, provenance
  test/collaboration-*.test.ts
  test/codex-session.test.ts
  test/examples/NN-*.ts       # allocate unused numbers when implementing
  docs/spec.md               # normative additions for the fork
  package.json               # exports and reviewed dependency metadata
apps/collab-demo/            # HTTP, credentials, static client, load/deploy scripts
```

Add `/collaboration` and `/adapters/codex` export subpaths in the **same existing package**; no additional published runtime package or application-owned scheduler. Generic collaboration code may use existing Durable/Chord internals. Its public data/driver contract must not expose T3 or Effect types. Keep optional Node adapter imports out of the root, browser, and generic collaboration entry graphs.

Use exact optional peer dependencies for the adapter's Effect/platform libraries, plus exact development dependencies for compiling/testing the fork. Validate this arrangement against the repo's dependency and entry-graph checks before adopting it. The generic entry must work without the optional adapter installed/loaded. Do not spend the take-home designing a general plugin framework or removing Chord.

## 3. Proposed API and data model

Names below describe the intended API; they are not existing exports. Prefer adding a focused thread facade over the existing Harness and transactions to rewriting the Harness class or scheduler wholesale.

| Package operation | Behavior |
| --- | --- |
| Open/create collaborative thread on a Harness | Idempotently establish member IDs, server-chosen workspace, and named agent conversations |
| Submit targeted command with caller ID and command ID | Authorize, deduplicate, validate capacity, commit executable intent, return receipt |
| Read command/history/thread state | Authorize and return package-owned data with stable IDs |
| Watch thread/agent state | Initial bounded state and subsequent changes; explicit disposal |
| Stop named agent | Stop current ordinary work and withdraw pending lane inputs; leave other agents running |
| Register external driver | Bind a stored driver name to current-process code with a narrow session interface |

A thread is the shared room/workspace; an agent lane maps a stable agent ID to a conversation and tagged execution configuration (`native` or `external`). External drivers open sessions, start turns, emit normalized progress/outcomes, interrupt, and close. Keep driver registration separate from serializable configuration, like Durable's existing registry pattern. Missing driver code after restart yields visible blocked/unavailable state, not fallback to a native model.

Reuse built-in documents and task records wherever semantics fit. Add package-owned documents for thread membership/mapping, scoped command receipts, external queue/active task reference, and external live state. Store native provider references privately. Do not put another execution database in the demo application.

Keep receipt lookup bounded through a small lifetime command cap per demo thread; do not delete receipts and silently change retry semantics. This is an intentionally limited prototype, with separate disposable stores for load scenarios.

## 4. Admission, execution, and recovery

Example: Alice sends `c17` to Codex agent B. Durable commits its receipt, attributed input, queue item, and executable task intent. The HTTP reply is lost. Alice retries: the same receipt is returned, without creating another command. Reusing that ID with changed text is a conflict.

All admission decisions happen inside one package transaction: membership, receipt lookup, normalized-payload comparison, capacity, and executable intent. Check duplicates before rejecting capacity. Scope command identity by thread, caller, and agent. Use transaction reads inside callbacks; ordinary Harness reads can deadlock behind the commit holding the line.

- **Native lane:** use existing `submit(tx, draft)` once before table writes, with attribution and a package receipt mapping. Retain native inbox/generation behavior; do not create a second native queue.
- **External lane:** commit input/history, queue state, and creation/wakeup of its package task together. Do not call native generation too. Serialize external work per lane through persisted driver/task state. Pi and Codex can run concurrently across lanes.

External I/O happens outside transactions. Before starting an external turn, persist a dispatch marker. If execution re-enters after restart with that marker but no committed terminal result, settle the command `interrupted` and require explicit retry. A crash after the marker but before send can lose an attempt; this conservative policy avoids an automatic second execution of uncertain effects. A checkpoint named `dispatch` alone does not stop replay.

Persist final outcomes/history before reporting committed results. Progress is replaceable, bounded state; use Durable's existing progress/deferred-persistence semantics deliberately. Reject late events from retired executions. A tool/child completion cannot complete the root command. Do not mark arbitrary shell effects replay-safe.

Native Pi retains Durable's recovery rules. External Codex has explicit-retry recovery, displayed in capabilities/state. Safe native-thread continuation for a later Codex command requires verification; otherwise require an explicitly fresh session. Missing adapter code, transport loss, stopped work, provider failure, and uncertain interruption must be distinguishable.

Client disconnection disposes observation only. Lane stop propagates to runtime/tools/processes and visibly settles pending inputs. Default failed-run policy for this demo withdraws queued inputs with a reason instead of silently making more paid calls. The supervisor must terminate the old process tree before another owner admits workspace mutations.

## 5. T3 reuse inside Durable

Use `E:\Github\t3code` at inspected commit `d5fc29fe5cb62db68bfbf824cfabe0ae94ac6ac4`:

- Reuse [the Codex client](../t3code/packages/effect-codex-app-server/src/client.ts), its protocol/errors/internal helpers/generated types, and [replay support](../t3code/packages/effect-codex-app-server/src/replay.ts).
- Adapt small fixtures from [the simple recording](../t3code/apps/server/src/orchestration-v2/testkit/fixtures/simple/codex_transcript.ndjson). T3 initialization/path fields require review; recordings are not automatic compatibility guarantees.
- Consult [the full Codex adapter](../t3code/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts) for lifecycle meaning without importing the full application graph.

Vendor the required source closure within the package adapter, preserving [MIT notices](../t3code/LICENSE), upstream revision, copied paths, and local modifications. Keep generated schemas intact and type-check them; review authored adaptations against repository code rules. Ensure required notices ship with built artifacts as well as source.

The inspected T3 workspace pins Effect/platform-node to `4.1.2`; inspect installed API types and validate exact versions in the extraction spike. Select/pin the actual Codex CLI only after protocol initialization verification. Credentials, CLI access, and real model access are prerequisites for the live demo. Replay tests alone do not establish working deployment.

## 6. Demo application and GCP

Keep `apps/collab-demo` small: fixed token-to-user mapping, configured threads, command/status/history/stop HTTP routes, one SSE stream per viewed thread, and plain two-lane HTML/JavaScript. No runtime facade reimplementing Durable's admission or queue. A package failure must remain visible, rather than be patched over by server memory state.

Authorize reads and streams as well as commands. Validate wire input and body bytes before parsing; never accept author identity or workspace paths from the request. Use authenticated fetch streaming; do not put bearer tokens in URLs. Show stable message/command IDs, transient versus committed output, queued state, stop scope, and recovery capabilities.

One upstream package watch per lane feeds bounded viewer buffers. Capture initial state and register future updates without an async gap. Coalesce progress, flush terminal state, disconnect stalled over-limit viewers, and reconnect through snapshots plus history paging. No global replay cursor or strict cross-lane timestamp order is promised.

Retain the chosen GCP deployment: one Linux Compute Engine VM, persistent storage, one owning process per store, process-group-aware supervision, and evaluator SSH forwarding. It fits long-lived tools and shared local files without a distributed filesystem. Persistent block storage and the default Cloud Run filesystem have different lifetimes; see [Persistent Disk](https://docs.cloud.google.com/compute/docs/disks/persistent-disks) and [Cloud Run's container contract](https://docs.cloud.google.com/run/docs/container-contract).

Pin Node and the tested Codex CLI; build the modified Durable package and adapter. Verify both harnesses under the service's OS environment. A developer-shell login does not establish service access. Document setup, access, restart/reboot, export/backup, and teardown, including retained disks. Never back up a live SQLite main file alone without a coordinated snapshot/WAL-aware method.

The initial self-imposed spend envelope remains $30 infrastructure and $10 live-model smoke calls, subject to checking actual prices before provisioning; these are caps to plan around, not estimates. Use deterministic load/replay. Signup-credit eligibility and external provider access are separate. Alerts-only budgets are not automatic spend stops; see [billing guidance](https://docs.cloud.google.com/docs/get-started/learn-about-billing) and [spend-cap limitations](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps).

## 7. Verification, failure analysis, and time limits

Package tests/examples must establish the feature without HTTP. Demo integration tests then establish token handling, transport retry, stream pressure, and reconnect. Cover:

| Mechanism | Required evidence |
| --- | --- |
| Thread/agent mapping | Idempotent initialization; one shared directory; independent histories/execution |
| Admission | Concurrent duplicates, payload conflicts, authorization, rollback, queue limits, retry after reopen |
| External execution | Exactly one driver claim, correlated events, root completion, interrupt, missing driver, blocked interaction |
| Crash boundaries | Before/after admission; after dispatch marker; after effect before result; no automatic uncertain Codex resend |
| Isolation of failure | Stopping/failing one lane leaves the other operating; storage failures never report false acceptance |
| Delivery | Late join, reconnect, slow viewer, bounded snapshots/output, disposal |
| Workspace | Distinct-file edits survive; same-file stale-write behavior is demonstrated and documented |

Durable's edit/write queue is process-local and does not coordinate Codex or arbitrary shell writers. Shared cwd is not a security boundary. Trusted collaborators, disposable repositories, minimal credentials, and explicit limits are the baseline; hostile multi-tenancy and conflict-free editing are not delivered.

Run deterministic load through real HTTP/SSE paths: one thread/two agents/two viewers, then five threads/ten agents/ten viewers, increasing arrival rate to find a measured limit. Include a short soak and separate failures. Measure acceptance/queue/completion/stream latency, rejection rate, CPU/RSS/event-loop delay, commit latency, process count, and recovery time. Record versions, commit, machine, output sizes, duration, and samples. Separate logical commands from permitted model/tool rounds and retries. No throughput claim precedes measurements.

Discuss VM/process/zone failure, per-thread serialized writes, provider quota, external process pressure, output/observer memory, and cross-harness file races. Keep one owner; multiple processes opening one Durable store are not a scaling strategy. Later distribute exclusive thread owners and workspace access together, with tested stale-owner prevention, before claiming safe failover.

The [commit schedule](TAKE_HOME_APPROACH_A_COMMIT_PLAN.md) budgets 18 hours plus 2 reserve. Require adapter replay and CLI initialization early, the package-only mixed-agent example by roughly hour 9, and deployment by roughly hour 15. If behind, cut optional controls/polish before package ownership, T3 integration, correctness, or deployment evidence. Name credential/compatibility blockers; do not silently substitute a Pi-only wrapper or call replay-only execution a live integration.

## 8. What remains flexible

Another harness implements the package's external-session contract. Replacing Chord/storage/scheduling is later option B, **inside this fork**, using the package feature tests as behavioral contracts. Do not introduce another published runtime dependency to prepare for it. Start any incompatible replacement with new stores; live-checkpoint migration is outside this assignment.

Keep the generic adapter contract independent of Effect and provider schemas; framework-specific code remains on an explicit adapter subpath. Chord is still used internally. The claim is an evolved Pi Durable with collaborative multi-harness execution, not completed removal of framework dependence.

Hand in package changes, public contracts/spec additions, tests/runnable examples, T3 provenance/license notices, the thin demo, GCP runbook, measured limits, and an eight-minute demo. Explain what was reused, what changed in Durable, and which guarantees were actually demonstrated.
