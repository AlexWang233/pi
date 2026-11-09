# Expanded interview question bank

These questions explain concrete situations an interviewer might ask you to reason through, rather than assuming the terminology is already familiar. Every answer begins with a two- or three-sentence summary and then adds an example, justification or limitation.

Use the [main wiki](../README.md) for the project map and the [short answer drills](../08-interview-drills.md) for a first rehearsal. Keep the [technical-terms guide](../09-technical-terms.md#find-a-term) nearby: it explains unfamiliar agent-system and collaboration terms with examples and diagrams. This bank retains technical depth in the second paragraphs so you can answer follow-up questions rather than only memorize simplified answers.

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

For example, a receipt means the instruction was accepted, while a model answer and a file change are later, separate observations. If a question combines them under the word “execution,” separate them explicitly rather than trying to give one yes/no answer for the whole pipeline. The table is a quick reminder; use the linked definitions for examples and the main pages for the implementation rules.

| Term | Plain meaning in this project | Read more |
| --- | --- | --- |
| Admission | Checking and saving an instruction as accepted work | [Acceptance terms](../09-technical-terms.md#admission-receipt-and-acknowledgement) |
| Receipt | Saved acceptance record; not proof of task success | [Receipt example](../09-technical-terms.md#admission-receipt-and-acknowledgement) |
| Atomic commit | Grouped database changes take effect together; external file changes are excluded | [Database terms](../09-technical-terms.md#atomic-commit-durability-and-the-mutation-line) |
| Idempotent admission | Repeating the same user/agent/ID/text finds the original accepted request | [Retry terms](../09-technical-terms.md#idempotency-deduplication-and-exactly-once-claims) |
| Side effect | Action outside coordination records, such as appending a file | [Crash example](../09-technical-terms.md#side-effects-checkpoints-and-dispatch-markers) |
| Projection | A display built from underlying records | [Display terms](../09-technical-terms.md#projections-snapshots-sse-and-audit-logs) |
| Backpressure | Producer sends faster than a viewer can read | [Slow-browser example](../09-technical-terms.md#backpressure-fan-out-and-coalescing) |
| Lease | Permission that expires; expiry does not kill an old writer | [Ownership terms](../09-technical-terms.md#locks-ownership-leases-and-fencing) |
| Fencing | Preventing an old owner from acting after ownership changes | [Old-writer example](../09-technical-terms.md#locks-ownership-leases-and-fencing) |
| Provider versus harness | Model service versus software running the agent's model/tool loop | [Agent-system diagram](../09-technical-terms.md#provider-model-agent-harness-and-adapter) |

## Keep evidence separate from design proposals

The current default uses native OpenAI and Ollama, and the user has manually confirmed they work. The managed conflict GUI, real Codex model turns and actual GCP deployment are not established by that confirmation.

The [claims table](../README.md#claims-you-can-defend) is the reference for what you can present as delivered. A deterministic conflict example uses real files but no model, and a prepared deployment unit is not a running VM. When practicing a future-design answer, explicitly introduce it as “I would add…” or “That would require…”.
