# Durability, external effects and recovery

Durability means recoverable committed state and explicit handling of interrupted work, not that every process or side effect survives safely. The strongest interview explanation uses a crash timeline and states exactly what can be repeated or lost.

The core [specification](../packages/durable/docs/spec.md) defines existing runtime rules, while the [collaboration addendum](../packages/durable/docs/collaboration.md#recovery-and-external-effects) describes the fork's policies and tested boundaries. SQLite records and workspace bytes remain separate persistence domains.

## What the atomic transaction actually covers

A Session transaction can atomically persist records, documents and executable intent. It does not atomically include model requests, shell commands or ordinary filesystem writes.

For example, acceptance of a command can commit its receipt and task together, so recovery does not find a receipt with no admitted work. A later file write may succeed before recording its outcome fails. The database can remain consistent while the filesystem effect is uncertain; solving that requires effect-specific coordination, not a larger SQLite transaction held over external work. Never wait for a model, process or human while holding the Session mutation line.

## Tasks are persistent state machines

Durable tasks record their state and checkpoint so the scheduler can resume, wait, abort or terminalize them after interruption. This is why external commands can be integrated without a new in-memory job queue.

The core scheduler distinguishes states such as pending, running, waiting, sleeping, completing and terminal. The collaboration command's queued/running/completed/failed/interrupted/stopped labels are a separate projection for users. External tasks use the existing predecessor wait and durable memos; native generation uses its existing request/tool phases. A provider session is still external process/provider state, not the task record itself. [Task API](../packages/durable/src/tasks.ts), [external task](../packages/durable/src/collaboration/external.ts).

## What is stored and what is reconstructed

Persistent state includes transcript entries, submission/task records and versioned documents, while browser and lane projections are reconstructed from that state. A saved continuation identifies an external provider thread; it is not a serialized running process.

Immutable entries preserve history, task checkpoints preserve execution intent/state, and documents hold configuration, inbox/live state and collaboration metadata. Chord operations plus occasional document bases support materialization without requiring the browser to replay every token. Compaction preserves raw entries while changing model context. This is not a claim that the entire application is a pure event-sourced log: current task/document state is authoritative too, and transport snapshots are explicitly not an audit journal. [Core records and storage](../packages/durable/docs/spec.md#2-core-records).

## Why uncertain external turns are not automatically resent

The external task persists a dispatch marker before opening or sending to its driver. Recovery that encounters an uncertain dispatched attempt reports interruption instead of sending it again.

Consider an agent that appends to a file and then crashes before committing success. Blind resend could append twice, so the implementation sacrifices availability rather than guessing that the first attempt did nothing. There is also a conservative false interruption: a crash after the marker but before send can abandon work that never reached the provider. The marker is an intent boundary, not a receipt from Codex and not an exactly-once protocol.

| Crash boundary | Expected interpretation |
| --- | --- |
| Before admission is persisted | No accepted work survives; original-ID retry can admit it |
| Admission persisted, response lost | Receipt survives; original-ID retry finds it |
| Dispatch marker persisted, outcome absent | External work is interrupted without automatic resend |
| File effect occurred, result not committed | Effect may remain; inspect before a new instruction |
| Result committed before crash | Completed outcome remains; retry does not execute again |

## Native recovery is intentionally different

Native generation keeps Durable's existing recovery policies, so one accepted command can span more than one model request. Unsafe tools are not automatically replayed after uncertain execution according to their declared recovery policy.

Forced-kill tests demonstrate one receipt with a repeated native request, and a declared unsafe append tool whose file effect remains once after recovery. These establish specific boundaries, not a universal guarantee for arbitrary tools or shells. Admission deduplication, provider request count and effect count must therefore be measured separately. A model retry may incur another request even though the user did not submit twice. [Boundary tests](../packages/durable/test/collaboration-boundaries.test.ts).

## An exception is not proof that storage rejected the write

A storage call can make a commit durable and then throw before its caller receives success. Durable treats a storage failure as fatal to the whole open Session/Harness, including peer lanes.

The host must retain the original retry identity, finish stopping the old owner and reopen against whatever persisted. Automatic retry of the failed method on the same failed Harness cannot repair it. The demo exits on Harness failure and does not automatically reopen or start another writer. This favors inspectable recovery over availability when the outcome is uncertain. [Failure contract](../packages/durable/docs/spec.md#101-failures), [host lifetime](../apps/collab-demo/src/lifetime.ts).

## Status reconciliation without inventing history

An external task can become terminal before collaboration metadata records its final outcome. Public status derives an interruption from that terminal task rather than leaving the command running forever.

Metadata and task are read on the same transaction line, avoiding a false interruption caused by ordinary completion between two independent reads. The derived status also frees pending capacity and suppresses stale progress. It does not rewrite raw metadata, fabricate an outcome entry or fix a nonterminal task blocked by missing code or migration. This is a useful example of distinguishing authoritative underlying state from its display projection. [State interpretation](../packages/durable/src/collaboration/state.ts), [recovery tests](../packages/durable/test/collaboration-recovery.test.ts).

## Stop, graceful close and process death

Cooperative cancellation, graceful Harness close, forced owner death and host/power loss are different failure modes. Completing an interrupt exchange or observing a parent PID disappear does not prove every former workspace writer stopped.

The Codex adapter bounds its interrupt exchange and requests forced-kill escalation through its process spawner. Scripted Windows attached-descendant tests exist, but real CLI descendants, escaped processes and Linux containment remain unverified. An existing Windows native Bash recovery case takes roughly thirty seconds; the user deferred its investigation, and raising a test runner limit was not a fix. Replacement ownership is safe only after prior writers are actually terminated. [Process evidence and limits](../packages/durable/docs/collaboration.md#t3-and-known-limitations).

## Compaction and progress persistence

Compaction changes the model's active context by adding a summary/head marker; it does not erase raw transcript history. Progress publication may also have weaker durability than terminal outcomes under the core deferred-commit policy.

Native `pi.live` progress can be shown from a held eligible conversation-document commit before storage catches up, so a crash may lose recent progress. External collaboration progress currently updates a session document, which is ineligible for holding and is stored immediately despite requesting deferred persistence. That distinction matters for write cost and explains why a `withinMs` option alone is not evidence of batching. Compaction itself can make additional model requests, which is why the deterministic one-response load workload disables automatic compaction only in its own composition. [Core rules](../packages/durable/docs/spec.md#41-deferred-commits).
