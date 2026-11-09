# Durability, external effects and recovery

Durability means saved requests and results can be recovered after a restart. It does not mean an interrupted model call or file change can always be safely repeated.

The core [specification](../packages/durable/docs/spec.md) defines existing runtime rules, while the [collaboration addendum](../packages/durable/docs/collaboration.md#recovery-and-external-effects) describes the fork's policies and tested boundaries. SQLite records and workspace bytes are saved separately. For definitions and a crash diagram, see [side effects and dispatch markers](09-technical-terms.md#side-effects-checkpoints-and-dispatch-markers), [state machines](09-technical-terms.md#state-machines-terminal-states-and-reconciliation), and [atomic commits](09-technical-terms.md#atomic-commit-durability-and-the-mutation-line).

## What the atomic transaction actually covers

Durable can save a request and the information needed to run it together, so both are recorded or neither is. It cannot make a later OpenAI request or file write part of that same database operation.

This all-or-nothing saving is an **atomic transaction**. For example, a file write may finish just before the process crashes while saving its result; the database can be internally consistent even though we do not know whether the external change happened. Making the database wait throughout the model call would not remove that gap. We therefore need recovery rules for the particular operation, rather than treating a database transaction as protection for every external action.

## Tasks are persistent state machines

A Durable task is work with a saved record of which step it has reached. After a restart, the runtime can inspect that record and decide whether to continue, wait, or stop instead of relying on a queue that existed only in memory.

The technical name is a **persistent state machine**: allowed steps and saved states guide what happens next. Durable's task states include pending, running, waiting, and terminal (finished), whereas the user's command has its own outcome such as completed or interrupted. External-agent work saves progress markers and can wait for earlier tasks; native generation has its own model/tool phases. A saved task is not a saved copy of a running Codex process. See [task API](../packages/durable/src/tasks.ts) and [external task](../packages/durable/src/collaboration/external.ts).

## What is stored and what is reconstructed

Durable stores conversation messages, work records, and configuration; the browser's display is built from those records. Saving an external conversation ID lets later work refer to that conversation, but does not keep a process alive.

The display built from saved data is called a **projection**. Transcript entries preserve messages; task checkpoints record progress through work; structured documents hold configuration, inbox state, and collaboration metadata. Chord records changes to those documents so their current values can be rebuilt. There is no single browser event log that contains every authoritative fact, and shortening a model's active context does not erase the raw conversation history. See [core records and storage](../packages/durable/docs/spec.md#2-core-records).

## Why uncertain external turns are not automatically resent

Before trying Codex work, the system saves a note that it is about to send it. If the host crashes and cannot establish the outcome, recovery marks that work interrupted rather than risking another file change by sending it again.

That note is the **dispatch marker**. Suppose Codex appends `hello` and the host dies before saving success: blindly sending again could append twice. Saving the marker before send also has a cost: a crash between the marker and the actual send can interrupt work that never started. The chosen trade-off avoids automatic duplicate effects at the expense of sometimes requiring inspection and a new user instruction; the marker is not proof that Codex received anything.

| Crash boundary | Expected interpretation |
| --- | --- |
| Before admission is persisted | No accepted work survives; original-ID retry can admit it |
| Admission persisted, response lost | Receipt survives; original-ID retry finds it |
| Dispatch marker persisted, outcome absent | External work is interrupted without automatic resend |
| File effect occurred, result not committed | Effect may remain; inspect before a new instruction |
| Result committed before crash | Completed outcome remains; retry does not execute again |

## Native recovery is intentionally different

Pi's own agents keep Durable's existing recovery rules, which can repeat a model request after a crash even though the user's instruction was saved only once. Tools declared unsafe to repeat are not automatically rerun when their earlier outcome is uncertain.

Forced-kill tests demonstrate one receipt with a repeated native request, and a declared unsafe append tool whose file effect remains once after recovery. These establish specific boundaries, not a universal guarantee for arbitrary tools or shells. Admission deduplication, provider request count and effect count must therefore be measured separately. A model retry may incur another request even though the user did not submit twice. [Boundary tests](../packages/durable/test/collaboration-boundaries.test.ts).

## An exception is not proof that storage rejected the write

A save can reach the database even if the caller then receives an error instead of confirmation. The runtime stops using that open store after a storage failure, so recovery can inspect what really survived.

The host must retain the original retry identity, finish stopping the old owner and reopen against whatever persisted. Automatic retry of the failed method on the same failed Harness cannot repair it. The demo exits on Harness failure and does not automatically reopen or start another writer. This favors inspectable recovery over availability when the outcome is uncertain. [Failure contract](../packages/durable/docs/spec.md#101-failures), [host lifetime](../apps/collab-demo/src/lifetime.ts).

## Status reconciliation without inventing history

A background task can finish before the user's command record is updated with its outcome. When that happens, the public view reports the command as interrupted rather than showing it as running forever.

The runtime reads the task and command metadata together, so it does not mistakenly report interruption because normal completion happened between two separate reads. This **reconciliation** means interpreting the underlying saved facts consistently for the display; it does not invent a successful result or rewrite the original records. It also frees pending capacity and hides outdated progress. It cannot repair every unfinished task, such as one blocked by missing code. See [state interpretation](../packages/durable/src/collaboration/state.ts) and [recovery tests](../packages/durable/test/collaboration-recovery.test.ts).

## Stop, graceful close and process death

Asking an agent to stop, closing the server cleanly, and killing the process are different events. Even if the main process stops, a shell it launched might still be changing files, so starting a replacement safely requires checking those writers too.

The Codex adapter bounds its interrupt exchange and requests forced-kill escalation through its process spawner. Scripted Windows attached-descendant tests exist, but real CLI descendants, escaped processes and Linux containment remain unverified. An existing Windows native Bash recovery case takes roughly thirty seconds; the user deferred its investigation, and raising a test runner limit was not a fix. Replacement ownership is safe only after prior writers are actually terminated. [Process evidence and limits](../packages/durable/docs/collaboration.md#t3-and-known-limitations).

## Compaction and progress persistence

A long conversation can be summarized to reduce what the model must read, while the original messages remain stored. Some live progress can appear before it is fully saved, so a crash may lose recent progress without losing an already saved final result.

Conversation summarization is called **compaction**. Native `pi.live` updates can use **deferred commits**, where the runtime briefly delays eligible storage writes; current external progress uses a session document that is stored immediately instead. This matters when measuring storage cost: requesting a delay does not prove writes were combined. Compaction can itself make model requests, so the simple simulated load workload disables it only in that test setup. See [deferred-commit rules](../packages/durable/docs/spec.md#41-deferred-commits).
