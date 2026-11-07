# Project guide for the collaborative coding-agent assignment

This guide explains what to learn before implementing and presenting the assignment in [PROJECT_INSTRUCTIONS.txt](PROJECT_INSTRUCTIONS.txt). Read it alongside the [tentative implementation plan](TAKE_HOME_IMPLEMENTATION_PLAN.md). The proposed budget is **20 hours total, including reading, deployment, testing, and presentation preparation**.

Repository baseline inspected on November 6, 2026:

| Repository | Local location | Commit |
| --- | --- | --- |
| Pi | `E:\Github\pi`, branch `dev` | `085c84e98e7f4c950f2be606466fff4f75d8fe7c` |
| T3 Code | `E:\Github\t3code` | `d5fc29fe5cb62db68bfbf824cfabe0ae94ac6ac4` |

These are reading notes and design recommendations, not a completed implementation or benchmark report. Paths describe these checkouts; neither repository was executed to validate runtime behavior.

## 1. Translate the assignment into observable behavior

The assignment asks for a design, a working multi-user/multi-agent coding system, stress testing and failure analysis, and a GCP deployment. T3 reuse is optional. Sharing a filesystem inside a conversation thread is explicitly allowed.

A useful minimum demonstration is:

1. Alice and Bob open the same application thread from separate clients.
2. Alice asks agent A to modify a file. Bob asks agent B to inspect the project while A is still working.
3. Both clients see both agents' progress, author attribution, queued messages, and final results.
4. Bob queues another request to A, or steers A at its next supported boundary.
5. One client disconnects and returns without losing committed messages.
6. The service process restarts; stored conversations remain available and unfinished work has an explicit recovery outcome.
7. A load script produces measurements and exposes at least one capacity limit.

Two named agents backed by the same model/provider still demonstrate multi-agent concurrency. Multiple model providers are a separate dimension. Do not spend the assignment building a provider catalog unless the evaluator explicitly requires it.

The phrase “framework-dependent” needs an early interpretation decision: does the evaluator expect removal of Chord/Effect dependencies, or a service that consumers can use without learning those frameworks? Those are materially different deliverables. The plan addresses both; the recommended fast path achieves the latter.

## 2. What Pi Durable already does

Start with [Durable's README](packages/durable/README.md). This checkout is more capable than the assignment's wording might suggest.

| Existing mechanism | Why it matters here | What the application still supplies |
| --- | --- | --- |
| Durable submissions and `requestId` deduplication | Retrying a network request need not start another run | Authenticated caller identity, request scoping, and rejection of conflicting reused IDs |
| Busy-conversation inbox | Another person can submit while an agent runs | UI choices and policy for follow-up versus steering |
| Per-conversation agent configuration | Different conversations can run different agents/models | Mapping several agent conversations into one shared application thread |
| Foreground/background subagent examples | Multi-agent orchestration is already possible | User-addressable peers, shared visibility, and ownership semantics |
| Watches, transcript windows, and history paging | Late viewers can attach to ongoing work | Network transport, reconnect behavior, and slow-client limits |
| SQLite and task recovery | Stored work can survive a process restart | A single owner process, supervision, persistent storage, and a verified recovery policy |
| Input entry metadata | User inputs can record an author without inventing another message store | Trustworthy author IDs, membership checks, and rendering |
| Coding tools and an execution environment | Agents can read, edit, write, and execute commands | Workspace placement, isolation policy, and concurrency limits |

Do not present inboxes, subagents, or late joining as features absent from Pi. The gap is a coherent collaborative application around those mechanisms, and potentially a less coupled runtime.

## 3. Learn the Durable execution model

The useful vocabulary is:

- **Harness:** an open storage and the machinery that runs agents against it.
- **Conversation:** an immutable transcript plus associated state. In the proposed design, one conversation is one agent's history, not the whole shared room.
- **Submission:** accepted input whose answer or failure can be observed later.
- **Run:** work from input through the eventual answer; it can contain several model/tool rounds.
- **Task:** checkpointed work that can be recovered after restart.
- **Document:** application or runtime JSON state changed in commits.
- **Commit:** an atomic state change. Do not keep database transactions open during model calls or shell execution.

Trace one request:

```text
Alice's authenticated HTTP command
  -> membership and target checks
  -> commit a submission with author metadata
  -> generation task calls model outside the commit
  -> tool tasks execute against the thread workspace
  -> tool results and answer are committed
  -> watchers update Alice and Bob
```

Committing intent before executing work makes accepted commands recoverable. It does **not** make arbitrary shell effects execute exactly once. If a command changes a file and the process dies before recording its result, the application cannot infer from a missing result that the effect never happened.

Read these examples in order; most use the faux provider and do not require paid model calls:

| Priority | File | Question it answers |
| --- | --- | --- |
| 1 | [25-coding-agent.ts](packages/durable/test/examples/25-coding-agent.ts) | How do registry, coding tools, model, settings, and working directory fit together? |
| 2 | [19-inbox.ts](packages/durable/test/examples/19-inbox.ts) | What happens when several people submit to a busy agent? |
| 3 | [20-late-join.ts](packages/durable/test/examples/20-late-join.ts) | What does a viewer receive when joining mid-run? |
| 4 | [07-harness-conversations.ts](packages/durable/test/examples/07-harness-conversations.ts) | How do we create independent agent conversations and find them later? |
| 5 | [34-submit-in-commit.ts](packages/durable/test/examples/34-submit-in-commit.ts) | How can application checks and submission admission share one transaction? |
| 6 | [12-recovery.ts](packages/durable/test/examples/12-recovery.ts) | How does reopening stored task state work? |
| Later | [31-transcript.ts](packages/durable/test/examples/31-transcript.ts) | How do clients handle transcript windows, missed history, and paging? |
| Optional | [22-subagent-background.ts](packages/durable/test/examples/22-subagent-background.ts) | How can agent-owned background helpers message and survive parent activity? |

Important API constraint: `submit(tx, draft)` is admitted **once per commit**, before table writes such as `appendEntry()` or `createTask()`. Document reads and writes can surround it. Do not design an atomic “broadcast to every agent” command around several admissions in one commit. Explicitly targeted commands avoid this extra problem.

`Submission.wait()` reaching an answer and a conversation becoming idle are also distinct: `afterRun` tasks can still be running. A presentation should not equate “answer received” with “all associated work finished.”

## 4. Know where to look when implementation gets difficult

Read these files when changing the corresponding behavior; there is no need to learn all of Chord to write the service.

| Concern | Pi source entry points | What to establish before changing anything |
| --- | --- | --- |
| Public API and metadata | [index.ts](packages/durable/src/index.ts), [harness/types.ts](packages/durable/src/harness/types.ts) | Actual exports, submission shape, input entry metadata, and tool replay policy |
| Admission and ordering | [harness/submissions.ts](packages/durable/src/harness/submissions.ts), [harness/inbox.ts](packages/durable/src/harness/inbox.ts) | When inputs enter model context and when they settle |
| Ownership and execution | [harness/scheduler.ts](packages/durable/src/harness/scheduler.ts), [harness/generation.ts](packages/durable/src/harness/generation.ts) | What serializes within a conversation versus runs concurrently across conversations |
| Storage publication | [session/writer.ts](packages/durable/src/session/writer.ts) | Writes are batched and published in order; this is a potential contention point |
| Durable Node storage | [storage/sqlite/node.ts](packages/durable/src/storage/sqlite/node.ts), [Chord SQLite adapter](packages/chord/src/sqlite/node.ts) | One owner per storage, SQLite settings, and synchronous database work behind async APIs |
| Tool execution | [env/node.ts](packages/durable/src/env/node.ts), [tools/bash.ts](packages/durable/src/tools/bash.ts) | Process cancellation, environment inheritance, timeouts, output retention |
| Concurrent edits | [tools/file-mutation-queue.ts](packages/durable/src/tools/file-mutation-queue.ts) | Built-in edit/write serialization is local to this process and does not cover shell writes |

Durable explicitly requires one owning process per storage and supplies no cross-process ownership lock. Two replicas opening the same SQLite file are not a supported scaling strategy.

Its documented SQLite defaults use WAL with `synchronous = NORMAL`: committed state survives process crashes, but the newest commits may be lost on power/host failure. Describe the demonstrated guarantee as **process-restart durability**, unless you implement and validate something stronger.

## 5. Shared filesystem does not mean conflict-free editing

Example: A and B read `config.ts` at revision 1. A writes revision 2. B writes its whole-file replacement based on revision 1. Serializing the two writes still permits B to erase A's change.

Durable's mutation queue prevents overlapping built-in `edit`/`write` operations against the same canonical file within one process. It does not provide stale-read detection or coordinate `bash`, an external CLI, or a human editor.

For the assignment, preserve one workspace per application thread, demonstrate agents working on different files, and explicitly document same-file conflicts. If adding stronger behavior, compare an expected content hash with the current file **inside the same mutation lock** before writing. That only protects calls using that path; it is not a guarantee against arbitrary shell writers.

A working directory is also not a security boundary. The Pi README says agents run with the launching process's permissions. Trusted collaborators on a disposable demo project are a reasonable proof-of-concept assumption. Hostile tenants need enforced filesystem/process/credential isolation, which is a separate project.

## 6. What to borrow from T3 Code

Start at [T3 architecture](../t3code/docs/internals/overview.md). T3 keeps execution and credentials on the server that owns the workspace; clients send commands and consume projections. A **projection** is stored state shaped for clients to read.

| T3 location | Relevant lesson | Reuse cost |
| --- | --- | --- |
| [ProviderAdapter.ts](../t3code/packages/provider-core/src/server/ProviderAdapter.ts) | Separate app IDs from provider IDs; model start, steer, interrupt, events, and capabilities explicitly | Large Effect-based contract importing T3 domain schemas |
| [driver.ts](../t3code/packages/provider-core/src/server/driver.ts) | Distinguish a provider implementation from a configured instance/session | Framework and configuration dependencies |
| [Pi RPC transport](../t3code/packages/provider-pi/src/server/rpc.ts) | Frame subprocess output, correlate replies, fail pending requests on exit, and clean up process trees | Effect, host-process helpers, and provider-core dependencies |
| [Pi adapter](../t3code/packages/provider-pi/src/server/adapter.ts) | Normalize a CLI harness into application events | Substantial lifecycle logic; inspect the full file and imports before copying |
| [ThreadStream.ts](../t3code/apps/server/src/orchestration-v2/ThreadStream.ts) | Bound replay by count and bytes; replace excessive replay with a snapshot | Snapshot helpers depend on the T3 projection schema |
| [EventSink.ts](../t3code/apps/server/src/orchestration-v2/EventSink.ts), [EffectWorker.ts](../t3code/apps/server/src/orchestration-v2/EffectWorker.ts) | Commit intended effects, then execute them outside the transaction | A useful reference if replacing Durable, not a small standalone library |
| [Provider testing package](../t3code/packages/provider-testing) and [orchestration testkit](../t3code/apps/server/src/orchestration-v2/testkit) | Use deterministic/replayed provider behavior for concurrency and failures | Learn the method before adopting the whole harness |

An **outbox** is a durable list of intended external actions committed with application state. A worker executes those actions later. T3's architecture overview describes an implemented outbox, although the orchestration-v2 README still discusses it as follow-up work. Treat design documents as orientation; verify behavior against current code before relying on it.

The current T3 adapters are not framework-free drop-ins or independently published packages: `provider-core` and `provider-pi` are private workspace packages. Copying one adapter can pull in contracts, shared helpers, and Effect. Time-box any extraction experiment; direct reuse can cost more than a small interface around Durable.

If copying T3 implementation code, preserve the copyright and MIT license notice from [LICENSE](../t3code/LICENSE), and record the source commit and copied paths. Do not copy the desktop/mobile application to get provider support.

## 7. Budget your learning and presentation

Spend about **two hours** on initial reading and the first running spike, not a day studying the monorepos. Prioritize the first six examples above and the T3 architecture overview. Skip Chord internals, frontend frameworks, mobile/desktop, MCP apps, provider switching, fork/merge, and automatic delegation until a working deployed slice exists.

Before presenting, be able to answer:

| Question | Your answer should distinguish |
| --- | --- |
| What is new? | Collaborative identity/routing/visibility and deployment versus Durable's existing primitives |
| Can two agents really run simultaneously? | Independent agent conversations versus queued turns within one agent |
| What does an acknowledgement guarantee? | Durable admission versus completed model/tool work |
| What survives a crash? | Committed state versus transient progress and uncertain external effects |
| What happens when clients reconnect? | Snapshot/history recovery versus starting another agent run |
| Where does the system fail first? | Measured limits versus predicted VM, storage, provider, and filesystem bottlenecks |
| How would it scale? | Assign threads to exclusive workers before attempting multiple owners of the same thread |
| Did you remove framework dependence? | Plain service interface versus the dependencies still retained inside the runtime |

Prepare a short demo trace and a table of actual stress-test results. An explicit limitation with a reproducible failure test is stronger evidence than an unsupported claim of production readiness.
