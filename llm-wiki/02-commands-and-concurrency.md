# Commands, identity and concurrency

The collaboration layer turns requests from several users into attributed, persistent work with explicit ordering rules. The main interview challenge is distinguishing the order of admission from the order of execution and the correctness of file changes.

Use Alice and Bob sharing agents A and B as the running example. The relevant sources are [thread admission](../packages/durable/src/collaboration/thread.ts), [metadata](../packages/durable/src/collaboration/state.ts), and [external tasks](../packages/durable/src/collaboration/external.ts).

## A command from click to result

The server authenticates the user, validates wire input and asks Durable to admit the command. Durable returns a receipt after persistence; execution and eventual result observation happen separately.

For example, Alice submits command `c17` to A. One transaction checks membership, compares retry identity/text, checks capacity, and stores a receipt together with native input or an external task. The host returns HTTP `202`, and the browser later receives snapshots containing queued/running/terminal state. This means a slow model does not require the submission connection to remain open, and a successful HTTP admission is not a successful coding task. [HTTP routes](../apps/collab-demo/src/server.ts).

## Many-to-many sharing is a relationship model

Every thread member can use every configured agent, and each agent has one shared history and queue. Users do not receive private copies of agents simply because they open separate browser pages.

The deterministic preview demonstrates three members by two agents, giving six user/agent pairs; the default real configuration has two members and two native agents. A's history is separate from B's, while both use the same files. Shared access is not online presence, private messaging or per-agent authorization. Users explicitly choose the target agent; there is no general autonomous planner/delegation protocol or automatic copying of every peer agent's conversation. [Concurrency tests](../apps/collab-demo/test/concurrency.test.ts).

## Retry identity and idempotent admission

Command identity is scoped by `(thread, actorId, agentId, commandId)`, and an identical retry returns the original receipt. Reusing that identity with different text is a conflict rather than a new instruction.

Suppose the database commits `c17`, but Alice loses the HTTP response. Retrying `c17` with the same text avoids a second admission; Bob or another agent can independently use the same short ID because the scope differs. Existing retry lookup precedes capacity rejection, so a full thread does not make previously accepted receipts inaccessible. A known failed or interrupted command is different: its original ID still identifies that old outcome, so an intentional new execution needs a new ID. Preserve IDs for ambiguous delivery, not for deliberately rerunning finished work. [Admission implementation](../packages/durable/src/collaboration/thread.ts).

## Three different kinds of serialization

Session commits run on one mutation line, commands execute in order within an agent lane, and participating native single-file mutations use a file gate. These mechanisms protect different things and should never be treated as interchangeable locks.

The transaction line protects admission/state invariants without holding a database transaction during model calls. Per-lane ordering prevents two foreground requests from simultaneously using the same agent conversation under the demo policy. The file gate protects an individual native mutation's own read/modify/write sequence, not two agents' earlier reads or external shell operations. Independent lanes can therefore overlap and still lose file updates. Ollama's configured single inference slot is a further resource constraint, not a collaboration scheduling guarantee.

## Native ordering and external predecessor tasks

Native agents reuse Durable's follow-up inbox; external commands use ordinary tasks that depend on unfinished predecessors. This preserves separate execution paths without adding an application scheduler.

The demo selects one-at-a-time native follow-up placement and withdraws queued native user inputs after failed runs. An external task waits for its predecessor to become terminal and proceeds only if its predecessor's command completed; otherwise already queued successors stop. A fresh command admitted after that predecessor is terminal can start again. Native queue behavior follows host Harness settings, so the one-at-a-time policy is not an immutable guarantee of every possible host composition. [External execution](../packages/durable/src/collaboration/external.ts), [core submission rules](../packages/durable/docs/spec.md#6-submissions-and-inbox).

## Contradictory instructions are a human policy problem

Serializing Alice's “use React” and Bob's “use Vue” preserves an order and attribution, but it does not decide which requirement is correct. Queue correctness cannot establish semantic agreement.

The prototype displays who submitted each instruction but does not enforce user priority, project ownership or approval arbitration. Stored author metadata is also not a guarantee that the model understands authority: model-facing input is the submitted text. More advanced behavior would require an explicit policy, trusted attribution in context where useful, and possibly a human decision step. It should not infer authority from a prompt claiming “I am the administrator.”

## Cancellation and what busy means

Stop applies to one agent lane's ordinary work and queued user inputs, including work submitted by another member. Disconnecting a viewer or stopping a watch does not stop execution, and cancellation does not undo files already written.

A useful demonstration queues Bob behind Alice, then stops that lane while the other agent continues. There is no command-specific withdrawal or persisted cancellation-initiator audit in the first slice. Native answer completion can also precede lane idleness when after-run tasks remain, so “the answer appeared,” “the command completed,” and “all work drained” are different observations. Process cleanup still depends on cooperation and supervision, as covered in [recovery](03-durability-and-recovery.md).

## Bounds, fairness and fixed configuration

The prototype bounds admission with a lifetime receipt cap and a per-agent pending cap, while preserving retries of existing receipts. Membership, agent definitions and workspace configuration are fixed for a store and must match on reopen.

Defaults are 256 lifetime commands, 16 pending commands per agent and 16,384 input characters. These simplify storage and recovery but do not provide per-user fairness, automatic retention or a spend limit; one member can consume shared capacity. Configuration changes deliberately require a fresh store rather than silently reinterpreting old work. Dynamic membership, revocation and archival would need explicit policy and migration work. [Configuration and limits](../packages/durable/src/collaboration/state.ts).
