# Questions about collaboration awareness and visible work

These questions connect the newest features to the original collaboration design. Start with what the system actually tells an agent or shows a user, then distinguish that information from an enforced file-write rule.

Use [the implementation explanation](../10-collaboration-awareness.md) for the complete trace, limits and source links. The controlled conflict GUI is implemented locally; live model interpretation and updated GCP behavior remain separate verification tasks.

## Why did Ollama think GPT's change was its own mistake?

Ollama could see the current file but its own history only explained its earlier version. It had insufficient context to distinguish a failed edit from someone else's later change. We now explicitly tell agents that peers and humans can change their shared workspace.

For example, after Ollama writes blue and GPT changes it to green, Ollama should reread and describe green without claiming to know who wrote it. The refreshed native prompt includes a bounded roster and request references, not peer conversation text or a verified file-author log. That improves its reasoning conditions without promising a correct interpretation on every run. See [the concrete trace](../10-collaboration-awareness.md#the-problem-remembered-work-can-disagree-with-the-current-file).

## Why not send every agent the full history of every other agent?

Most peer conversation is irrelevant to the next edit, and repeating it would grow model input and expose conflicting instructions. A small shared-workspace policy and recent request references are enough to establish that the agent is not alone. Users still choose which agent receives their actual instructions.

This is a bounded-context design: native context is refreshed before each model request, while external turns receive it at open/resume. There is no extra model call or peer broadcast; there are extra input tokens, local state reads and prompt-section updates. Token cost, cache effects and latency have not yet been measured. Roster truncation is disclosed with full counts; these references are not a general autonomous coordination protocol. See [cost and trust](../10-collaboration-awareness.md#the-communication-cost-and-the-trust-boundary).

## Does rereading before writing guarantee that an edit is current?

No: it makes the file current at the instant of the read. GPT can change it again before Ollama writes. The managed-file path checks the retained base at publication and refuses an outdated proposal, while ordinary agent writes still lack that guarantee.

This is the time-of-check-to-time-of-use gap. Prompt guidance helps avoid unnecessary reverts but is not mutual exclusion or optimistic concurrency control; those mechanisms constrain writes. Even cooperative destination checking does not validate all files used by a multi-file plan, and a raw shell write can bypass the protocol. Explain these layers separately rather than saying the stale-context problem is solved. See [the layered comparison](../10-collaboration-awareness.md#why-this-does-not-completely-solve-stale-context).

## Can the activity feed tell me who changed a particular line?

It shows attributed requests and saved native tool summaries, not a complete record of file changes. A tool request is evidence that the agent requested an operation, and a result records that tool's outcome. Neither establishes that the final code meets the user's requirement or identifies every later writer.

Several inputs can be part of a native run, so tool summaries stay agent-scoped instead of guessing a single user request. The page retains bounded observations and can miss transitions while disconnected; it does not expose raw tool arguments/results. File authorship would need a separately designed effect record tied to trusted request identity, with explicit treatment of shell and external writes. See [activity semantics](../06-web-and-demonstration.md#what-the-activity-feed-means).

## Is the conflict demonstration a real solution or just a simulation?

It exercises the real managed-file API, SQLite and actual file bytes, with presenter-controlled publication. The live host generates proposals from custom prompts using configured native models, while preview keeps fixed samples. Alice can publish first, Bob's stale edit is refused, and explicit resolution demonstrates the narrow protection without claiming that ordinary coding agents use it.

Both users authenticate separately and can prepare/publish only their own proposal. The panel is isolated from the live agents' workspace, persists each round and restores the active evidence after reconnect. Reset creates fresh defaults/file state and rejects old-round requests; up to 64 rounds are retained. Proposal generation has no file tools and uses separate participant conversations, even with the same selected model. The next integration step is managed model-facing tools with trusted request binding and a policy for bypass writes; adding buttons alone cannot enforce that policy. See [walkthrough behavior](../06-web-and-demonstration.md#how-the-scenario-panel-demonstrates-a-conflict).
