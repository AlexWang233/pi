# Questions about shared-file conflicts

These questions distinguish preventing overlapping writes from preserving the meaning of concurrent changes. Every answer assumes the current shared-workspace prototype unless it explicitly describes a proposed extension.

The [file-conflict overview](../04-files-and-conflicts.md) introduces base/current/proposed content and the opt-in managed-file API. The questions below explain where that narrow mechanism is useful, where it rejects more than necessary, and what remains unprotected.

## If two agents edit different lines of the same file, will the managed API merge them?

No automatic line merge is implemented: the managed API compares the destination's complete bounded content with the retained base. If Alice changed any part of that content, Bob's old-base replacement becomes a conflict even if his intended line is different.

This is a conservative choice that avoids silently overwriting Alice and preserves the proposed work for review. A later three-way merge could compare the common base with both changes and produce a candidate, but the candidate would still need publication against an unchanged current version. A text merge can also be syntactically clean while the two changes disagree semantically. See [explicit resolution](../04-files-and-conflicts.md#conflict-resolution-is-explicit-not-automatic-merging) and [Git's possible role](../04-files-and-conflicts.md#what-git-contributes-and-what-it-does-not).

## If the file changes and later returns to identical content, can the current check detect that history?

The current check compares content and existence, so it cannot distinguish unchanged `base` from a file that went `base → changed → base`. A revision number that increases on every participating mutation could detect that history, but it is not part of this slice.

For a simple replacement, identical current bytes may be sufficient; for a proposal whose assumptions depend on intervening events, it may not be. This distinction is sometimes called the ABA problem, where a value returns to A after passing through B. A revision would help only if every relevant writer advances it; raw shell/editor changes still require coordination or another trusted observation mechanism. See [the current validation rule](../04-files-and-conflicts.md#managed-publication-and-optimistic-concurrency-control).

## What if agent B edits one file based on a different file that agent A changed?

Validating only B's destination does not establish that every file B relied on is still current. The present managed-file API protects one destination and does not validate a multi-file set of assumptions.

Suppose B reads `api.ts`, then prepares a change to `client.ts`; A changes the API signature before B publishes. `client.ts` may still match B's retained base, so its destination check can pass even though B's plan is stale. A stronger design could retain and validate the whole read set—the files and versions the proposal depended on—or use whole-turn workspace ownership. It must also address partial publication if several files are written before a crash. See [database comparisons](../04-files-and-conflicts.md#what-the-database-analogy-teaches).

## Why not just lock the workspace until an agent finishes its instruction?

Whole-turn ownership could prevent participating agents from preparing conflicting changes against overlapping workspace activity. It also serializes their work within that workspace and requires ownership to last until every former writer has actually stopped.

A lock held only until the parent agent returns can be insufficient if a child shell continues writing. A time-limited lease can also expire while the old process is still alive; an ordinary filesystem writer does not consult database ownership tokens before each syscall. The prototype does not implement general whole-turn ownership, and a future version would need all writers, cancellation and recovery to honor the policy. See [process lifetime](../03-durability-and-recovery.md#stop-graceful-close-and-process-death) and [scaling ownership](08-scaling-and-operations.md).

## Would giving each agent a Git branch or worktree solve the current conflict problem?

A branch name alone does not isolate edits when agents still use the same working directory. Separate worktrees can give agents separate working files, but introduce an explicit integration step and change immediate shared-file visibility.

If A edits in one worktree, B will not automatically see those unmerged edits in another. Changes must be reviewed, merged and tested, with a policy for conflicting intent and generated/dependency state. That can be an excellent alternative product model, but it is not the currently implemented shared-directory behavior. The local T3 review provides useful patterns without proving its workspace lease protects an entire provider turn. See [the T3 coordination review](../../apps/collab-demo/CONFLICT_RESOLUTION_PROPOSAL.md#what-the-local-t3-code-implementation-actually-provides).

## Bob's proposal was rejected: why can't he keep retrying the same ID until it applies?

A proposal ID identifies one retained proposal and outcome, rather than a request to keep trying new writes. Retrying it with the same payload returns the recorded conflict without publishing again.

Bob must retain a fresh read under a new read ID, decide how to incorporate Alice's current content, and submit a new proposal ID. Reusing the old read ID would return its old base, even after the file changes. This makes resolution explicit and preserves what Bob originally proposed; it does not silently rewrite history or rerun the model. The same conceptual distinction applies to accepted command retries versus new executions. See [example 41](../../packages/durable/test/examples/41-managed-file-conflict.ts) and [command retries](02-requests-and-concurrency.md).
