# Shared files and conflict resolution

When two agents share a project folder, one can overwrite changes the other just made. We built a separate, opt-in file API that detects certain outdated edits, but ordinary OpenAI/Ollama and Codex writes do not use it yet.

This distinction is essential to an honest presentation: the current live OpenAI/Ollama tools do not automatically use managed publication. Read the [managed-file contract](../packages/durable/docs/managed-files.md) and [conflict proposal](../apps/collab-demo/CONFLICT_RESOLUTION_PROPOSAL.md) before promising stronger behavior. The glossary explains [stale context and optimistic concurrency](09-technical-terms.md#lost-updates-stale-context-and-optimistic-concurrency), [base/current/proposed](09-technical-terms.md#base-current-proposed-and-three-way-merge), and [locks, leases, and fencing](09-technical-terms.md#locks-ownership-leases-and-fencing).

## The lost-update example to remember

Both agents read the same old file before either changes it. Alice's agent saves her change first, then Bob's agent replaces the file using its old copy and removes Alice's change.

This is a **lost update**: both commands can report success while the final file omits one person's work. For example, A and B read `base`; A writes `base + alice`, then B writes `base + bob`, leaving no `alice`. The [concurrency test](../apps/collab-demo/test/concurrency.test.ts) pauses the two agents at known points to force this ordering. This is a clean example; unrestricted real writes can also fail or leave partial content rather than always producing a neat last-writer-wins result.

```mermaid
sequenceDiagram
  participant A as Alice's agent
  participant F as Shared file
  participant B as Bob's agent
  A->>F: Read
  F-->>A: base
  B->>F: Read
  F-->>B: base
  A->>F: Replace with base + alice
  B->>F: Replace with base + bob
  Note over A,B: Alice's change is gone; both commands can finish
```

The writes took turns, but Bob's earlier read was still outdated. Compare this with the [managed-file diagram](09-technical-terms.md#base-current-proposed-and-three-way-merge), where Bob's second write is rejected and retained for review.

## Why the existing native mutation gate is insufficient

Pi's built-in write tools coordinate certain individual writes, but an agent may have read the file long before it writes. Taking turns during the final write cannot make that earlier copy up to date, and shell commands or external agents can bypass the tool's coordination.

The problematic gap is `read → model thinks → write`, not just two write syscalls happening together. Even if A and B's final mutation calls execute sequentially, B may still propose content based on the old read. Shell commands, Codex, editors and other processes bypass that gate. Some native edits may fail because their expected text no longer matches, but that is not a general workspace conflict protocol. [Core file-tool contract](../packages/durable/docs/spec.md#73-tools).

## Managed publication and optimistic concurrency control

The managed-file API asks each participant to keep the original content it read and submit its edit as a proposal. Before applying it, the API checks whether the file still matches that original; if someone changed it, the proposal is kept as a conflict instead of overwriting their work.

This is **optimistic concurrency control**: let work be prepared independently, then check assumptions before saving. The API keeps **base** (what Bob originally read), **current** (what is now on disk), and **proposed** (what Bob wants to write). It compares exact bounded UTF-8 text and whether the file exists, rather than a hash or increasing revision number. A change away from and back to identical content is not detected. Every relevant writer must participate, and one owner must coordinate publication; ordinary shell/editor writes can bypass the rule. See [implementation](../packages/durable/src/collaboration/managed-file.ts).

## Conflict resolution is explicit, not automatic merging

Rejecting Bob's outdated edit prevents it from erasing Alice's work, but does not combine their changes automatically. Someone must read the current file, decide the right combined content, and submit a new proposal.

The runnable example publishes `base + alice`, retains Bob's conflicting `base + bob`, then explicitly proposes `base + alice + bob`. That final combined content is constructed by the example, not inferred by a merge engine or LLM. Reusing the old read ID returns its old retained base, and reusing a proposal ID returns its recorded result, so new identities are necessary for a new resolution attempt. [Example 41](../packages/durable/test/examples/41-managed-file-conflict.ts).

## Managed-file recovery also favors safety over availability

The managed API saves its intention before touching the file and saves the result afterward. If a crash leaves it unsure whether the write happened, it blocks further managed operations until the situation is inspected, rather than guessing and writing again.

The states are `prepared`, `applied`, `conflict` and `uncertain`; an unsettled prepared intent can mean the write never happened or already happened. A filesystem write and its metadata commit are not one atomic transaction, and the current write can be partial. The slice has no automatic reconcile/unblock, force-apply or rollback API, so inspection is required with writers stopped. Its bounds—one root-level text file, 16 KiB, 64 retained reads and 32 proposals—define a focused prototype rather than universal file management. [Failure contract](../packages/durable/docs/managed-files.md#failure-and-recovery-policy).

## What the database analogy teaches

A database can reject an update if the row changed since you read it; the managed-file API uses the same basic idea with file content. Another option is to give one agent exclusive use of the workspace for its whole instruction, which is simpler but makes other agents wait.

The first approach is a **conditional update**: apply only if the saved assumptions still hold. The second is **pessimistic locking**: prevent competing work before it starts, including all child processes until cleanup is verified. Neither a database transaction saving the instruction nor a check on one destination validates every file an agent relied on. Protecting a whole coding task would also need rules for multiple dependent files and for a crash after only some files were written.

## What Git contributes and what it does not

Separate Git worktrees can give agents separate working copies, and a later merge can combine their changes for review. That avoids immediate overwrites between those copies, but also means agents no longer see each other's unfinished edits in the same folder.

A **worktree** is another checked-out working directory; a **checkpoint** preserves a known state; a **three-way merge** compares a common original with both sets of changes. These are useful future options, not automatic agreement about conflicting requirements. Blindly resetting or stashing/popping a shared repository can disturb someone else's work. Our T3 review found worktree/checkpoint/restore patterns, but its inspected workspace lock ends before the provider turn, and its prompt stashing saves message drafts rather than file edits. See [source-backed T3 review](../apps/collab-demo/CONFLICT_RESOLUTION_PROPOSAL.md#what-the-local-t3-code-implementation-actually-provides).

## How to demonstrate the race reliably

Do not try to type fast enough to catch two real models editing together. Pause scripted participants after both have read the old file, then release their writes one at a time to show the unsafe result and the managed rejection.

Example 41 already demonstrates the protected package API on real temporary files without a server or model. A proposed GUI scenario panel would expose Prepare, Publish A, Publish B and Resolve controls with base/current/proposed views. That panel is not implemented yet, and deterministic drivers must be labelled as scripted execution. Integrating real model-facing managed tools would additionally require trusted actor/command binding and restrictions preventing bypass through ordinary writes or shell commands.
