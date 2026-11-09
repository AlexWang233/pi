# Questions about crashes and repeated work

These questions ask what survives a failure and what might happen again after recovery. Whenever an interviewer says “execution,” name the particular action—accepting an instruction, sending a model request or performing a tool effect—before answering.

The [durability overview](../03-durability-and-recovery.md) explains the underlying state machine. The concrete traces here help prevent an overly broad “exactly once” or “crash safe” claim.

## If one instruction is accepted, could recovery call the model twice or write the file twice?

Accepting one command does not mean every later action triggered by it can happen only once. A native model request can repeat after interruption, and arbitrary filesystem effects do not have a universal exactly-once guarantee.

Suppose Alice submits `append hello`, the command is saved, the file is changed, and the host dies before saving the result. The saved command receipt proves that the instruction was accepted, but not whether the append happened. Automatically starting the whole instruction again could append a second `hello`. The current policies distinguish native model recovery, declared tool replay safety and conservative external interruption; inspect the action boundary before making any guarantee. See [the short worked answer](../08-interview-drills.md#if-a-user-submits-one-instruction-can-the-model-call-or-file-write-happen-twice).

| Action | What the prototype establishes |
| --- | --- |
| Re-admitting the same user/agent/ID/text | Existing receipt is reused |
| Repeating a native provider request after recovery | Possible, even with one receipt |
| Rerunning a declared unsafe tool after uncertain execution | Not automatically replayed under the tool's recovery policy |
| Repeating arbitrary shell/file effects | No general exactly-once claim |
| Automatically resending an uncertain external turn | Avoided; interruption is reported |

## Why save the external dispatch marker before sending to Codex, even though a crash could then abandon unsent work?

Saving the marker before send gives recovery a durable reason not to blindly send again after an uncertain attempt. The cost is a possible interrupted command that never reached Codex at all.

Moving the marker after send changes the dangerous gap: the provider could start editing, the host could die before storing the marker, and recovery could wrongly treat the command as never sent. The chosen policy prefers explicit uncertainty over duplicate external effects. It is not a distributed transaction with Codex, and a request ID in our database does not automatically deduplicate that external system. See [the dispatch timeline](../03-durability-and-recovery.md#why-uncertain-external-turns-are-not-automatically-resent).

## How can a Durable task be completed while the user's command is failed or interrupted?

The task records whether its orchestration state machine finished, while the command records the user-facing outcome of the requested work. An external task can successfully finish recording a failed, stopped or interrupted command.

In the external implementation, settlement persists the command outcome and can complete the Durable task with a small result. It does not mean Codex successfully implemented the user's request. Conversely, a scheduler-level terminal task with missing command settlement can make the public command derive `interrupted` rather than remain running forever. Naming the two state machines prevents misleading UI and capacity accounting. See [external settlement](../../packages/durable/src/collaboration/external.ts) and [status reconciliation](../03-durability-and-recovery.md#status-reconciliation-without-inventing-history).

## The database throws during acceptance: can the client safely assume nothing happened?

No, because a storage call may commit successfully and then fail before acknowledging success. The client must preserve the original command ID/text rather than submit the same intention under a fresh identity.

For example, SQLite persists the receipt, an injected error makes the caller observe failure, and the whole Harness becomes unavailable. After old-owner shutdown and reopen, the original-ID retry can find the existing receipt. Failing the whole Harness protects a consistent view of shared storage; continuing peer lanes on uncertain storage state would be a stronger and unsupported failure model. See [storage uncertainty](../03-durability-and-recovery.md#an-exception-is-not-proof-that-storage-rejected-the-write) and [boundary tests](../../packages/durable/test/collaboration-boundaries.test.ts).

## If a turn has a timeout, why might shutdown still take longer than that timeout?

A timeout signals cancellation; it does not necessarily terminate arbitrary code or all descendant processes at that instant. Cleanup can continue after that signal, and non-cooperative code can keep a graceful close pending.

For example, the parent can receive an interrupt while a spawned shell child keeps writing. The Codex bridge waits for a bounded interrupt exchange and its spawner requests escalation, but those mechanisms are not a hard end-to-end containment certificate. The existing Windows Bash delay and unverified real/escaped descendants remain limits. A replacement owner must wait for verified termination rather than treating an elapsed deadline as permission to reuse the workspace. See [the process boundary](../03-durability-and-recovery.md#stop-graceful-close-and-process-death).

## Does a successful graceful restart test prove the system survives a power failure?

A graceful restart and abrupt power loss exercise different persistence and cleanup boundaries. A clean close can flush state and wait for work, while power loss can remove buffered writes and prevent any cleanup.

The local browser check establishes idle close/reopen with retained files and receipts, and separate SQLite owner-kill tests establish selected process-crash boundaries. Neither proves every storage device, filesystem or power-loss path behaves safely. Workspace effects also remain separate from the database's durability. A deployment claim needs its own storage-policy, backup/restore and failure evidence rather than a stronger interpretation of an existing restart demo. See [evidence levels](../07-evidence-scaling-and-deployment.md#what-different-tests-establish).
