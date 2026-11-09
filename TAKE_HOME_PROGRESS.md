# Implementation record

**Last updated:** November 8, 2026. **Status:** admission/native/storage recovery coverage expanded; Codex cleanup now requests forced-kill escalation. Windows Bash recovery delay, real/Linux process containment, live integration and deployment remain open. No commits created by the assistant in this increment.

## Current scope

Extend `packages/durable` with collaborative threads and external coding-agent execution. Reuse T3's Codex implementation inside an adapter subpath. Keep authentication, HTTP/SSE delivery, and UI in a thin demo. Plans: [implementation](TAKE_HOME_IMPLEMENTATION_PLAN.md), [coding increments](TAKE_HOME_APPROACH_A_COMMIT_PLAN.md).

## Milestones

| Increment | Status | Evidence |
| --- | --- | --- |
| Environment | Complete | Locked dependencies installed; offline build and existing coding/SQLite examples passed during setup |
| Package contract/specification | Addendum written | [Current contract and limitations](packages/durable/docs/collaboration.md); main spec/README integration still pending |
| T3-backed Codex adapter | Implemented; replay and scripted subprocess evidence | 18 subprocess cases, including two Windows attached-descendant cases; one-second forced-kill escalation configured. Real CLI initialization succeeds; no real model turn yet |
| Thread membership/admission | Implemented and tested | Atomic attributed admission, scoped retries/conflicts, capacity, peer visibility, fixed configuration/reopen |
| External execution/recovery | Implemented; forced owner-crash evidence added | Ordinary Durable tasks, predecessor ordering, deadlines/stop, terminal-task status reconciliation and four deterministic SQLite owner-kill cases; real CLI descendant cleanup remains unverified |
| Views/stop/limits | First slice implemented | Bounded projections/disposal; native shells configured with a 60-second timeout, but Windows Bash shutdown delay remains open (I12); total resource budgets and richer tool views remain |
| Thin demo | Implemented; deterministic transport and browser smoke verified | [Runbook](apps/collab-demo/README.md), authenticated HTTP/SSE, shared watch fanout, responsive browser client, key-free preview; live model turns remain pending |
| Managed single-file coordination | Opt-in package API implemented | [Contract](packages/durable/docs/managed-files.md), concurrent proposals, retained conflicts, stable retries, uncertain-write blocking and SQLite reopen; not connected to model tools/HTTP/UI |
| GCP live deployment | Not implemented | Authentication/project access not established by environment installation |
| Load/failure report | First measured slice complete | [Workload/report](apps/collab-demo/load/README.md) and portable JSON; baseline 20/20 completed, burst 81/81 plus 519 capacity rejections, soak 1200/1200 in 600.89 seconds. Maximum throughput and real CLI process load remain unmeasured |
| Admission/native/storage recovery boundaries | Deterministic slice implemented | 12 cases, including six additional owner kills and six storage faults. Receipt persistence, native request resend, unsafe-tool no-replay and external result uncertainty verified; not full process containment |

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
| D13 | Use Node HTTP and plain browser modules; reuse package APIs directly | No additional external dependencies or application execution queue; demo has a separate check/build configuration |
| D14 | Keep simulated preview and live host as separate compositions | Preview proves real Durable/tools/transport without credentials; it is explicitly not real model/Codex evidence |
| D15 | One shared watch per lane with bounded, coalesced SSE snapshots | Viewer count does not multiply package watches; intermediate progress may be skipped, reconnect fetches current state, no durable event cursor |
| D16 | Demonstrate three users sharing two agents, with all six user/agent pairs | M:N describes shared agent identities/history/queues, not private agent copies or per-agent permissions; matrix shows access, not online presence |
| D17 | Expose shared-file conflicts rather than imply queues solve them | Controlled test reproduces a lost update despite two completed commands. Whole-turn workspace ownership or coordinated file-version checks remain optional future protections |
| D18 | Use T3's compact navigation/chat hierarchy as visual reference, with original DOM/CSS | Workspace/member sidebar, simultaneous desktop agent panels, attributed messages, separate activity and composers; no React/Tailwind/UI dependencies or copied T3 components |
| D19 | Start conflict prevention with one opt-in bounded managed text file | Exact retained content comparison plus existing mutation gate; no new dependencies or scheduler. Proves stale rejection without changing concurrent demo behavior; direct shell/Codex writers still bypass it |
| D20 | Persist managed intent before writing; block new work on prepared/uncertain publication | Prevents blind write replay after an uncertain effect. Costs availability: reconciliation/unblock tooling is not implemented; this does not make metadata and files one atomic transaction |
| D21 | Defer direct shell/Codex write coordination as a future extension, per user scope decision | Local T3 review supports optional worktrees, checkpoint/diff inspection and refusing shared-workspace restore. Per-agent worktrees change immediate shared-file visibility; T3's startup lease does not cover an entire provider turn. No automatic stash/pop policy |
| D22 | Derive interrupted command state from terminal task outcomes when collaboration settlement is missing | Read metadata/task atomically; avoid false interruption during ordinary completion. Use the same rule for pending capacity and clear stale progress. No read-side metadata repair, extra worker or new persistence format |
| D23 | Pin active Codex turn identity and finish a bounded interrupt exchange before process cleanup | Regression tests reproduced wrong-turn success and teardown before interrupt delivery. Late start events cannot retarget; an initial response/notification mismatch fails. Interrupt waits at most one second; acknowledgement is not a descendant-termination guarantee |
| D24 | Load actual HTTP/SSE and per-thread SQLite with deterministic execution and at most 16 concurrent submit requests | Avoid paid calls and connection-fanout artifacts. Client/server share one process, so resource metrics include both. Load-only automatic compaction is disabled to preserve one response per command; production settings are unchanged |
| D25 | Treat storage exceptions as uncertain persistence and retain whole-Harness failure | SQLite can commit before throwing. Preserve the original retry identity and reopen only after stopping the old owner; no second queue or automatic reopen loop. A store failure also makes peer lanes unavailable |
| D26 | Retain native recovery policies rather than promise exactly-once model/tool execution | Forced kills demonstrate one receipt but two model requests; a declared unsafe tool is not rerun after its file effect. Model retry cost and uncertain effects remain visible limitations |
| D27 | Request Codex forced-kill escalation after one second using the existing spawner | Avoid unlimited cooperative termination grace on POSIX without a new process library. Abrupt termination may leave partial effects; Windows attached-tree tests do not establish escaped/orphan or Linux containment |

## Implemented entry points and examples

- `@earendil-works/pi-durable/collaboration`: `createCollaboration`, thread open/submit/command/history/watch/stop, contracts and typed refusals.
- `@earendil-works/pi-durable/adapters/codex`: `createCodexDriver`, backed by vendored T3 code and explicit session cleanup.
- [38-collaborative-thread.ts](packages/durable/test/examples/38-collaborative-thread.ts): two members, native/external agents, shared files, retry, and peer observation; deterministic providers.
- [39-codex-initialize.ts](packages/durable/test/examples/39-codex-initialize.ts): real CLI handshake/thread creation, **no model turn**.
- [40-native-providers.ts](packages/durable/test/examples/40-native-providers.ts): registers all four native providers, lists local models, and explicitly opts into one selected live provider. Defaults to no paid calls; see [provider configuration](packages/durable/docs/collaboration.md#native-model-providers).
- [Upstream provenance](packages/durable/src/adapters/codex/vendor/UPSTREAM.md): copied source/recording paths, revision, license, and fixture adaptations. Notices are copied into built output.
- [Demo application](apps/collab-demo/README.md): `npm run preview` from its directory launches simulated agents on port 4311; `npm start` uses privately configured real providers/CLI on port 4310 with SQLite.
- [Problem scenarios and risk register](apps/collab-demo/PROBLEM_SCENARIOS.md): severity, current handling/evidence and proposed MVP protections for interaction, shared files, transport, recovery, security, capacity and deployment; retains the 3×2 walkthrough and lost-update trace. Preview adds `preview-carol` and a `shared: ` command targeting the same file on either lane.
- [Conflict-resolution proposal](apps/collab-demo/CONFLICT_RESOLUTION_PROPOSAL.md): database-style version checks and ownership, Git-style merge candidates, crash/undo boundaries and acceptance gates. First managed-file API slice implemented; broader protection remains proposed.
- [Local T3 coordination review](apps/collab-demo/CONFLICT_RESOLUTION_PROPOSAL.md#what-the-local-t3-code-implementation-actually-provides): source-linked findings on optional worktrees, shared side chats, hidden Git checkpoints, restore safety, selected-operation leases, queues, approval decisions and moderated guests. Direct-writer coordination remains a future extension.
- [`ManagedFile` contract](packages/durable/docs/managed-files.md) and [example 41](packages/durable/test/examples/41-managed-file-conflict.ts): package-owned conditional publication, preserved conflicts and explicit resolution on real temporary files, with no model/CLI invocation. Model-tool/HTTP integration remains pending.
- [Load runner and report](apps/collab-demo/load/README.md): real authenticated transport and SQLite, isolated deterministic provider state, explicit command/start accounting, retry probes, paused reader and reconnect waves; no paid calls or Codex processes.

## Current risks and open checks

| Issue | Current behavior / risk | Next evidence or improvement |
| --- | --- | --- |
| I1: Live model/GCP access | Four native providers selectable; only OpenAI key planned, not supplied through chat. No paid turn or cloud deployment verified | Configure OpenAI credentials/model privately; defer other live and multi-key checks. Revisit GCP project selection after local readiness |
| I2: Protocol compatibility | 18 scripted subprocess cases cover protocol/lifecycle plus attached Windows descendants. Local Codex 0.164.0-alpha.11.1 initializes; real turn/continuation not verified | Test live compatibility and real/escaped descendants on Windows/Linux. Typed invalid notifications may wait until external deadline |
| I3: Recovery evidence | Existing external owner kills plus six new admission/native owner kills and six SQLite storage-fault cases pass. One native receipt can span two model requests; unsafe tool effects are not replayed | Linux, real CLI/shell containment, host/power loss and actual disk-full/corruption remain unverified. Injected storage faults are not filesystem failure certification |
| I4: Shared files | Opt-in managed single-file API rejects stale edits, but model tools/HTTP/Codex do not use it. Original two-agent lost-update test still describes the demo. No hostile tenant isolation | Bind managed tools to trusted actor/command context and expose proposal outcomes, or implement whole-turn ownership covering unrestricted writers; add recovery reconciliation before unattended use |
| I5: Resource bounds | Package and transport caps plus native shell timeout; initial load records sampled RSS/heap, CPU and event-loop delay. Client/server share a process; paused reader does not prove a socket limit was reached | Separate-client/socket-pressure and real-process/spend limits remain; do not infer a whole-process bound or leak freedom |
| I6: Write/read cost | One metadata document holds bounded receipts; views read recent command states. The measured burst exposes configured pending capacity, not an isolated storage/CPU ceiling | Add paced rate sweeps and isolated commit/projection timing before optimizing |
| I7: Exceptional task faults | Public status/capacity now derive interrupted from a terminal task with unsettled metadata; settlement-fault and actual restart-limit paths are tested. Raw collaboration metadata can still retain running | Public API is authoritative for display; later audit tooling should join task/command records. Nonterminal missing-definition/migration blocks and richer unavailable status remain separate follow-up work |
| I8: UI and tool fidelity | Responsive UI and three identities exercised in ad-hoc headless Chrome; desktop/mobile screenshots inspected. Text/progress only, no rich Codex tool summaries | Test live agent turns and a human presentation walkthrough; add richer tool presentation only as needed |
| I9: Documentation | Standalone addendum describes implemented behavior; main normative spec/README not yet linked | Integrate the addendum after finalizing the API and full specification review |
| I10: Install tooling | npm 10 removed existing `libc` lock metadata during refresh; original constraints were preserved | Keep lock diffs scoped; use a compatible newer npm for future refreshes or preserve those constraints again |
| I11: Browser retry lifecycle | Ambiguous submit keeps its ID/text in page memory; reload/relogin/discard loses the local retry draft | Clearly demonstrate retry before reload; later persist a bounded receipt/draft ledger if required, keeping tokens out of storage |
| I12: Windows native Bash recovery delay | Unmodified `harness-tools-recovery` Bash case times out at five seconds and also at 15; passes with a 40-second runner limit in about 30 seconds. Subsequent cleanup failures in the failed run were caused by a still-open test store | Localize the delay and verify prompt shutdown before claiming safe native shell takeover. Raising a runner timeout is diagnostic evidence, not a runtime fix; tests/source were not weakened |

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
| November 8 | HTTP/browser increment: full root `npm run check` | Passed; no package source changes needed for the transport |
| November 8 | Demo `npm run check` and `npm run build` | Passed; separate app lint/type check and browser compilation |
| November 8 | Four focused demo test files | **13 tests passed**: HTTP/auth/retry/limits, streaming/fanout/framing/stop, host configuration, and real shared-file writes through preview composition |
| November 8 | M:N/concurrency follow-up, five focused demo files | **16 tests passed**; full root check, app check and browser build also passed. Adds six concurrent user/agent pairs, gated native same-agent ordering, and controlled cross-agent lost-update reproduction. Preview also checks both paths overwriting its shared target |
| November 8 | Frontend browser verification | Ad-hoc Chrome **156.0.8078.80** check passed with simulated providers: three identities, same-agent queue/peer attribution, both lane outcomes, reconnect without duplicate messages, stop, clear draft, history, literal rendering of HTML-like text, and mobile navigation/no page overflow. Desktop/mobile screenshots visually inspected |
| November 8 | Final frontend checks | Full root `npm run check`, app check/build and all **16 demo tests** passed after the UI refinement; no new dependencies or paid calls |
| November 8 | Managed-file slice | **15 new tests passed**, covering concurrent handles, stale/create/delete conflicts, retries, ownership/bounds, partial writes, failed intent/settlement and SQLite reopen in conflict/uncertain/prepared states. Example 41 passed on real temporary files |
| November 8 | Managed-file regression/build checks | Full root `npm run check` and Durable package build passed; **28 focused package tests** (15 managed-file plus 13 collaboration/Codex) and all **16 demo tests** passed. No dependency changes, model calls or GCP actions |
| November 8 | T3 coordination source review | Inspected local clone at `d5fc29fe5cb62db68bfbf824cfabe0ae94ac6ac4`. Recorded source evidence and reusable patterns; no T3 execution/tests, runtime changes, file stashes or worktree creation |
| November 8 | Recovery increment | **7 new tests passed**: settlement-fault status/capacity/watch recovery, late progress rejection, progress outside the eight-receipt window, and four real owner-process kill/reopen cases using deterministic drivers and SQLite on Windows |
| November 8 | Recovery regressions | **108 package tests across 7 files** and all **16 demo tests** passed. Root check, app check and Durable package build passed; no provider calls or cloud operations |
| November 8 | Codex subprocess increment | **16 new tests passed** through the actual driver and T3 client with a scripted Node app-server. Reproduced then fixed wrong-turn completion and interrupt delivery racing process teardown; covers early/item-only/mismatched events, failed turns, unsupported requests, exits, invalid JSON and resume selection |
| November 8 | Codex subprocess checks | **36 focused tests across 4 files** passed: subprocess, T3 replay, collaboration and recovery. Full root check and Durable build passed. Windows PID probes require `ESRCH` after normal close/startup exit. No new dependencies, vendored changes, real model calls or cloud operations |
| November 8 | Load-runner checks | **19 demo tests across 6 files passed**, including three new accounting/percentile/SQLite-HTTP pressure tests. Root check, app check/build and Durable build passed; app lint/type configuration now includes `load/**/*.ts`. No new dependencies or paid calls |
| November 8 | Corrected full load run | **1301/1301 accepted commands completed** across baseline, burst and 600.89-second soak; 519 intentional `429` burst rejections, 30 successful retry probes, no duplicate/missing/unexpected starts or failed commands. All accepted outcomes observed over healthy SSE and checked over HTTP; 120 soak viewer reattachments. [Portable report](apps/collab-demo/load/results/2026-11-08-windows.json) |
| November 8 | Persistence/process increment | **12 new boundary tests and two new Windows attached-descendant tests passed**. Full root check and Durable build passed. No new dependencies, vendor changes, model calls or cloud actions |
| November 8 | Focused recovery regressions | **93 tests across 8 files passed with `--testTimeout=40000`**: collaboration, boundary/recovery, Codex replay/process, native storage/generation/tool recovery. The unchanged Bash case takes roughly 30 seconds; initial default run had one timeout plus cascading locked-directory cleanup failure, and diagnostic 15-second run also timed out. Nine other tool-recovery cases pass at normal limits. This records the delay, not a fix |

The earlier 86 include **13 package feature tests** and 73 affected native regression tests; managed files add **15 new package tests**, recovery **7**, the initial Codex subprocess increment **16**, and this boundary/process increment **14** (12 plus two). The demo has **19 separate tests** (13 initial, 3 concurrency and 3 load tests), not repeated runs counted as coverage. The ad-hoc browser check is separate evidence. SQLite's existing experimental warning remains on Node 22. No full suite or paid model call was run. Maximum production capacity, real CLI/escaped descendant cleanup and host/power-loss behavior remain unmeasured.

## Presentation notes and expansion

- Demonstrate package-owned admission first, then show the same behavior over HTTP.
- Show all six user/agent pairings, same-agent queuing versus different-agent overlap, then the controlled lost-update trace. Queue correctness does not establish correct merging or agreement between conflicting instructions.
- Use preview's two simulated lanes to explain transport without conflating scripted responses with model intelligence. It writes two real files through native tools/external execution in the same disposable workspace.
- Explain a lost-response retry and a crash between external effect and result commit; acceptance is not completed execution.
- Separate measured evidence, manual live checks, and future proposals.
- Present load as SQLite/HTTP/SSE with simulated execution: 1200-command soak completed, burst hit the configured queue cap, and sampled combined client/server RSS peaked at 179.2 MiB. This does not establish a memory bound, maximum throughput or real harness capacity.
- Later: more T3 harness adapters, verified native-thread continuation, approval UI, conflict-aware edits, enforced execution isolation, then exclusive workers across machines.
- Removing Chord/storage internals is a later replacement in this fork, not a prerequisite for the first demo.

## Session notes

- Initial worktree was clean. Package plans and environment record are already present.
- Initial package work stayed inside Durable without a demo-owned queue or separate runtime package. The later `apps/collab-demo` increment adds only host composition, transport, and browser controls.
- T3's required source closure and exact dependencies are integrated. Auto-resolved Redis peer packages are build/development dependencies of the Effect platform; no Redis service is required or used.
- Root check initially caught an implicit-any local declaration; it was annotated and the complete check passed. Adapter cleanup failure handling was fixed and regression-tested so a failed close does not leave a command running indefinitely.
- Demo increment started with a clean worktree. Its lock refresh adds only workspace/link metadata (15 lines), retaining all original platform constraints; no external dependencies or lifecycle scripts were added/run by the install command.
- Documentation follow-up renamed the concurrency walkthrough to `PROBLEM_SCENARIOS.md` and expanded it into 37 scenarios with severity, current evidence and proposed protections. The original M:N walkthrough remains; this documentation change does not implement the proposed safeguards.
- UI reference inspected locally: T3 `apps/web/src/components/sidebar/SidebarChrome.tsx`, shell layout and CSS tokens. Frontend authored in this repository. Browser verification used a disposable host/profile; local report/screenshots remain in ignored `.artifacts/`, with no real-provider calls or changes to the user's running preview.
- Managed-file increment adds an opt-in API inside Durable, rather than a new wrapper package. One fixed file, 16 KiB UTF-8, 64 bases and 32 proposals keep the spike bounded. Exact content comparison preserves BOM/existence; no hashes, merges, multi-file transactions or automatic recovery are claimed. Native tools and external drivers remain unchanged.
- Direct shell/Codex coordination is deferred by user request. Local T3 source review found optional isolated worktrees, shared-folder side chats and guarded checkpoint restore; the workspace lease is explicitly released before the agent turn runs. Worktrees/checkpoints/ownership and richer approval/guest roles are recorded as extensions, not implemented protections. T3 prompt stashing saves drafts, not agent filesystem edits.
- Recovery increment fixes public status/capacity after exceptional terminal task outcomes and suppresses stale progress. Four IPC-barrier tests kill only their own disposable Node owner before reopening SQLite; no external CLI or model is invoked. Raw metadata is preserved for inspection, and missing outcome history is not fabricated.
- Codex subprocess increment reproduced and fixed two bridge bugs: an unrelated start notification changed the active turn identity, and scope teardown could beat fire-and-forget interrupt delivery. Sixteen tests use the real driver/T3 client with a scripted Node child. Vendor source and dependencies remain unchanged; no paid model is involved.
- Load increment adds a separate deterministic SQLite host and bounded HTTP/SSE client, with no new dependencies or runtime queue. Initial unbounded connection fanout was fixed in the generator. An early soak was intentionally stopped after review identified automatic compaction would violate the one-response workload; only its owned process/temporary root was removed, then the corrected workload restarted. Aborted/preliminary runs are not final evidence.
- Final load evidence is recorded in the report and portable JSON. It uses 4096-character responses, eight pending commands per lane and 256 lifetime receipts per thread; each soak thread admits 240 commands. Healthy viewers completed beside a paused reader, without establishing server/kernel buffer saturation. Client/server share one process, and other checks ran early in the soak. No provider calls, Codex processes, cloud actions or commits occurred.
- Recovery-boundary increment adds 12 tests: four admission kills before/after SQLite persistence, two native model/tool kills, four admission I/O faults and two external result I/O faults. All use disposable files and explicit barriers, not paid models. No changes to native recovery algorithms or receipt format were necessary.
- Codex spawner now requests escalation after one second. Two new Windows fixtures observe attached descendants gone after close/unexpected leader exit; no broad process cleanup or vendor/dependency changes. Installed spawner semantics still leave escaped/orphan containment unproven.
- An existing real Bash recovery test exposed a roughly 30-second Windows delay. Five-/15-second runs failed and left a test store open until process exit; isolated execution passed with a 40-second runner limit. Do not mark prompt native cancellation complete or infer its root cause from that timing alone.
- **Next implementation slices:** localize Windows Bash recovery delay, verify real/Linux process containment, opt-in live checks when privately configured, then later GCP. Managed-agent tools/conflict UI and broader workspace coordination remain optional. The overall assignment is not complete.
