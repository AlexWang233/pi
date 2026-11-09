# Questions about architecture and scope

These questions ask why the project is organized this way and what a change in requirements would affect. The goal is to connect visible behavior to package boundaries without taking credit for existing upstream machinery.

Review the [architecture map](../01-architecture.md) first if Session, Harness, conversation or provider are unfamiliar. Each question below supplies a specific situation rather than requiring you to infer which part of the project is being discussed.

## Why put collaboration inside Pi Durable instead of only adding a web server?

Imagine the web server accepts Alice's instruction and crashes before passing it to the agent runtime. Keeping the receipt and executable intent in one Durable transaction removes that particular gap between separate acceptance systems.

The browser host still authenticates Alice and delivers HTTP/SSE, but the package decides what was accepted and how it runs. A second web-owned queue would need its own persistence, retry and reconciliation rules. Package ownership also lets a command-line example or a different transport use the same behavior. The trade-off is learning and retaining Durable's existing semantics instead of replacing them wholesale. See [runtime versus host responsibility](../01-architecture.md#runtime-versus-host-responsibility).

## Why do two agents share files but keep separate conversation histories?

Alice can ask agent A to implement a change while Bob asks agent B to review the same workspace. Separate histories keep each agent's context and queue distinct, while shared files provide the common project state required by the assignment.

The thread groups users, agent identities and workspace configuration; each named agent has its own conversation. Sharing every message automatically would introduce questions about relevance, authority, repeated instructions and context cost. Today users choose the target agent, and there is no general autonomous delegation protocol. This means “multiple agents” does not imply that the agents negotiate a joint plan. See the [relationship model](../02-commands-and-concurrency.md#many-to-many-sharing-is-a-relationship-model).

## What would break if users could change thread members or agent models while work is running?

The current implementation treats membership, agents and workspace configuration as fixed for a store. Allowing edits during active work would introduce new authorization and recovery decisions, so incompatible reopen is rejected instead of silently adopting the new configuration.

For example, removing Bob would need a policy for his already accepted command and open streams, while replacing A's model would need a policy for queued work and pinned requests. An extension would need versioned configuration, consistent enforcement and migration/recovery tests. Simply changing a JSON file and restarting could reinterpret old persisted work. See [configuration bounds](../02-commands-and-concurrency.md#bounds-fairness-and-fixed-configuration) and the [revocation question](06-security-and-api.md).

## Why retain Chord and optional Effect dependencies if framework dependence was a concern?

The chosen scope adds collaboration using the existing durable runtime while isolating adapter-specific interfaces. It does not claim to remove all framework dependence, because Chord remains underneath Durable and the optional Codex adapter uses Effect/platform.

A full replacement would require reimplementing or changing persistence, scheduling, observation and recovery before validating the collaboration behavior. The current plain driver contract and public package boundary make later replacement more manageable, but they do not make persisted stores automatically portable. Explain the trade-off as delivery risk versus a broader architectural rewrite, with behavior tests as a reference for later changes. See [the alternative approach](../01-architecture.md#framework-dependence-and-the-alternative-approach).

## Which parts did this project add, and which parts already existed or came from T3?

The new work adds collaborative admission/policy, external-task integration, the Codex bridge, a managed-file experiment and a thin demo host. Existing Pi code supplies model access, core transactions, native generation, tools and storage; T3 supplies the vendored typed Codex client/protocol and replay machinery.

Be ready to point to [thread admission](../../packages/durable/src/collaboration/thread.ts), [external tasks](../../packages/durable/src/collaboration/external.ts) and [T3 provenance](../../packages/durable/src/adapters/codex/vendor/UPSTREAM.md). The copied T3 code is actually used, but its complete orchestration system and UI were not imported. The browser's visual hierarchy was informed by T3 and implemented separately. This distinction makes your contribution specific without presenting the entire fork as newly written work.

## How would you explain your own judgment when much of the implementation used AI assistance?

Explain the constraints and decisions you directed, then demonstrate that you understand the resulting behavior and evidence. AI-generated code and documentation do not remove responsibility for deciding what the system should guarantee.

Examples include choosing to evolve Durable itself, insisting on actual T3 reuse, questioning many-to-many sharing, identifying file-race limits and choosing the OpenAI/Ollama default. Walk through one command and one crash or conflict without relying on memorized labels. Distinguish those design choices from implementation help and reused upstream work, and avoid inventing a development timeline or claiming all code was written manually. See the [ownership drill](../08-interview-drills.md#how-do-you-explain-ai-assisted-development).
