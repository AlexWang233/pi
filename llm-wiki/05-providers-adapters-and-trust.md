# Providers, external adapters and trust

A model provider supplies inference, while an agent harness owns the loop around inference, tools and sessions. This project supports native Pi providers and a separate external Codex adapter, with different dependency and recovery boundaries.

Keep that distinction clear when discussing “multi-agent” or “multi-provider” support. OpenAI plus Ollama exercises two native provider lanes; it does not itself exercise a second external harness.

## The native provider path

Native Pi uses existing Pi AI factories for OpenAI, Anthropic, Google and DeepSeek, with an app-composed Ollama provider for local testing. Registering factories or finding model IDs in the catalog does not prove live account access.

The current default selects OpenAI `gpt-5.4-mini` and local Qwen3 4B through Ollama; the user has manually confirmed the hosted lane now works after a credit issue. The local backend is configured for one inference at a time, 8192 context tokens and 1024 output tokens, so independent agents still share one constrained resource. MiniLM embeddings were unsuitable because sentence embeddings do not exercise streamed chat/tool calls. A smaller earlier local coding model reported completion without creating its requested file, which justified independently asserting actual outcomes. [Provider composition](../apps/collab-demo/src/startup.ts), [Ollama implementation](../apps/collab-demo/src/ollama.ts), [local evidence](../apps/collab-demo/LOCAL_MODELS.md).

## The external harness contract

An external driver opens a session, runs a cancellable turn with progress, and closes its resources. Durable owns admission, task ordering and conservative dispatch recovery, while the external harness owns its own tool loop and provider session.

The plain `ExternalAgentDriver` contract passes workspace, agent/model configuration, instructions and a private continuation reference. Successful external work stores the continuation for later commands; it is not a browser credential or proof that a live resumed turn was verified. Missing driver registration fails visibly instead of silently substituting native Pi. Adding another harness requires lifecycle, cancellation, interaction and recovery evidence, not merely another model name. [Public contracts](../packages/durable/src/collaboration/types.ts).

## Exactly what T3 contributed

The Codex adapter executes vendored T3 typed app-server client/protocol code and uses T3 replay support in tests. The complete T3 application, orchestration system, credential management and frontend were not imported.

The provenance file records upstream revision `d5fc29fe5cb62db68bfbf824cfabe0ae94ac6ac4`, copied paths, fixture adaptations and MIT notices. Vendor sources retain provenance while still participating in type/dependency checks, and notices ship in built output. The optional Node adapter is imported through `/adapters/codex`, isolating Effect/platform peers from generic collaboration imports. This is actual runtime reuse, while the browser's T3-inspired layout is separately authored DOM/CSS. [Provenance](../packages/durable/src/adapters/codex/vendor/UPSTREAM.md), [adapter entry](../packages/durable/src/adapters/codex/index.ts).

## Protocol correctness matters beyond spawning a CLI

A correct adapter must correlate the active root turn, handle early notifications and close resources after interruption. A completed tool item or unrelated start notification must not settle the wrong user command.

Scripted subprocess tests reproduced and fixed two bridge issues: later notifications could retarget the active turn, and teardown could race fire-and-forget interrupt delivery. The adapter now pins turn identity and awaits a bounded interrupt exchange before cleanup. Known interactive approval/user-input requests fail visibly because shared approval arbitration is not implemented; policy `never` is not an approval UI. Replay/scripted processes establish these protocol rules, whereas real CLI initialization alone establishes neither authenticated coding nor live continuation. [Session bridge](../packages/durable/src/adapters/codex/session.ts), [process tests](../packages/durable/test/codex-process.test.ts).

## Authentication, membership and authority

Bearer tokens authenticate demo users at the host, and Durable checks their stored thread membership. Every member intentionally has access to every agent's history and lane controls, so this is a trusted shared project rather than private per-user conversations.

Alice/Bob tokens are distinct saved user passwords, not model-provider keys. Passing the string `alice` directly to the library does not authenticate Alice; only the trusted host should supply it. The prototype has no token expiry, dynamic revocation, per-agent roles, moderated guests or first-responder approval decisions. Adding those requires enforcement on reads, streams, commands and decisions together, not just hiding a button. [Host policy](../apps/collab-demo/src/startup.ts), [membership checks](../packages/durable/src/collaboration/state.ts).

## Secrets, rendering and the execution boundary

Browser tokens stay in page memory and authorization headers, while provider keys live in the host environment or ignored app-local `.env`. These choices reduce accidental exposure but do not isolate a coding agent from host credentials.

The client renders text literally rather than executing model-produced HTML, and file inspection checks membership and rejects disallowed paths/links. Nevertheless, trusted tool/shell execution can access the service account's environment and filesystem; concurrent path replacement also defeats any claim that path hygiene is an OS sandbox. Prompts and file content can persist sensitive information, and bounded error details would still need careful rendering and secret handling. Public untrusted hosting requires real identity, secure transport, enforced process/filesystem boundaries and credential minimization. [File inspection](../apps/collab-demo/src/workspace-files.ts), [risk register](../apps/collab-demo/PROBLEM_SCENARIOS.md).

## Configuration checks versus real provider diagnosis

Preflight validates local declarations and required key presence without making an API call or opening runtime data. A passed preflight cannot establish valid credentials, credit balance, model permission, provider availability or Ollama readiness.

The actual OpenAI failure reported exhausted credits even though `.env` was correctly loaded; the user later confirmed it worked. This is a useful debugging trace: inspect the retained provider failure before rotating keys or changing dependencies. Native command status can currently show only `model_error` while the detailed provider error remains stored, so exposing a bounded useful failure detail is a recorded UI improvement. Another local failure came from system Node 22.12 lacking default SQLite availability, which was resolved by using prepared Node 22.23.4 and adding an early runtime check. These were separate configuration/runtime/billing layers, not one generic “LLM failed” problem. [Preflight](../apps/collab-demo/src/preflight.ts), [runtime check](../apps/collab-demo/scripts/check-runtime.mjs).
