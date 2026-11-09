# Proposed coordination and conflict resolution

**Status: the first opt-in single-file API is implemented; broader protections remain proposals.**
[`ManagedFile`](../../packages/durable/docs/managed-files.md) provides bounded conditional edits,
retained conflict evidence and conservative blocking after uncertain writes. It is not yet
connected to model tools, Codex or HTTP/UI. The current demo still permits the lost update
demonstrated in [the scenario register](PROBLEM_SCENARIOS.md).
This document proposes solutions for selected high-impact scenarios using database and Git
ideas. It does not propose replacing Durable's persistence engine or adding a database service.

**Scope decision:** coordination of direct shell/Codex writes remains a future extension,
as requested. The local T3 review below records reusable patterns; it does not enable them
or change the current shared-directory execution model.

## What the local T3 Code implementation actually provides

Reviewed November 8, 2026 at commit `d5fc29fe5cb62db68bfbf824cfabe0ae94ac6ac4`
in `E:\Github\t3code`. References below target that sibling checkout. This is source inspection,
not a live T3 execution test or an audit of every provider adapter.

### Workspace isolation and recovery

**Problem:** two coding sessions can replace the same file, and reverting one session can
erase changes belonging to the other. T3 offers independent working copies and explicitly
checks whether a checkout is shared before restoring it.

| Mechanism found in T3 | Evidence and actual behavior | What we can reuse |
| --- | --- | --- |
| Optional per-thread worktrees | [Thread guide](../../../t3code/docs/user/thread-sidebar.md), lines 3–14 and 56–59: a new worktree supplies a separate branch/directory; sending one prompt to multiple models creates separate threads/worktrees. [Workspace resolution](../../../t3code/apps/server/src/project/threadWorkspaceRoot.ts) selects `worktreePath`, falling back to the project root | Future isolated-task mode, with an explicit workspace per task/agent and reviewed integration into shared code. Separate worktrees are optional in T3; isolation is not guaranteed for every thread |
| Shared side chats | [Side-chat guide](../../../t3code/docs/user/thread-sidebar.md), lines 297–312: parent and side chat use the same folder; Bring back passes conversation context to the parent | Separate histories with explicit context transfer. Bringing a conversation back is not evidence of a Git merge or safe simultaneous file editing |
| Hidden checkpoint refs and a scratch index | [Git checkpoint implementation](../../../t3code/apps/server/src/vcs/GitVcsDriver.ts), lines 905–1296: capture uses `GIT_INDEX_FILE`, `write-tree`, `commit-tree`, and `update-ref` | Future before/after snapshots and reviewable diffs without staging into the user's normal index or advancing their branch. Snapshot capture does not serialize arbitrary writers or attribute every changed byte to one agent |
| Refuse restore on shared checkouts | [Restore safety](../../../t3code/apps/server/src/orchestration-v2/CheckpointRestoreSafety.ts) checks the worktree, other threads, checkpoint scopes and provider sessions, including ancestor/descendant overlap. [Rollback execution](../../../t3code/apps/server/src/orchestration-v2/CheckpointRollbackService.ts) checks again and rolls back provider conversation before restoring files | Adopt this rule before offering file undo: refuse broad restore in our shared-agent thread. Prefer retained proposals and version-checked inverse changes. An isolated-worktree restore still needs review because manual edits in that checkout can also be undone |
| Selected-operation workspace lease | [Lease implementation](../../../t3code/apps/server/src/workspace/workspaceLease.ts) is an in-process, cwd-keyed semaphore. [Turn startup](../../../t3code/apps/server/src/orchestration-v2/ProviderTurnStartService.ts), lines 1727–1735, explicitly holds it only during startup, releasing it before running the provider turn | Coordinate app-owned startup, cleanup and selected Git operations. Do not copy this helper and claim whole-turn ownership or distributed fencing; our stronger ownership proposal would need additional lifecycle and process supervision |

**Concrete implication:** T3 can run task A in worktree A and task B in worktree B, so their
ordinary shell writes target different working copies. Our current agents intentionally share
one working directory. Giving each agent a private worktree would change immediate visibility
of each other's edits and must be presented as an alternative mode, rather than silently
replacing the assignment's shared-filesystem behavior.

### Messages, approvals and multiple people

| Mechanism found in T3 | Evidence and actual behavior | What we can reuse |
| --- | --- | --- |
| Durable queue versus steering | [Composer guide](../../../t3code/docs/user/composer.md), lines 61–89, describes server-saved queued follow-ups and capability-dependent steering. [Queue ordering](../../../t3code/apps/server/src/orchestration-v2/QueuedRunOrder.ts) uses persisted queue positions, with priority for delegated completion messages | Keep our existing per-agent queue. Later make steering an explicit capability and persist queue edits/cancellations; do not copy priority rules unless we implement delegation |
| Serialized decisions, durable intent, later effects | [Architecture](../../../t3code/docs/internals/overview.md), lines 45–59, documents committed receipts/events/outbox effects. [Thread command executor](../../../t3code/apps/server/src/orchestration-v2/ThreadCommandExecutor.ts) supplies keyed locking; `Orchestrator.ts`, lines 14032 onward, wraps dispatch with thread locks | Already aligned with Durable's transactional admission and separate execution. Reuse the design principle through existing Durable primitives, rather than importing a second orchestration engine |
| One recorded response to a pending request | [Runtime-request handling](../../../t3code/apps/server/src/orchestration-v2/Orchestrator.ts), lines 9268–9635: refuses non-pending requests, records resolved state and enqueues provider delivery. Its delivery-failure comment preserves the recorded decision when delivery is uncertain | Future approvals can use one atomic pending-to-decided transition plus an explicit delivery outcome. First-valid-decision behavior follows from serialized dispatch and the pending check; it is not a policy deciding whose conflicting instruction has greater authority |
| Scoped clients and owner-mediated guests | [Environment auth](../../../t3code/docs/internals/environment-auth.md) separates scoped sessions from guest links. [Guest guide](../../../t3code/docs/user/guest-links.md) allows viewing a thread and proposing messages; the owner sends or dismisses them. Guests cannot answer agent requests | Optional observer/proposer/operator roles and moderated guest messages. This guest workflow is different from our M:N trusted-member model, in which Alice, Bob and Carol may all directly submit to every agent |

The inspected mechanisms do not establish automatic reconciliation of contradictory user
requirements or general conflict prevention for arbitrary agents sharing one directory.
Multiple clients controlling an environment and guest sharing are useful interaction models,
but do not by themselves supply our thread membership policy.

### Stashing and the future extension we should retain

T3's [Prompt stash](../../../t3code/docs/user/composer.md), lines 176–185, stores an unsent
prompt and attachments. It is not Git stashing of agent file edits. The inspected Git paths
use hidden checkpoint refs for snapshots; a dirty-checkout error in
[`GitManager.ts`](../../../t3code/apps/server/src/git/GitManager.ts), line 2808, asks the user
to commit or stash rather than automatically hiding their work. We found no automatic
stash/apply conflict-resolution mechanism in these reviewed paths.

Keep the following as **future extensions**, with no implementation commitment for this take-home:

1. **Checkpoint and diff inspection:** capture review artifacts with a separate Git index,
   preserve the user's branch/index, and refuse destructive shared-workspace restores.
2. **Optional isolated task worktrees:** establish task ownership and a common base, run each
   task in its own checkout, then propose a reviewed integration change. Preserve competing
   proposals on conflicts. That review/integration policy would be our addition; the inspected
   T3 code is not evidence that it implements this exact multi-agent merge workflow.
3. **Shared-directory ownership alternative:** if immediate shared-file visibility is required,
   serialize unrestricted turns through completion and verified cleanup. T3's short startup
   lease is a reference for coordinating selected operations, not a complete implementation.
4. **Approval and guest roles:** introduce explicit decision identity, eligible actors, one
   durable decision and visible delivery state when these interaction modes enter scope.

Avoid automatic stash/pop on the shared directory: it cannot reliably separate one agent's
uncommitted edits from another's. Whole-checkout snapshots are useful review evidence, but
also do not solve ownership or make broad rollback safe.

## Recommendation and constraints

Use **optimistic concurrency control** for mediated edits: record which file version an agent
read, then accept its proposed change only if that version is still current. Preserve stale
proposals for review. Add Git-style three-way merge later, initially as a suggested resolution.

For agents with unrestricted filesystem access, use **exclusive workspace ownership** for the
whole foreground turn if preventing overlap is required. This includes today's native agents
with `bash`, as well as external Codex. Checking Pi's `write` tool alone does not protect them.

These are two operating policies with different guarantees:

| Policy | Permitted execution | Useful guarantee, assuming every writer participates | Cost |
| --- | --- | --- | --- |
| Current concurrent execution | Native tools, shells and Codex directly access shared files | Per-agent ordering only; file conflicts remain possible | No conflict prevention |
| Managed edits | File reads and mutations use the coordinator; no unrestricted write-capable shell/CLI path | Stale replacements are rejected before publication; unrelated edits can proceed concurrently | Needs tools/adapters that cannot bypass coordination |
| Exclusive workspace turns | One participating agent owns the workspace before its first file access until foreground work and descendants finish | Participating turns cannot overlap filesystem operations | Agents in that thread execute serially; does not arbitrate conflicting intentions |

**For the existing mixed-harness prototype, exclusive turns are the smallest protection that
can cover both native and external writers under a cooperative single-owner model.** Managed
edits are the preferred path to retain useful within-thread concurrency, but are a separate,
restricted capability. Do not label the full current system safe after demonstrating only a
managed-file test. Neither policy covers an editor, escaped process, or other writer that
ignores it; hostile execution needs enforced isolation.

All agents continue to share one working directory. Private per-agent worktrees would change
that visibility model. Multiple threads may continue executing independently with separate
workspaces. The opt-in API does not change the existing demo's execution policy.

## What to borrow from databases and Git

| Established idea | Proposed application here | Important boundary |
| --- | --- | --- |
| Conditional version update | Apply a mutation only against the version actually observed | Filesystem comparison plus replacement needs coordination; two separate system calls are not an atomic conditional update |
| Transaction isolation / read validation | Validate the files an operation depended on before applying its changes | Checking only the destination misses stale dependencies in other files; this is not a full serializable filesystem |
| Pessimistic/advisory locking | Own a file set or workspace while incompatible work executes | An advisory lock protects only participants; hold it across the relevant reads and writes |
| Three-way merge | Compare base, current shared content and an agent's proposed content | A clean textual merge does not prove that the resulting program is correct |
| Write-ahead intent and recovery | Record a proposed mutation before filesystem publication | Durable metadata and arbitrary filesystem effects are not automatically one atomic transaction |
| Explicit terminal decisions | Approvals and cancellation record one ordered, durable decision | A decision does not roll back an operation already performed |

PostgreSQL documents serializable execution and transaction retries after serialization
failures; its advisory locks rely on application cooperation. Those are useful reference
semantics, not capabilities this filesystem already has.
[Isolation reference](https://www.postgresql.org/docs/current/transaction-iso.html),
[locking reference](https://www.postgresql.org/docs/current/explicit-locking.html).

Git's `merge-file` combines a current file, a common base and another version, reporting
overlapping textual changes as conflicts. That is the merge primitive proposed below.
[Git reference](https://git-scm.com/docs/git-merge-file).

## F1/F2: simultaneous edits and stale context

### Start with reject-on-stale publication

Example: Alice's and Bob's agents read the same base version of `App.tsx`.

```text
shared App.tsx: hash H0
Alice reads H0                     Bob reads H0
Alice proposes A, based on H0      Bob proposes B, based on H0
Alice publishes A -> hash H1
                                  Bob tries to publish against H0
                                  coordinator sees H1: reject as stale
shared App.tsx remains A; B is retained as a conflict proposal
```

For a managed file operation:

1. Read through the coordinator and return the content plus a base token: thread, canonical
   relative path, existence/file kind, and content hash. Keep the base bytes for later review.
2. Let the agent prepare a proposed replacement or patch. It must retain that base token;
   a patch whose context happens to match is not proof that its broader assumptions are current.
3. At publication, acquire the coordinator's workspace access gate and destination-file lock.
   Check the actual current file against the token, then publish without releasing the locks
   between comparison and replacement. Every managed writer uses this path.
4. On mismatch, leave the current shared file unchanged. Persist the base/current/proposed
   references, author, agent and command identity. Return a structured conflict to the tool/UI.
5. After a fresh read, let the agent or a user propose a new change. Do not blindly replay the
   original agent turn or any shell command to emulate a database retry.

The base-token comparison and mutation form the required critical section. A content hash is
a practical change token for this prototype, not a complete version model for permissions,
symlinks, renames, dependencies, or externally modified files. Resolve path aliases and define
case/symlink behavior before claiming two names cannot refer to the same managed object.

A later monotonic file revision can distinguish publication events, even if content changes
away and then back. It does not replace checking the real file when unmediated changes are
possible. Filesystem watcher events can help refresh the UI; they cannot close the compare/write
race or serve as the sole authority for the file's version.

### Treat dependencies as a read set

If an agent reads `types.ts` and writes `App.tsx`, validate the observed `types.ts` version too.
Otherwise its destination can be unchanged while the code it depends on has become incompatible.
For a bounded managed operation, declare the relevant read/write set, acquire its file locks in
a fixed path order, validate the read set, and apply the intended mutations. Changing the set
requires releasing and restarting validation rather than acquiring arbitrary locks indefinitely.

An agent's undeclared assumptions, directory listings, external services, and package state
remain outside that set. Database-style serializability over an arbitrary coding session is
not a reasonable claim for this take-home. Fresh reads reduce stale context; neither a lock
nor a content hash can determine that the user's requirements changed.

### Add three-way merge after detection works

Keep three versions:

- **Base:** what the proposing agent read.
- **Current:** what is now in the shared workspace.
- **Proposed:** what the agent wanted to produce from the base.

Run a three-way merge on retained artifacts, with output separate from the shared file. For
example, `git merge-file --stdout current-copy base-copy proposed-copy` can produce a candidate;
never run a default in-place merge on the live target as a conflict detector.

| Result | Proposed handling |
| --- | --- |
| Base still current | Apply the exact proposed edit through the coordinator |
| Stale base, clean textual merge | Initially show the candidate diff for review; test it and condition publication on the current version still matching |
| Overlapping change or merge error | Keep the current file; show base/current/proposed and require a new proposal or explicit human decision |
| Binary, symlink, rename/delete conflict, or unsupported file kind | Explicit conflict; no automatic merge in the first slice |
| Shared content changes while the candidate is reviewed | Reject/recompute against the new current version; an approval for the old candidate is stale |

Never publish conflict markers or silently choose `ours`, `theirs`, or a union of both edits.
A clean text merge may still combine an API rename with an incompatible caller; relevant tests
and review remain necessary. Same-line edits are not the only kind of program-level conflict.

The model completing a turn and its proposed changes being applied must be separate visible
facts. A future proposal record could have `proposed`, `conflict`, `applied`, and `abandoned`
states; those are new design states, not current `CommandStatus` values.

## F3/F5/R2: direct writers, shells, and ownership

### Cover unrestricted writers explicitly

For an exclusive-turn policy, the package admits commands as today, then acquires workspace
ownership before invoking the agent or allowing its first file read. Keep ownership until its
foreground work and supervised descendants terminate. Release after a decided terminal state;
if cleanup cannot establish that the old writer is gone, mark the workspace blocked for review.

Do not hold a SQLite/Session transaction open during the agent turn. Ownership is a durable
logical record plus execution coordination; waiting should use Durable tasks rather than an
application-owned queue. Admission across all lanes can remain concurrent while execution waits.

A lease expiry or cancellation flag alone does not stop a CLI that still has direct file access.
A new generation number can reject stale managed writes, but raw shell processes cannot be
fenced by metadata they never check. Terminate or isolate the old writer before granting a
replacement access. Detached/background processes remain prohibited or supervised, not ignored.

### A later hybrid policy

Managed operations can share a workspace access gate and use file locks for their short commit
sections. An unrestricted turn takes exclusive access to that same gate. While it holds access,
managed filesystem reads and publications wait; model planning on already captured content can
continue. A managed proposal must revalidate afterward.

This preserves more parallelism than serializing every turn, but only when managed agents cannot
escape through `bash`, Codex, plugins or another direct filesystem path. Classify capabilities
before execution. Do not begin an unrestricted turn as managed and attempt to upgrade ownership
after it has already observed files or changed them. This hybrid is a later design, not the
recommended first implementation alongside unrestricted tools.

Classify operations such as dependency installs, Git resets/checkouts, migrations and builds
that mutate shared outputs as workspace-wide. A command described as a test may also write
snapshots, caches or generated files; a label or model promise is not a read-only guarantee.

### Why not simply use Git branches/worktrees?

Two agents using different branch names in the **same** working tree still mutate the same
checked-out files; branch naming is not a lock. Separate worktrees provide separate working
copies, which is useful for a branch-and-merge product, but changes this project's shared
working-directory behavior. Git documents that worktrees allow multiple checked-out trees for one
repository. [Worktree reference](https://git-scm.com/docs/git-worktree).

Keep that as an explicit future mode: private agent workspaces with a shared integration branch,
review, build isolation and merge publication. Do not silently use it to claim safe simultaneous
edits to the same live directory. Git also does not sandbox commands or reconcile external
side effects such as an already-sent network request.

## F4/R1/R4: partial changes, rollback, and crash recovery

Borrow the intent/journal idea, but keep its scope narrow. SQLite describes recovery using
journals and a defined commit point for database changes; an arbitrary agent's file writes are
not covered by a Durable metadata transaction.
[SQLite atomic-commit reference](https://www.sqlite.org/atomiccommit.html).

For a managed publication, a later operation journal would retain operation ID, author/agent/
command, paths, base hashes, proposed hashes and before/proposed artifacts before changing files.
After applying a change, persist its outcome and the resulting version. On restart, inspect the
prepared operation against disk before admitting another conflicting writer:

| Observed state | Proposed recovery |
| --- | --- |
| File matches base | The intended content is not visible; decide whether this managed mutation can safely resume |
| File matches proposed result | Reconcile the recorded file result without rerunning the model or shell turn |
| File matches neither | Block that operation/workspace for review; another effect or partial publication may have occurred |
| A multi-file operation is partly applied | Keep ownership blocked and reconcile its per-file journal; do not call it an atomic multi-file commit |

Matching bytes is evidence about file state, not proof of exactly-once execution or attribution
of unrelated side effects. Publication must define file/directory flushes, same-filesystem staging,
metadata handling and Windows/Linux replacement behavior before promising power-loss durability.
Do not apply database-style automatic retries to network requests, migrations or arbitrary shell work.

For undo, propose an inverse patch only against the version produced by the original operation.
If someone changed the file afterward, undo becomes another conflict to review. Preserve the
current working tree and user's Git index; capture artifacts without running a broad reset,
stash, checkout or automatic commit on collaborators' behalf.

## U1/U3/U4/T1/R5/O1: other selected scenario solutions

| Scenario | Proposed mechanism | Limit/trade-off |
| --- | --- | --- |
| U1/U6 — Contradictory instructions and author identity | Persist an attributed instruction revision; pass trusted sender metadata to the agent; keep requirement changes separate from code-merge decisions | React versus Vue is a requirements decision, not a text-merge problem; a model cannot grant user authority |
| U3 — Two approval responses | Compare-and-set a persisted `pending` decision to one terminal answer; validate actor, proposal version and expiry in the same commit | Define first-valid-wins versus rejection precedence explicitly; approving an old file version must not approve a new candidate |
| U4/U5 — Stop races | Persist cancellation initiator/reason and target command or lane generation; notify all viewers; hold ownership until cleanup completes | A stop may affect peers' queued work under current lane semantics; cancellation still does not undo effects |
| T1 — Retry deduplication | Keep the existing scoped receipt identity; give a managed mutation its own stable operation ID | A receipt is analogous to an idempotency record, not a transaction around external effects |
| R5 — Stuck running status | Reconcile public command/proposal state with its task and ownership records; terminal states cannot be revived by late callbacks | Test fault/restart-limit paths, not just ordinary adapter exceptions |
| O1 — Lock waiting, deadlock and fairness | Fixed lock order for managed file sets, bounded waits/cancellation, and an explicit fair workspace wait queue in Durable | Never expire ownership and assume a direct writer disappeared; bound queue retention and avoid indefinite starvation |

## Proposed implementation sequence and review gates

**First slice delivered:** the managed-file spike in step 2 is available as a package API
and runnable example, using exact bounded content comparison instead of hashes. It stores
intent before writes and blocks on uncertainty; recovery reconciliation is not implemented.
See [the implemented contract and limits](../../packages/durable/docs/managed-files.md).
Steps 1 and 3 still require selecting and wiring an execution policy for the actual agents;
step 4's merge/review work and the broader acceptance cases remain future work.

This is a menu for selecting a small additional slice, not a commitment to implement all of it
inside the remaining take-home time. Scope estimates would follow a source-level design review.

1. **Decide the guarantee first.** Keep today's concurrent demo and known limitation, or explicitly
   choose exclusive workspace turns for existing unrestricted harnesses. The latter changes the
   within-thread concurrency shown to evaluators; document that trade-off before implementation.
2. **Managed-file spike, if useful:** one bounded regular UTF-8 file, base content/hash, coordinated
   conditional replacement, structured conflict, and retained proposal. No shell interception,
   automatic merge, multi-file atomicity, or claim of protecting Codex in this spike.
3. **Choose one supported path for the prototype:** finish exclusive-turn ownership/cleanup for
   the existing harnesses, or restrict a clearly named agent mode to managed tools. Keep ownership,
   proposal records, settlement and watches inside `packages/durable`, with plain adapter contracts.
   HTTP renders those states and does not own locks or another execution queue.
4. **Only after rejection/recovery is correct:** add three-way merge candidates, then version-bound
   review/publication. Multi-file read sets, hybrid execution and private-worktree mode are expansion.

### Acceptance cases for a chosen slice

- Two proposals from one base: one publishes, the other conflicts; no silent lost update.
- Distinct managed files can progress independently; same-file check and publication cannot interleave.
- A changed read dependency rejects the managed operation even if its destination is unchanged.
- Create/create and edit/delete conflict rather than silently replacing unexpected content.
- A proposed merge never changes the live file on conflict/error; later shared changes invalidate approval.
- An unrestricted turn blocks all other participating workspace access, including native managed writes.
- Cancellation or crash does not grant ownership to a replacement while the old process can still write.
- Crash after publication but before metadata settlement reconciles file state without replaying the agent turn.
- Undo after someone else's edit refuses blind restoration; original/current/proposed artifacts remain available.
- Browser snapshots distinguish agent execution, waiting for ownership, conflict and applied changes.

Tests involving direct writers must use the real adapter/process boundary eventually. A green
fake-filesystem test alone does not establish that external harnesses participate correctly.
