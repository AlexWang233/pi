# Shared files and conflict resolution

The shared filesystem makes agent collaboration useful, but it creates races outside the database's transaction boundary. The project deliberately separates ordinary concurrent writes from the opt-in managed-file mechanism that detects stale cooperative proposals.

This distinction is essential to an honest presentation: the current live OpenAI/Ollama tools do not automatically use managed publication. Read the [managed-file contract](../packages/durable/docs/managed-files.md) and [conflict proposal](../apps/collab-demo/CONFLICT_RESOLUTION_PROPOSAL.md) before promising stronger behavior.

## The lost-update example to remember

Two agents can read the same original file and then publish independent replacements, causing the later write to erase the earlier one. Both commands can complete successfully while the combined user intent is lost.

For example, A and B read `base`; A writes `base + alice`, then B writes its stale `base + bob`. The final file no longer contains Alice's change. The [concurrency test](../apps/collab-demo/test/concurrency.test.ts) uses explicit barriers to force this ordering, so the result does not depend on prompt speed. Real uncontrolled writes can also fail or leave partial/interleaved effects; clean last-writer-wins is not a universal filesystem guarantee.

## Why the existing native mutation gate is insufficient

Native edit/write tools coordinate an individual mutation within the process using filesystem identity and canonical path. They do not hold ownership across an agent's entire earlier read, planning and later write, or include arbitrary external writers.

The problematic gap is `read → model thinks → write`, not just two write syscalls happening together. Even if A and B's final mutation calls execute sequentially, B may still propose content based on the old read. Shell commands, Codex, editors and other processes bypass that gate. Some native edits may fail because their expected text no longer matches, but that is not a general workspace conflict protocol. [Core file-tool contract](../packages/durable/docs/spec.md#73-tools).

## Managed publication and optimistic concurrency control

Optimistic concurrency control allows participants to prepare changes concurrently and validates that their base is still current before publication. The managed-file API retains base, current and proposed content, rejects stale proposals, and preserves evidence for resolution.

Both users first retain `base`; Alice's proposal applies, while Bob's later proposal finds the destination changed and records a conflict without overwriting it. This slice compares exact bounded UTF-8 content and existence rather than hashes or monotonic revision numbers, keeping the experiment small and reviewable. It does not detect a file changing away and back to identical content. Protection assumes all relevant writers participate and one owner coordinates publication. [Implementation](../packages/durable/src/collaboration/managed-file.ts).

## Conflict resolution is explicit, not automatic merging

A rejected proposal preserves work but does not decide what the correct combined change should be. Resolution uses a fresh retained read and a new proposal identity based on the current file.

The runnable example publishes `base + alice`, retains Bob's conflicting `base + bob`, then explicitly proposes `base + alice + bob`. That final combined content is constructed by the example, not inferred by a merge engine or LLM. Reusing the old read ID returns its old retained base, and reusing a proposal ID returns its recorded result, so new identities are necessary for a new resolution attempt. [Example 41](../packages/durable/test/examples/41-managed-file-conflict.ts).

## Managed-file recovery also favors safety over availability

Managed publication persists intent before filesystem I/O, then records the outcome afterward. If the effect or its settlement becomes uncertain, new managed operations are blocked instead of blindly retrying writes.

The states are `prepared`, `applied`, `conflict` and `uncertain`; an unsettled prepared intent can mean the write never happened or already happened. A filesystem write and its metadata commit are not one atomic transaction, and the current write can be partial. The slice has no automatic reconcile/unblock, force-apply or rollback API, so inspection is required with writers stopped. Its bounds—one root-level text file, 16 KiB, 64 retained reads and 32 proposals—define a focused prototype rather than universal file management. [Failure contract](../packages/durable/docs/managed-files.md#failure-and-recovery-policy).

## What the database analogy teaches

The closest database concepts are lost updates, conditional writes and pessimistic ownership. A database transaction around command admission cannot by itself protect a file modified later by a subprocess.

A database-style conditional update succeeds only while a row's revision still equals the read revision; the managed-file API applies a similar validation idea to retained content. Whole-turn workspace ownership is closer to pessimistic locking: one participating turn holds access from reading through completion and verified descendant cleanup. That is simpler for unrestricted harnesses but reduces concurrency and must include every writer. Multi-file changes add read dependencies and partial-publication recovery, so validating one destination is not serializable execution of an entire coding task.

## What Git contributes and what it does not

Worktrees isolate edits, checkpoints preserve reviewable history, and three-way merges can produce integration candidates from a common base. None automatically decides conflicting human requirements or makes a shared raw workspace safe.

Per-agent worktrees are a valid alternative, but agents would stop immediately seeing each other's unmerged edits, changing the assignment's current shared-workspace experience. Checkpoint restore must respect ownership and partial work; blindly resetting or stashing/popping a shared repository can destroy or misattribute another agent's changes. The local T3 review found useful worktree/checkpoint/restore patterns, but its inspected workspace lease is released before the provider turn and is not a whole-turn lock. T3 prompt stashing concerns drafts, not agent filesystem edits. [Source-backed T3 review](../apps/collab-demo/CONFLICT_RESOLUTION_PROPOSAL.md#what-the-local-t3-code-implementation-actually-provides).

## How to demonstrate the race reliably

Use controlled execution boundaries so both participants finish reading before either write is released. Present the unprotected lost update beside the protected stale rejection, with explicit resolution as a separate step.

Example 41 already demonstrates the protected package API on real temporary files without a server or model. A proposed GUI scenario panel would expose Prepare, Publish A, Publish B and Resolve controls with base/current/proposed views. That panel is not implemented yet, and deterministic drivers must be labelled as scripted execution. Integrating real model-facing managed tools would additionally require trusted actor/command binding and restrictions preventing bypass through ordinary writes or shell commands.
