# Collaboration awareness, visible progress and enforced edits

An agent now receives a short reminder that other people and agents share its workspace. The browser also shows observed work and a controlled file-conflict walkthrough. These additions address different problems: understanding a change, seeing progress, and deciding whether a proposed write is safe to apply.

This page records the November 10 implementation. Read it alongside [file conflicts](04-files-and-conflicts.md), [web demonstrations](06-web-and-demonstration.md) and the [new interview questions](interview-questions/09-collaboration-awareness.md). Deterministic tests establish the supplied context and file behavior; they do not establish that every real model will follow the guidance.

## The problem: remembered work can disagree with the current file

Suppose Ollama writes a blue button and GPT later changes it to green. When Ollama reads green, its private conversation only explains blue, so it might assume its earlier edit failed. We now tell it that peer edits are possible and that the current file must be checked before making another change.

The instruction is to describe observed differences without guessing their author, preserve unrelated changes, and ask the user when requirements conflict. This reduces misleading reasoning such as “I must have made a mistake; restore blue.” It does not provide a complete history of who changed each line, and an agent can still misunderstand the instruction. Separate histories are retained to avoid filling every agent's input with irrelevant or conflicting peer conversations.

```mermaid
sequenceDiagram
  participant O as Ollama
  participant F as Shared file
  participant G as GPT
  O->>F: Write blue
  G->>F: Change blue to green
  Note over O: Next model request receives shared-workspace guidance
  O->>F: Reread before editing
  F-->>O: Green
  Note over O: A peer may have changed it; do not assume an earlier mistake
```

## What the model receives and when

Native Pi agents receive refreshed collaboration context before each model request, including the next request after a tool result. The context identifies the agent and participants and includes a small number of request references. It does not include other agents' prompts, answers or full tool history.

The host builds the `collaboration` prompt section from saved thread state and the current native run. Bounds are eight member IDs, eight agent identities, four active request references and six recently accepted request references; identifiers are clipped to 64 characters, with full roster counts retained. Accepted order describes admission, not completion or file authorship. Existing stores acquire this section through the updated runtime without a configuration reset. External adapters receive the context when a turn opens or resumes; an already-running external harness is not continuously updated. See [context implementation](../packages/durable/src/collaboration/context.ts) and [installation/external turn handling](../packages/durable/src/collaboration/external.ts).

## The communication cost and the trust boundary

This adds a bounded amount of input to model requests, rather than broadcasting every conversation to every agent. It requires no extra model call, but the extra input tokens and local context updates still have a cost. We have not measured the token, latency or prompt-cache impact yet.

The metadata comes from the host's saved records; peer prose is not promoted into system instructions. That distinction avoids turning Bob's ordinary message into policy for Alice's agent. Metadata still does not grant authority: an agent naming Alice cannot authenticate as Alice, and a recent accepted request cannot prove that Alice last wrote a file. The existing host authentication and package membership checks remain responsible for permissions. See [trust boundaries](05-providers-adapters-and-trust.md#authentication-membership-and-authority).

## Why this does not completely solve stale context

Awareness helps an agent question its old assumptions, and rereading gives it current file contents at that moment. Another writer can still change the file between that read and the later write. A reliable refusal of a stale proposal needs an enforced check at publication, not only a prompt.

This gap is called **time of check to time of use**: the assumption was true when checked, then became false before the action. For example, Ollama reads green, GPT changes green to red, then Ollama writes a replacement based on green. Managed publication can reject that replacement when all writers use its protocol; ordinary tools, shell commands and Codex can bypass it. The current single-file check also does not validate every other file used to plan a change. See [managed publication](04-files-and-conflicts.md#managed-publication-and-optimistic-concurrency-control).

| Layer | Concrete benefit | Remaining limit |
| --- | --- | --- |
| Shared-workspace guidance | Do not assume every difference is your own mistake | Model may ignore or misunderstand it |
| Reread relevant files | Replace an old view with current bytes | Another writer may act afterward |
| Managed publication | Reject a proposal whose retained base no longer matches | Cooperative single-file path; bypass writers remain possible |
| Activity feed | Show observed requests and native tool outcomes | Not a complete audit log or proof of file authorship |

## What the browser now shows

The activity feed makes requests and saved native tool activity visible without inventing a percentage complete. The separate conflict panel lets Alice and Bob prepare edits, publish in a known order and explicitly resolve a refused stale edit. Live generation uses natural-language prompts in separate tool-free conversations without changing the file, while preview uses fixed samples without a model key.

The feed retains 64 distinct observations in page memory; snapshots contain eight recent receipts and up to 24 native tool records from 20 recent entries. Tool records belong to the agent when the initiating request cannot be attributed reliably. The conflict panel has its own saved store and workspace, retains up to 64 rounds, and offers Reset to restore a neutral file and default prompts for both users. Old-round actions are refused, and old generation runtimes close; normal coding lanes remain untouched. Only the stale proposal's owner can submit its resolution; observers see the result. A pending or uncertain write blocks new mutations instead of silently retrying. See [GUI controls](../apps/collab-demo/README.md#show-a-concrete-conflict-and-its-resolution) and [web evidence](06-web-and-demonstration.md).

## What is tested and what to demonstrate next

Tests verify refreshed context, actual peer file changes and reopening an existing SQLite store without replacing its fixed configuration. Scripted browser checks also verify stale refusal, explicit resolution and the resulting bytes. A new live OpenAI/Ollama check is still needed to evaluate whether the models interpret the guidance usefully.

The latest recorded checks were 68 focused Durable tests across seven files and 48 demo tests across thirteen files, plus root/app checks and the Durable build. These are selected boundaries, not a claim that every repository test ran. For a live rehearsal, ask Ollama to create a small disposable file, have GPT change it, then ask Ollama to reread and describe the difference without restoring its earlier version. Inspect the file separately; do not treat a sensible answer as proof of enforced conflict prevention. Existing OpenAI credentials and the local Ollama service suffice; cloud testing additionally requires deploying the updated revision and confirming access.
