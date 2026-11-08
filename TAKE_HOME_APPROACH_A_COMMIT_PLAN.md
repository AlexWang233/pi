# Commit plan: evolve Pi Durable with collaborative multi-harness execution

Implement the feature **inside the user's fork of `packages/durable`**, with a T3-backed Codex adapter in the same package and a thin demo application. This replaces the prior application-owned runtime/queue plan. The [implementation plan](TAKE_HOME_IMPLEMENTATION_PLAN.md) defines architecture and guarantees; this document defines reviewable coding increments.

Budget: **18 hours of work/checks/deployment/reporting plus 2 hours contingency**. Estimates are aggressive; use the early integration gates. This document proposes Git commits but does not authorize creating commits now.

## Ownership and proposed paths

| Location | What is built there |
| --- | --- |
| `packages/durable/src/collaboration/types.ts` | Plain thread/agent/command data, tagged states, external-session contract |
| `packages/durable/src/collaboration/thread.ts` | Package-owned membership, workspace, agent/conversation mapping and opening |
| `packages/durable/src/collaboration/commands.ts` | Atomic admission, receipts, limits, status, lane stop |
| `packages/durable/src/collaboration/external.ts` | Registered task for external queue/dispatch/settlement/recovery |
| `packages/durable/src/collaboration/view.ts` | Common bounded native/external observations and history projection |
| `packages/durable/src/collaboration/index.ts` | Public collaboration entry point |
| `packages/durable/src/adapters/codex/` | T3 client/session integration, vendored source closure and attribution |
| `packages/durable/test/` and `test/examples/` | Feature tests and standalone reference examples proving package behavior |
| `packages/durable/docs/spec.md`, README, package exports | Fork's documented contracts and supported import paths |
| `apps/collab-demo/` | Authentication/HTTP/SSE/client plus load/deploy scripts; no independent execution queue |

These filenames/public symbol names are proposals, to finalize after reading edited source in full. Reuse Harness/Session transactions, documents, tasks, inbox, watches, and native generation. Do not create a new runtime package, parallel scheduler, or separate receipt database. Changes to existing internal files are justified by a concrete integration need, not by file-count targets.

Add `/collaboration` and `/adapters/codex` subpaths to the existing Durable package. Keep generic collaboration APIs free of T3/Effect types and optional Node adapter imports. Use exact optional peers plus development dependencies for adapter-only Effect libraries, verifying repo dependency/build/entry-graph checks support the arrangement. The generic entry must run without loading the adapter. Chord remains internal; removing it is later work.

Each thread has one Harness/store and shared directory, with named native Pi and external Codex lanes. They share files but retain separate histories. Only Pi uses native generation; Codex owns its own tool/model loop. The package accepts a host-verified caller ID and enforces stored thread membership. The server verifies tokens and passes identity through.

## Commit overview

| Commit | Suggested message | Time | Cumulative |
| --- | --- | --- | --- |
| 1 | `docs: specify collaborative threads and external execution in Durable` | 0.75 h | 0.75 h |
| 2 | `feat: add a T3-backed Codex adapter to Durable` | 2 h | 2.75 h |
| 3 | `feat: add durable collaborative threads and targeted commands` | 2 h | 4.75 h |
| 4 | `feat: execute external agent commands through Durable tasks` | 2.5 h | 7.25 h |
| 5 | `feat: unify collaborative agent views and cancellation` | 2 h | 9.25 h |
| 6 | `feat: demonstrate collaborative Durable over HTTP and SSE` | 2 h | 11.25 h |
| 7 | `fix: recover collaborative commands without replaying uncertain turns` | 1.75 h | 13 h |
| 8 | `feat: deploy the collaborative Durable fork on GCP` | 2 h | 15 h |
| 9 | `feat: measure collaborative runtime limits and failure behavior` | 2 h | 17 h |
| 10 | `docs: document the Durable extension and measured demo results` | 1 h | 18 h |

Every coding commit must compile, run its focused tests, and leave a usable increment. Split further if needed; do not commit broken intermediate wiring. Reserve 2 hours for extraction/auth/deployment failures and one measured defect. Defer dynamic administration, live steering, individual queued-message withdrawal, terminal/Markdown rendering, and UI polish.

## Commit 1: specify the package feature

**Write**

- Read the relevant Durable implementation and normative [spec](packages/durable/docs/spec.md) before extending its behavior. Read native [atomic submit](packages/durable/test/examples/34-submit-in-commit.ts) and [task](packages/durable/test/examples/11-tasks.ts) examples.
- Add a focused collaborative/external-execution section to `packages/durable/docs/spec.md`, documenting thread/member/agent/command identity, transaction boundaries, shared workspace, independent histories, follow-up/stop semantics, capability reporting, and native-versus-external recovery.
- Decide the smallest facade over an existing Harness that exposes open thread, submit, status, history, watch, and stop. Record API sketches as proposed contracts, not existing exports.
- Specify admission atomically with executable intent, a persisted external dispatch marker, root-versus-tool completion, missing drivers, and late-event rejection. Document which existing primitives are reused and why the external lane needs a package-managed queue instead of the native model inbox.
- Confirm real Pi model access, Codex CLI/auth availability, and GCP project access as early prerequisites. Do not store credentials in docs or source.

**Review / done**

- Trace two users submitting to one busy agent and two different agents; trace retry after a lost HTTP reply and crash after an external side effect. Every durable decision has a package owner.
- No code tests are necessary for this documentation-only commit. No changelog entry on the current `dev` branch.

## Commit 2: reuse T3 code as a Durable adapter

**Build**

- Add `packages/durable/src/adapters/codex/index.ts` and `session.ts`. Define the minimal external-session contract in collaboration types as needed: open/start turn, normalized progress/outcome, interrupt, close. Keep Effect scope/fibers and Codex native IDs private.
- Vendor the required runtime source from T3's [effect-codex-app-server](../t3code/packages/effect-codex-app-server/package.json): typed client, protocol/errors, local helpers, and generated schemas/metadata. Keep source under the adapter so Durable's `rootDir: src` build remains coherent.
- Preserve the [MIT license](../t3code/LICENSE), source commit `d5fc29fe5cb62db68bfbf824cfabe0ae94ac6ac4`, copied paths, and local patch record. Include notices in packaged output. Reuse replay support in the test dependency closure; do not ship unnecessary T3 app/toolchain code.
- Add `/adapters/codex` exports and exact adapter dependency metadata. The inspected T3 workspace uses `effect`/`@effect/platform-node` `4.1.2`; inspect installed types and prove compatibility rather than guessing. Refresh the lockfile with scripts disabled and inspect the diff.
- Initialize a session, start thread/turn, normalize progress/root outcome, interrupt, and dispose its scope/process tree. Use typed notification handlers for correctness-sensitive events, not potentially lossy diagnostic streams. Keep raw protocol logging disabled for the demo.

**Test / example / done**

- `packages/durable/test/codex-session.test.ts`: use T3 [replay transport](../t3code/packages/effect-codex-app-server/src/replay.ts) and adapted [simple recordings](../t3code/apps/server/src/orchestration-v2/testkit/fixtures/simple/codex_transcript.ndjson) to verify initialization/turn exchange, output, interrupt, terminal failure, and consumed expected outbound frames.
- Use a fake child process for framing/exit/disposal tests; replay alone does not prove OS process management.
- Add a runnable adapter example under `packages/durable/test/examples/`, with the next unused number and run instructions. Provide an explicit real-CLI mode/example requiring private authentication, not an automated paid test.
- Verify initialization against a real CLI and pin the tested version. The inspected fixture's `0.156.1` is a compatibility clue, not a universal version recommendation. Record any inability to authenticate before proceeding.

**Gate:** extraction and basic replay must work by roughly hour 3. Resolve missing imports/version mismatches now, using reserve if necessary. Do not quietly substitute a reference-only mention of T3 or a Pi-only deliverable.

## Commit 3: package-owned threads and command admission

**Build**

- Add collaboration `thread.ts`, `commands.ts`, and `index.ts`; expose `/collaboration` in `package.json`. Use package-owned typed documents for thread members/workspace, agent mapping, command receipt identity, and external pending intent.
- Idempotently create named agent conversations. Keep them independent owners so stopping one does not cancel the other. Native execution settings and external driver names are tagged serialized data, with live implementations registered separately.
- Add open thread, targeted submit, and command status. Check authenticated caller membership inside package admission, scope IDs by caller/agent/thread, compare normalized payloads, and check duplicates before limits.
- Native input uses existing `submit(tx, draft)` once before table writes, with attribution and receipt mapping committed together. Keep its existing inbox; do not create another queue for native work.
- External admission atomically records input, pending queue intent, receipt, and driver-task identity. Use an executing deterministic driver fixture for this increment; the actual lifecycle connects in commit 4. Rollback leaves no executable intent.
- Keep receipt state bounded by a small configured lifetime command cap. Persist membership/configuration consistently across reopen; reject incompatible replacement configuration instead of silently changing identities.

**Test / example / done**

- `test/collaboration-thread.test.ts`: initialization/reopen, shared directory, agent isolation, membership checks, configuration mismatch.
- `test/collaboration-commands.test.ts`: concurrent duplicate admission, conflicting ID payload, user/lane scoping, capacity and duplicate-at-cap, retry after reopen, callback rollback, and one driver claim.
- Add a standalone attributed multi-user example importing Durable only. No HTTP server is needed to accept and observe commands.

## Commit 4: external execution is a Durable mechanism

**Build**

- Add `src/collaboration/external.ts`, registering its task through existing Durable machinery. The package owns queue claims, active task identity, invocation, settlement, and progression; there is no application worker/scheduler.
- Claim one external command per lane; persist native thread references and a dispatch marker before calling the adapter outside commits. Persist results/history on completion. Do not also run native generation on an external lane.
- On phase re-entry with a prior dispatch marker but no terminal result, settle interrupted and require explicit retry. Prove this with a persisted memo/state; a checkpoint phase name does not prevent resend.
- Handle root terminal events, duplicate/late notifications, process exit, missing driver registration, and unsupported interactions. A tool or child terminal cannot finish a root command.
- Configure the intended approval/sandbox behavior; reject unsupported approval/user-input requests visibly instead of hanging or silently approving. Full approval UI is deferred.
- Publish bounded external progress through package documents. Reuse existing output/deferred-persistence concepts where appropriate without pretending external output is native model context.

**Test / example / done**

- `test/collaboration-external.test.ts`: FIFO claiming, single active execution, correlated root outcomes, duplicate/late events, transport failure, missing driver, unsupported interaction, and conservative replay behavior.
- Use the real T3-backed client with replay input, not a fake replacement client that bypasses the reused implementation.
- Add a mixed-agent runnable package example. Barriers prove native Pi and external Codex are both active before release; deterministic distinct-file changes survive in their shared workspace. The demo app must not be imported.
- Manually complete real Pi and Codex coding tasks once model/auth access is available. Preserve replay evidence separately; replay success alone is not live integration.

## Commit 5: package views, stop, and useful limits

**Build**

- Add collaboration `view.ts`: common bounded snapshots/history and watches for attributed commands/messages, queued work, partial progress, tool summaries, failures, and capabilities. Keep native and external internals private.
- Report command outcome separately from lane idleness; native `afterRun` work may outlive the answer. External recovery must not be advertised as native transparent continuation.
- Implement lane-wide stop in package code, propagating to native tasks or external interrupt/cleanup. It withdraws queued input with a visible reason and leaves the other agent operating. Define the same visible failed-run queue policy.
- Enforce per-lane queue limits inside admission, body-independent command size/turn/deadline/output limits in the package, and explicit closed/unavailable behavior. A non-HTTP host must receive the same protections.
- For native shells enforce a maximum tool timeout; for Codex use turn deadlines and process/resource constraints. Native shell wrappers cannot control Codex's internal tool deadlines.
- Require explicit watch disposal and race-free initial state/updates. Socket buffering remains the demo's responsibility, but package observation cannot require a slow consumer to block durable execution.

**Test / example / done**

- `test/collaboration-view.test.ts`: initial attach, update-at-attach boundary, bounded previews, stable IDs, reconnect/history, capability differences, disposal.
- Extend command/external tests for stop versus completion, queue-capacity races, timeout, noisy output, and one-lane failure.
- The package-only mixed-agent example demonstrates status and stop. At roughly hour 9, this must be a usable Durable feature independently of the future demo.

## Commit 6: thin multi-user demo over HTTP/SSE

**Build**

- Add `apps/collab-demo` with its own package/check/test configuration. Root checks exclude apps. Use prepared Node/workspace builds; avoid another framework/toolchain.
- Add server composition/configuration, fixed token-to-user authentication, and routes for package submit/status/state/history/stop. Only package code owns receipts, queues, native/external dispatch, and recovery.
- Validate untrusted wire data and request bytes; derive caller identity from tokens and workspace paths from server configuration. Authorize streams/history through the package as well as commands.
- Return durable `202` acceptance, preserve command IDs across ambiguous retries, and keep HTTP request disconnection separate from explicit agent stop.
- Fan out one package watch per lane to bounded SSE buffers. Coalesce progress, flush terminal state, disconnect slow viewers, and reconnect with snapshots/history. Use fetch bearer headers rather than tokens in event URLs.
- Add plain two-lane HTML/JavaScript with input, queued/terminal state, stop, and reconnect. Render untrusted text using `textContent`. No rich UI or second runtime facade.

**Test / done**

- App `test/http.test.ts`: token/cross-thread rejection, malformed/oversize input, package error mapping, lost-response retry, and both lane types through identical routes.
- App `test/streams.test.ts`: two viewers, mid-run attachment, disconnect without cancelling work, slow reader, disposal, and reconnect without duplicate rendering.
- Test nontrivial client frame parsing/reconciliation; manually run two browser profiles with different users. Keep secrets in memory/private configuration, not URLs or committed files.

## Commit 7: crash and failure contracts in the package

**Build**

- Finalize restart reconciliation inside collaboration/external mechanisms. Restore stored configuration/IDs, detect missing driver code, and expose unavailable/blocked versus failed/interrupted outcomes.
- Preserve native recovery; queued external work can recover, but uncertain dispatched work is not resent. Safe Codex thread continuation for a later command requires verification or an explicitly fresh session.
- Close watchers/storage/adapters correctly. The host supervises process ownership and tears down the former execution tree before reopening for new writes. Do not add an uncontrolled reopen loop or claim distributed ownership.
- Update normative spec and examples to match verified behavior, including SQLite's process-crash guarantee versus host/power loss and uncertain filesystem effects.

**Test / done**

- `packages/durable/test/collaboration-recovery.test.ts` and child fixtures: kill before admission; after commit before reply; after dispatch marker before send; after external effect before terminal commit; and during native model/tool work.
- Assert receipt stability, no uncertain second Codex `turn/start`, proper queued-input settlement, and late-event rejection. Count native provider/tool rounds/retries separately from duplicate user commands.
- Inject storage failure in a disposable fixture: no false acceptance, later calls fail clearly, and failure remains scoped where possible. Verify subprocess cleanup on Windows and Linux rather than assuming parent exit kills children.

## Commit 8: deploy the fork on GCP

**Build**

- Add demo deployment scripts, service unit, secret-free configuration, and runbook. Use one Linux VM, persistent data disk, dedicated OS account, process-group-aware supervision, and one owner per thread store.
- Build modified Durable and the adapter, package required T3 notices, and install/pin the verified Codex CLI. Use `--ignore-scripts`; separately review/authorize any unavoidable lifecycle exception.
- Verify model/Codex access in the service OS environment, not merely the developer shell. Keep credentials outside workspace/logs. State trusted-team limitations.
- Bind locally and document evaluator SSH forwarding. Include mounting, restart/reboot, export/backup, billing awareness, and teardown of retained resources. Public HTTPS hosting is optional.

**Verify / done**

- Two viewers observe real Pi and Codex coding tasks on GCP in the same workspace. Replay-only deployment is not labeled a completed live integration.
- Restart/reboot and repeat receipt/history/recovery checks. Confirm old external descendants cannot survive and race replacement workspace writes.
- Verify from a fresh terminal using the runbook; record machine/runtime/CLI/commit versions. Target completion around hour 15.

## Commit 9: load, limits, and failure analysis

**Build / run**

- Add demo `load/run.ts` and normal host composition with deterministic Pi/T3 replay drivers and disposable data. Do not expose an HTTP test-mode switch.
- Exercise actual package-backed HTTP/SSE with isolated replay state per agent. Start one thread/two agents/two viewers, then five threads/ten agents/ten viewers; increase arrivals to find a measured limit. Run a roughly ten-minute soak below saturation and separate failure scenarios.
- Measure attempted/accepted/rejected/completed commands, queue/acceptance/completion/publication delay, CPU/RSS/event-loop/commit latency, process count, and recovery time. Include workload/output size, sample count, duration, configured bounds, machine and revision.
- Verify logical command starts and replay outbound consumption. Report allowed retries and multiple tool rounds separately. Real-provider smoke calls are manual, bounded, and outside automated stress runs.
- Add focused tests for any new pressure bug. If fixing a measured hotspot, create a separate `fix:` increment and repeat affected scenarios.

**Evidence / done**

- Healthy viewers proceed while a slow viewer is bounded/disconnected; queue/deadline/output caps are visible and tested.
- Distinct-file edits survive; demonstrate a same-file stale-write case. Durable's local edit queue does not protect against Codex or shell writers. No conflict-free shared filesystem claim.
- Identify the first measured bottleneck and VM/store/provider/process/observer failure domains. No unmeasured capacity claims.

## Commit 10: explain the evolved runtime and deliver it

**Write / verify**

- Finish Durable README/public API/spec additions, examples, T3 provenance/license record, and demo setup/design/results/demo docs. Document new adapter dependencies beyond the initial [environment setup](TAKE_HOME_ENVIRONMENT.md).
- Explain what changed **inside Durable**, what native behavior was reused, what T3 code actually executes, and what remains in the demo. Avoid claiming complete framework removal: Chord and adapter-local Effect remain.
- Rehearse eight minutes: package API/example, two users and concurrent harnesses, follow-up/stop/reconnect, distinct recovery outcomes, measured limits, and next steps.
- Follow clean setup/access/teardown instructions and identify deployed revision/manual versus automated checks. No changelog entry on current `dev`; no actual Git commit until the user authorizes it.

## Verification rules throughout coding

This revision modifies Markdown only. During implementation:

- Read edited source in full, update the normative Durable spec with the final behavior, and reread every changed file before reporting.
- Run `npm run check` with full output after code changes and fix diagnostics. Run the demo's own check because root TypeScript/Biome exclude apps. Keep generated/vendor type checking and explicit license/build coverage; do not casually suppress diagnostics.
- Build workspace packages when tests/examples import `dist/`, following [AGENTS.md](AGENTS.md). The prepared model data supports offline builds without updating tracked catalog wrappers. Keep the Node adapter out of generic/browser entry graphs and verify both imports.
- From `packages/durable`, run specific tests, e.g. `node ../../node_modules/vitest/dist/cli.js --run test/collaboration-commands.test.ts`. Run new examples with `node --conditions=source --experimental-strip-types test/examples/NN-topic.ts`. Confirm assigned numbers do not collide.
- Run each new/modified test file and appropriate affected native regression files. No `npm test`, unfiltered root Vitest suite, or paid API calls in automated checks. Use app-only configuration for demo tests.
- Pin direct dependencies; install with scripts disabled; review lockfile/package metadata and refresh required generated install-lock artifacts through existing scripts if affected. Never bypass lockfile or commit checks.
- Inspect status/diffs, run `git diff --check`, and stage explicit session-owned paths only when authorized to commit. Root checks may format files; do not include another session's edits.

## Scope gates and future flexibility

Require T3 replay and real CLI initialization around hour 3, a package-only mixed-agent example around hour 9, and deployment around hour 15. Use reserve for compatibility/credentials first. If blocked, name the actual limitation and discuss scope; do not silently move runtime responsibilities back into the server or claim replay is a real deployment.

Another harness implements the package's external-session contract. A later option B replaces Chord/storage/scheduling **inside this fork**, retaining public behavior tests and adapter interfaces where appropriate. No new published runtime dependency or live-checkpoint migration is needed to prepare for that future. Fixed driver names, plain contracts, serializable configuration, and package-level examples provide enough flexibility now.
