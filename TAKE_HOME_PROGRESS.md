# Implementation record

**Last updated:** November 8, 2026. **Status:** first package slice implemented and verified; no Git commits created.

## Current scope

Extend `packages/durable` with collaborative threads and external coding-agent execution. Reuse T3's Codex implementation inside an adapter subpath. Keep authentication, HTTP/SSE delivery, and UI in a thin demo. Plans: [implementation](TAKE_HOME_IMPLEMENTATION_PLAN.md), [coding increments](TAKE_HOME_APPROACH_A_COMMIT_PLAN.md).

## Milestones

| Increment | Status | Evidence |
| --- | --- | --- |
| Environment | Complete | Locked dependencies installed; offline build and existing coding/SQLite examples passed during setup |
| Package contract/specification | Addendum written | [Current contract and limitations](packages/durable/docs/collaboration.md); main spec/README integration still pending |
| T3-backed Codex adapter | Implemented; partially live-verified | Actual typed client/protocol/replay reused; real CLI initialization succeeds, no real model turn yet |
| Thread membership/admission | Implemented and tested | Atomic attributed admission, scoped retries/conflicts, capacity, peer visibility, fixed configuration/reopen |
| External execution/recovery | First slice implemented | Ordinary Durable tasks, predecessor ordering, deadlines, stop/cleanup, explicit interrupted outcome on active close/reopen |
| Views/stop/limits | First slice implemented | Bounded text projections and observation disposal; native shell budgets and richer tool views remain |
| Thin demo | Not implemented | No server/UI changes yet |
| GCP live deployment | Not implemented | Authentication/project access not established by environment installation |
| Load/failure report | Not implemented | No performance claims yet |

## Decisions and trade-offs

| ID | Decision | Reason / cost |
| --- | --- | --- |
| D1 | Runtime behavior lives in Durable, not a second application runtime | Direct fit for the assignment; package examples must work without HTTP |
| D2 | Reuse conversations, documents, native inbox, tasks, and transaction line | Avoid rebuilding a scheduler/storage engine; retain Chord internally |
| D3 | Explicit Codex adapter import, plain external-driver contract | Isolates Effect/protocol details; does not remove all framework dependencies |
| D4 | One owner process per thread store, shared directory per thread | Simple proof of concept; VM/process failure affects hosted work |
| D5 | Do not automatically resend an uncertain external turn | May interrupt work that never reached the provider; avoids accidental replay of filesystem effects |
| D6 | Fixed members/agents, follow-up and lane stop initially | Fits 20 hours; steering, individual withdrawal, admin screens deferred |
| D7 | External commands wait on predecessor tasks | Reuses Durable's waiting mechanism instead of another pump/scheduler; one task per command |
| D8 | Effect/platform 4.1.2 are optional peers plus development dependencies | Adapter subpath is Node-only; generic collaboration entry does not import Effect |
| D9 | Preserve vendored T3 source, exclude it only from formatting/lint rewrites | Retains provenance and generated schema; still type/dependency checked; authored adapter follows normal checks |
| D10 | Native failed-run queue policy remains a Harness setting | Example configures `afterFailedRun: "withdraw"`; external queued successors stop after predecessor failure |
| D11 | Native Pi supports OpenAI/GPT, Anthropic/Claude, Google/Gemini, and DeepSeek through existing Pi AI factories; Codex remains a separate harness | Register all four without requiring all keys; choose provider/model per agent. Only OpenAI credentials are planned now; other live checks are deferred |
| D12 | Defer GCP until the local feature is ready | Continue local implementation and verification without provisioning cloud resources |

## Implemented entry points and examples

- `@earendil-works/pi-durable/collaboration`: `createCollaboration`, thread open/submit/command/history/watch/stop, contracts and typed refusals.
- `@earendil-works/pi-durable/adapters/codex`: `createCodexDriver`, backed by vendored T3 code and explicit session cleanup.
- [38-collaborative-thread.ts](packages/durable/test/examples/38-collaborative-thread.ts): two members, native/external agents, shared files, retry, and peer observation; deterministic providers.
- [39-codex-initialize.ts](packages/durable/test/examples/39-codex-initialize.ts): real CLI handshake/thread creation, **no model turn**.
- [40-native-providers.ts](packages/durable/test/examples/40-native-providers.ts): registers all four native providers, lists local models, and explicitly opts into one selected live provider. Defaults to no paid calls; see [provider configuration](packages/durable/docs/collaboration.md#native-model-providers).
- [Upstream provenance](packages/durable/src/adapters/codex/vendor/UPSTREAM.md): copied source/recording paths, revision, license, and fixture adaptations. Notices are copied into built output.

## Current risks and open checks

| Issue | Current behavior / risk | Next evidence or improvement |
| --- | --- | --- |
| I1: Live model/GCP access | Four native providers selectable; only OpenAI key planned, not supplied through chat. No paid turn or cloud deployment verified | Configure OpenAI credentials/model privately; defer other live and multi-key checks. Revisit GCP project selection after local readiness |
| I2: Protocol compatibility | Replay from Codex 0.156.1; local CLI 0.164.0-alpha.11.1 initializes | Test real turn, interrupt, continuation, malformed/unsupported events, and process exit |
| I3: Recovery evidence | Active task close/reopen preserves dispatch marker and does not resend | Add forced child-process kill tests at precise crash boundaries and Linux process-tree checks |
| I4: Shared files | No conflict prevention or hostile tenant isolation | Demonstrate conflicting edits; later hash-aware mutations/sandboxing if scope permits |
| I5: Resource bounds | Character-limited progress/view previews and bounded receipts; not a total encoded-byte/process-memory limit | Measure large output, socket pressure, process limits, and event-loop latency; configure native shell timeouts |
| I6: Write/read cost | One metadata document holds bounded receipts; views read recent command states on updates | Measure commit contention and projection overhead before optimizing |
| I7: Exceptional task faults | Normal adapter/cleanup errors settle failed; scheduler-level faults outside that path need more coverage | Test restart-limit/orphaned tasks and reconcile command state with terminal task outcomes |
| I8: UI and tool fidelity | Package snapshots expose text/progress; no HTTP UI or rich Codex tool summaries yet | Implement thin demo and richer lifecycle presentation only as needed |
| I9: Documentation | Standalone addendum describes implemented behavior; main normative spec/README not yet linked | Integrate the addendum after finalizing the API and full specification review |
| I10: Install tooling | npm 10 removed existing `libc` lock metadata during refresh; original constraints were preserved | Keep lock diffs scoped; use a compatible newer npm for future refreshes or preserve those constraints again |

The host-authenticated identity is a trust boundary: the library enforces membership but does not authenticate arbitrary callers itself. Do not present direct library calls as a complete authentication system.

## Validation log

| Date | Check | Result |
| --- | --- | --- |
| November 8 | Prior setup: workspace offline build | Passed |
| November 8 | Prior setup: Durable coding-tools and SQLite recovery examples | Passed; no paid provider calls |
| November 8 | `npm run check` after package implementation | Passed, including type/dependency/import-graph/browser smoke and unchanged coding-agent install lock; final pass repeated after examples |
| November 8 | Focused new plus affected native tests | **86 tests passed across 5 files**: collaboration, Codex session, native submissions, inbox, task recovery |
| November 8 | T3 replay through actual collaboration admission/task path | Passed; outbound fixture consumed with no replay failure |
| November 8 | Full workspace `npm run build:offline` | Passed with adapter sources and notices included |
| November 8 | Runnable example 38 | Passed; both files written, scoped retry returned original receipt, Bob observed Alice's lane |
| November 8 | Real example 39 / CLI probe | Passed with Codex 0.164.0-alpha.11.1; handshake/thread creation only, no model turn |
| November 8 | Four-provider example 40 | No-run path passed; local catalogs loaded for OpenAI (44), Anthropic (17), Google (23), and DeepSeek (2). No network or paid turn |
| November 8 | Provider-selection follow-up | Full `npm run check` passed; 13 collaboration/Codex tests passed again. Live OpenAI and multi-key checks remain deferred |

The 86 include **13 new feature tests** and 73 affected native regression tests. SQLite's existing experimental warning remains on Node 22. No full test suite or paid model call was run. Capacity and forced-crash results are still unmeasured.

## Presentation notes and expansion

- Demonstrate package-owned admission first, then show the same behavior over HTTP.
- Explain a lost-response retry and a crash between external effect and result commit; acceptance is not completed execution.
- Separate measured evidence, manual live checks, and future proposals.
- Later: more T3 harness adapters, verified native-thread continuation, approval UI, conflict-aware edits, enforced execution isolation, then exclusive workers across machines.
- Removing Chord/storage internals is a later replacement in this fork, not a prerequisite for the first demo.

## Session notes

- Initial worktree was clean. Package plans and environment record are already present.
- Code lives inside Durable; no demo-owned queue, separate runtime package, or application server was created.
- T3's required source closure and exact dependencies are integrated. Auto-resolved Redis peer packages are build/development dependencies of the Effect platform; no Redis service is required or used.
- Root check initially caught an implicit-any local declaration; it was annotated and the complete check passed. Adapter cleanup failure handling was fixed and regression-tested so a failed close does not leave a command running indefinitely.
- **Next implementation slice:** HTTP/SSE demo, real-provider smoke tests, stronger external protocol/crash coverage, then GCP and measured load. The overall assignment is not complete.
