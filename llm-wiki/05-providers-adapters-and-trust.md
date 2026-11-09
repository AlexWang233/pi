# Providers, external adapters and trust

A model service supplies answers, while an agent system decides when to ask the model and which tools to run. Pi can call several model services itself, or Durable can connect to an external agent system such as Codex.

Keep that distinction clear when discussing “multi-agent” or “multi-provider” support. OpenAI plus Ollama uses two model providers through Pi; it does not itself exercise a second external harness. See the [provider/harness diagram](09-technical-terms.md#provider-model-agent-harness-and-adapter), [command versus root turn](09-technical-terms.md#command-submission-turn-task-and-tool-call), and [authentication versus authorization](09-technical-terms.md#authentication-authorization-and-the-execution-boundary).

## The native provider path

Pi already knows how to call model services including OpenAI, Claude, Gemini, and DeepSeek, and the demo also supports local Ollama. The default uses OpenAI plus Ollama, but having a provider in the configuration does not prove its account or selected model works.

A **provider** is the service Pi sends model requests to. The default selects OpenAI `gpt-5.4-mini` and local Qwen3 4B; the user confirmed OpenAI works after an earlier credit problem. Ollama processes one model request at a time here, with an 8192-token context and 1024-token output limit (tokens are chunks of text). MiniLM produces text embeddings, numerical descriptions useful for similarity search, rather than the conversational tool use needed here. An earlier small coding model said it finished without creating the file, so live checks inspect actual files. See [provider composition](../apps/collab-demo/src/startup.ts), [Ollama implementation](../apps/collab-demo/src/ollama.ts), and [local evidence](../apps/collab-demo/LOCAL_MODELS.md).

## The external harness contract

An external agent such as Codex manages its own conversation with a model and its own tool calls. Our connection opens a session, sends an instruction, reports progress, supports a stop request, and closes resources afterward.

That agent system is a **harness**, and the connection implementing our interface is a **driver** or **adapter**. The `ExternalAgentDriver` contract receives the workspace, agent settings, instruction, and a private reference for continuing an earlier conversation. Durable still owns request acceptance, task order, and recovery decisions; Codex owns its internal tool loop. A missing driver fails visibly rather than falling back to Pi, and another harness needs its own lifecycle and failure tests. See [public contracts](../packages/durable/src/collaboration/types.ts).

## Exactly what T3 contributed

We reused T3's Codex communication code and its recorded-message testing support, rather than copying the entire T3 app. The browser layout takes visual ideas from T3 but was written separately.

The provenance file records upstream revision `d5fc29fe5cb62db68bfbf824cfabe0ae94ac6ac4`, copied paths, fixture adaptations and MIT notices. Vendor sources retain provenance while still participating in type/dependency checks, and notices ship in built output. The optional Node adapter is imported through `/adapters/codex`, isolating Effect/platform peers from generic collaboration imports. This is actual runtime reuse, while the browser's T3-inspired layout is separately authored DOM/CSS. [Provenance](../packages/durable/src/adapters/codex/vendor/UPSTREAM.md), [adapter entry](../packages/durable/src/adapters/codex/index.ts).

## Protocol correctness matters beyond spawning a CLI

Starting Codex is only the first step: its messages must be matched to the right user instruction. A tool finishing does not mean the entire instruction is finished, and an unrelated message must not complete the wrong request.

The adapter tracks the active **root turn**, meaning Codex's overall response cycle for the instruction, rather than an individual file/tool step. Scripted subprocess tests caught two problems: unrelated notifications could change the tracked turn, and cleanup could start before the stop message was delivered. The fixes pin turn identity and await a bounded interrupt exchange before closing resources. Approval or question requests fail visibly because shared decision handling is not implemented. Tests with scripted processes and real CLI startup do not establish an authenticated real Codex coding turn or continuation. See [session bridge](../packages/durable/src/adapters/codex/session.ts) and [process tests](../packages/durable/test/codex-process.test.ts).

## Authentication, membership and authority

The web server recognizes Alice or Bob from a saved login token, then Durable checks whether that person belongs to the thread. All members can see and control all configured agents, so this is a shared trusted project, not private conversations for each person.

Alice/Bob tokens are distinct saved user passwords, not model-provider keys. Passing the string `alice` directly to the library does not authenticate Alice; only the trusted host should supply it. The prototype has no token expiry, dynamic revocation, per-agent roles, moderated guests or first-responder approval decisions. Adding those requires enforcement on reads, streams, commands and decisions together, not just hiding a button. [Host policy](../apps/collab-demo/src/startup.ts), [membership checks](../packages/durable/src/collaboration/state.ts).

## Secrets, rendering and the execution boundary

Login tokens stay in the browser page's memory, and model keys stay on the server, usually in the ignored app-local `.env`. This reduces accidental exposure, but an agent allowed to run shell commands can still reach files and environment values available to the server account.

The client renders text literally rather than executing model-produced HTML, and file inspection checks membership and rejects disallowed paths/links. Nevertheless, trusted tool/shell execution can access the service account's environment and filesystem; concurrent path replacement also defeats any claim that path hygiene is an OS sandbox. Prompts and file content can persist sensitive information, and bounded error details would still need careful rendering and secret handling. Public untrusted hosting requires real identity, secure transport, enforced process/filesystem boundaries and credential minimization. [File inspection](../apps/collab-demo/src/workspace-files.ts), [risk register](../apps/collab-demo/PROBLEM_SCENARIOS.md).

## Configuration checks versus real provider diagnosis

The startup check can confirm that configuration looks valid and a key is present without calling OpenAI. It cannot confirm that the key is valid, the account has credit, or the model service is available.

This offline check is called **preflight**. The actual OpenAI failure was an account-credit error even though `.env` loaded correctly; the user later confirmed it worked. The UI can currently show generic `model_error` while the detailed provider error is stored, so exposing a safe, limited diagnostic is planned. A separate startup problem came from old system Node lacking default SQLite support; prepared Node 22.23.4 and an early runtime check addressed that. Distinguish local configuration, runtime support, authentication, billing, and actual tool results when debugging. See [preflight](../apps/collab-demo/src/preflight.ts) and [runtime check](../apps/collab-demo/scripts/check-runtime.mjs).
