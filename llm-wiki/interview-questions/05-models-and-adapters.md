# Questions about models and external harnesses

These questions distinguish model credentials from agent identity and provider requests from an external coding harness's own loop. They also explain why a successful API call or CLI startup is narrower evidence than a complete coding workflow.

Review [providers, adapters and trust](../05-providers-adapters-and-trust.md) for the overall boundary. The current default uses native OpenAI and Ollama; the external Codex composition remains a separate option.

## If two agents use the same OpenAI key and model, are they actually the same agent?

They can share credentials and inference settings while remaining different agent identities with separate conversations and queues. The model service is a shared resource, while the runtime's conversation state determines each agent's history.

For example, A and B can both call the same model while only A sees its own earlier transcript. Both still share workspace files in the same thread, so separate context does not isolate edits. The same API account can also impose shared cost or rate limits on otherwise independent lanes. Local Ollama makes that resource distinction visible: its single inference slot can serialize requests even though the collaboration runtime has two agents. See [the relationship model](../02-commands-and-concurrency.md#many-to-many-sharing-is-a-relationship-model).

## Why does supporting an OpenAI-compatible endpoint not automatically prove every local model works?

A compatible HTTP interface does not guarantee identical tool-calling behavior, role support, streaming events or token-parameter semantics. The local composition declares selected capabilities and still needs actual outcome checks for the chosen model.

The Ollama provider configures a loopback endpoint and compatibility settings, while the model must produce usable tool calls. An earlier small local model returned completed responses without creating the requested file; Qwen3 passed file assertions. That is why a connection test, a parsed response and a successful coding task are different results. The app does not discover or certify arbitrary local model capabilities. See [local-model evidence](../../apps/collab-demo/LOCAL_MODELS.md) and [provider composition](../../apps/collab-demo/src/ollama.ts).

## Preflight says the configuration is valid, so why can the first OpenAI instruction still fail?

Preflight checks local configuration and required key presence without contacting the provider. It cannot establish account credits, endpoint permissions, model access or live network availability.

The project's real failure was a provider message reporting no credits, despite `.env` loading correctly; the user later confirmed service worked. A useful diagnostic sequence separates environment loading, authentication, billing/access, request formatting and tool outcomes. Read the retained provider error before changing the model or rotating keys. The current generic `model_error` display is less informative than the stored diagnostic and is a recorded UI improvement. See [the diagnostic trace](../05-providers-adapters-and-trust.md#configuration-checks-versus-real-provider-diagnosis).

## Codex emits a completed tool item: why shouldn't the adapter mark the user's command completed immediately?

A tool/item completion can be only one step within a larger Codex turn. The adapter must wait for the correlated root turn outcome instead of treating any successful sub-event as the final answer.

Events can also arrive before the start response or contain unrelated turn IDs. The bridge pins the active turn, handles early events and rejects a start mismatch rather than selecting a convenient result. Scripted subprocess tests reproduced wrong-turn completion and verify the corrected behavior through the actual T3 client. This is why spawning a CLI and printing stdout would not be enough for a reliable adapter. See [protocol correctness](../05-providers-adapters-and-trust.md#protocol-correctness-matters-beyond-spawning-a-cli).

## What happens if Codex asks the users to approve a command or answer a question?

The current adapter does not implement a shared approval or interactive-question workflow. Known requests fail visibly rather than being silently approved or routed to an arbitrary viewer.

An approval feature would need a persistent decision identity, eligible responders, expiry and one chosen rule for conflicting responses. It would also need to handle the case where a decision is stored but its delivery to Codex fails. “First valid response wins” is one possible policy, not current behavior. A future permission screen must also distinguish approval from proving a command is safe or undoing its effects. See [the risk register](../../apps/collab-demo/PROBLEM_SCENARIOS.md).

## What is saved so a later Codex command can continue the same external conversation?

A successful external result can store a private continuation reference identifying the provider-side thread. That reference is neither a saved process nor proof that an uncertain interrupted turn can safely be resumed.

The next command can use the stored reference when opening the driver, while the adapter manages its process/session lifetime separately. Recovery after an uncertain dispatch still follows the conservative interruption rule instead of guessing that continuation means nothing happened. Scripted tests cover resume protocol selection, but a real authenticated Codex continuation has not been established by the recorded initialization test. See [external recovery](../03-durability-and-recovery.md#why-uncertain-external-turns-are-not-automatically-resent) and [the driver contract](../../packages/durable/src/collaboration/types.ts).
