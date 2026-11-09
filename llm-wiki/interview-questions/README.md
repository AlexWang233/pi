# Expanded interview question bank

These questions explain concrete situations an interviewer might ask you to reason through, rather than assuming the terminology is already familiar. Every answer begins with a two- or three-sentence summary and then adds an example, justification or limitation.

Use the [main wiki](../README.md) for the project map and the [short answer drills](../08-interview-drills.md) for a first rehearsal. This bank goes deeper into failure traces and changing requirements, while linking to those pages instead of repeating their complete explanations.

## Choose a question type

Start with the categories relevant to the interview rather than reading every answer in one sitting. The request, file-conflict and recovery pages are especially useful because the same concrete examples explain several design decisions.

The categories separate questions about today's behavior from questions about a possible extension. Answers explicitly say when a capability is proposed, unverified or outside the current trusted-team scope.

| Category | Situations covered |
| --- | --- |
| [Architecture and scope](01-architecture-and-scope.md) | Package boundaries, thread/history design, framework trade-offs and ownership of the work |
| [Requests and concurrency](02-requests-and-concurrency.md) | Lost HTTP replies, duplicate IDs, overlapping users, cancellation and reconnect |
| [File conflicts](03-file-conflicts.md) | Stale reads, separate-line edits, multi-file dependencies, worktrees and locks |
| [Failures and recovery](04-failures-and-recovery.md) | Repeated model/file actions, dispatch markers, storage uncertainty and process survival |
| [Models and adapters](05-models-and-adapters.md) | Shared model credentials, compatibility, T3 events, approvals and continuation |
| [Security and API boundaries](06-security-and-api.md) | Impersonation, revocation, prompt injection, path races and abuse limits |
| [Testing and diagnosis](07-testing-and-diagnosis.md) | Controlled races, assertions, ambiguous failures, memory and latency measurements |
| [Scaling and operations](08-scaling-and-operations.md) | Multiple owners, database choices, slow viewers, backup, VM restart and deployment |

## Practice an answer in three passes

First identify what action the question asks about, then answer with current behavior, and finally explain the trade-off using one small trace. If the requirement changes, name the new assumption before proposing a larger system.

For example, “Can it run twice?” is incomplete until you identify the action: two accepted commands, two model requests or two writes. State the guarantee at that boundary, walk through what happens before and after a crash, and finish with what would be required for a stronger guarantee. Treat follow-up questions in the detail paragraphs as reasoning exercises, not claims that every extension is already implemented.

## Translate common interview shorthand

Technical shorthand is useful only when you know which concrete action or component it refers to. Use these translations to unpack a question before answering, and follow the links for the relevant behavior in this project.

For example, a receipt means the instruction was accepted, while a model answer and a file change are later, separate observations. If a question combines them under the word “execution,” separate them explicitly rather than trying to give one yes/no answer for the whole pipeline.

| Term | Plain meaning in this project | Read more |
| --- | --- | --- |
| Admission | Saving the user's instruction and its executable intent as accepted work | [Request lifecycle](../02-commands-and-concurrency.md#a-command-from-click-to-result) |
| Receipt | The accepted command's identity, which a retry can find; not proof of task success | [Lost reply](02-requests-and-concurrency.md) |
| Atomic commit | Grouped database state changes take effect together; external file changes are not included | [Transaction boundary](../03-durability-and-recovery.md#what-the-atomic-transaction-actually-covers) |
| Idempotent admission | Repeating the same scoped ID/text returns the same accepted command instead of creating another | [Retry scope](../02-commands-and-concurrency.md#retry-identity-and-idempotent-admission) |
| Side effect | An external change, such as appending a file or starting a process, whose outcome must be reasoned about separately | [Repeated work](04-failures-and-recovery.md) |
| Projection | A derived display of stored/current state, such as one agent's bounded snapshot | [State versus events](../06-web-and-demonstration.md#snapshots-are-convergent-views-not-an-event-journal) |
| Backpressure | Output is produced faster than a viewer consumes it, requiring buffering limits or coalescing | [Slow viewer](08-scaling-and-operations.md) |
| Lease | Time-limited ownership permission; expiration alone does not kill an old writer | [Workspace ownership](03-file-conflicts.md#why-not-just-lock-the-workspace-until-an-agent-finishes-its-instruction) |
| Fencing | Preventing an old owner from continuing effects after ownership transfers; database permission alone cannot stop every raw file write | [Multiple owners](08-scaling-and-operations.md) |
| Provider versus harness | The model service versus the agent loop managing messages, tools and sessions | [Model/adapter boundary](../05-providers-adapters-and-trust.md) |

## Keep evidence separate from design proposals

The current default uses native OpenAI and Ollama, and the user has manually confirmed they work. The managed conflict GUI, real Codex model turns and actual GCP deployment are not established by that confirmation.

The [claims table](../README.md#claims-you-can-defend) is the reference for what you can present as delivered. A deterministic conflict example uses real files but no model, and a prepared deployment unit is not a running VM. When practicing a future-design answer, explicitly introduce it as “I would add…” or “That would require…”.
