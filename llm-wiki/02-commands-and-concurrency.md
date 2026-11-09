# Commands, identity and concurrency

Several people can send instructions at almost the same time, so the system needs clear rules about what was saved and what runs next. Running requests in order on one agent does not prevent different agents from making conflicting file changes.

Use Alice and Bob sharing agents A and B as the running example. The relevant sources are [thread admission](../packages/durable/src/collaboration/thread.ts), [metadata](../packages/durable/src/collaboration/state.ts), and [external tasks](../packages/durable/src/collaboration/external.ts). The glossary explains [admission and receipts](09-technical-terms.md#admission-receipt-and-acknowledgement), [idempotency](09-technical-terms.md#idempotency-deduplication-and-exactly-once-claims), and [serialization](09-technical-terms.md#concurrency-parallelism-and-serialization).

## A command from click to result

When Alice clicks Send, the server saves her request before replying that it was accepted. The agent runs the request separately and later reports an outcome, so 'accepted' and 'finished successfully' mean different things.

Alice's request `c17` is checked for membership, duplicate identity, and available queue space. Durable saves both its **receipt** (the record used to recognize a retry) and the work to run in one database commit: either input for a native agent or a task for an external agent. HTTP `202` means accepted, while browser updates later show queued, running, or finished work. A slow model therefore does not require the original Send connection to stay open. See [HTTP routes](../apps/collab-demo/src/server.ts).

```mermaid
sequenceDiagram
  participant A as Alice's browser
  participant W as Web server
  participant D as Durable and SQLite
  participant G as Agent
  A->>W: Send c17 with instruction
  W->>D: Check and save receipt plus work
  D-->>W: Accepted receipt
  W-->>A: 202 Accepted, not task success
  Note over A,G: Work can start after saving; the HTTP reply may be lost
  D->>G: Run when this agent can take the request
  G-->>D: Report outcome
  W-->>A: Stream later state updates
```

If Alice loses the acceptance reply, repeating `c17` with the same text finds the saved receipt. This diagram separates acceptance from outcome; it does not require execution to wait for the HTTP reply to arrive.

## Many-to-many sharing is a relationship model

Alice, Bob, and another member can all use agents A and B, giving six possible user-agent pairs. Each agent keeps one shared history and queue, rather than creating a private copy for each person.

The deterministic preview demonstrates three members by two agents, giving six user/agent pairs; the default real configuration has two members and two native agents. A's history is separate from B's, while both use the same files. Shared access is not online presence, private messaging or per-agent authorization. Users explicitly choose the target agent; there is no general autonomous planner/delegation protocol or automatic copying of every peer agent's conversation. [Concurrency tests](../apps/collab-demo/test/concurrency.test.ts).

## Retry identity and idempotent admission

Every request has an ID that lets the server recognize a repeated send from the same user to the same agent. If Alice loses the reply, sending the same ID and text again finds the original request instead of adding another one.

The complete identity is `(thread, actorId, agentId, commandId)`; this duplicate-safe acceptance rule is called **idempotent admission**. Reusing it with different text is rejected, while Bob can independently use Alice's short ID because his user identity differs. The saved receipt is looked up before checking capacity, so retries still work when the thread is full. If a request definitely failed and Alice deliberately wants another attempt, she needs a new ID: the old one continues to identify the old outcome. See [admission implementation](../packages/durable/src/collaboration/thread.ts).

## Three different kinds of serialization

The system takes turns in three places: saving database changes, running instructions on one agent, and performing certain individual file writes. Each protects a different part of the work; none is a lock covering everything an agent does.

Durable's **mutation line** means saved state changes are handled one at a time, without holding up the database while a model thinks. **Per-agent ordering** keeps Alice's and Bob's requests from using the same conversation simultaneously under the demo policy. The native **file gate** coordinates an individual file mutation, but does not protect an earlier read followed by seconds of model planning. Different agents can still overwrite an old version, and Ollama's one-at-a-time model processing is a separate hardware/service limit.

## Native ordering and external predecessor tasks

Pi's own agents use Durable's existing inbox, while an external agent such as Codex runs through Durable tasks. Both paths let requests wait for earlier work on that agent without adding a second queue in the web app.

The demo selects one-at-a-time native follow-up placement and withdraws queued native user inputs after failed runs. An external task waits for its predecessor to become terminal and proceeds only if its predecessor's command completed; otherwise already queued successors stop. A fresh command admitted after that predecessor is terminal can start again. Native queue behavior follows host Harness settings, so the one-at-a-time policy is not an immutable guarantee of every possible host composition. [External execution](../packages/durable/src/collaboration/external.ts), [core submission rules](../packages/durable/docs/spec.md#6-submissions-and-inbox).

## Contradictory instructions are a human policy problem

If Alice says 'use React' and Bob says 'use Vue,' the system can show who asked and process the requests in order. It cannot decide which product requirement is correct just by putting one request first.

The prototype displays who submitted each instruction but does not enforce user priority, project ownership or approval arbitration. Stored author metadata is also not a guarantee that the model understands authority: model-facing input is the submitted text. More advanced behavior would require an explicit policy, trusted attribution in context where useful, and possibly a human decision step. It should not infer authority from a prompt claiming “I am the administrator.”

## Cancellation and what busy means

Stop affects the selected shared agent, including another member's active work and queued requests on that agent. The other agent can continue, and Stop does not undo changes already written to files.

A useful demonstration queues Bob behind Alice, then stops that lane while the other agent continues. There is no command-specific withdrawal or persisted cancellation-initiator audit in the first slice. Native answer completion can also precede lane idleness when after-run tasks remain, so “the answer appeared,” “the command completed,” and “all work drained” are different observations. Process cleanup still depends on cooperation and supervision, as covered in [recovery](03-durability-and-recovery.md).

## Bounds, fairness and fixed configuration

The prototype limits how many requests a thread can accept and how many can wait for one agent. Its members, agents, and workspace are fixed for that saved thread, so changing them requires a fresh store rather than silently changing old work.

Defaults are 256 lifetime commands, 16 pending commands per agent and 16,384 input characters. These simplify storage and recovery but do not provide per-user fairness, automatic retention or a spend limit; one member can consume shared capacity. Configuration changes deliberately require a fresh store rather than silently reinterpreting old work. Dynamic membership, revocation and archival would need explicit policy and migration work. [Configuration and limits](../packages/durable/src/collaboration/state.ts).
