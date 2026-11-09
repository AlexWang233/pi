# Implementation plan: collaborative Pi Durable

**Revised November 8, 2026.** Evolve `packages/durable` in this fork to support multiple people interacting with multiple coding agents in a shared thread workspace. Authentication, HTTP/SSE and the browser remain a thin demonstration application. This supersedes the wrapper-first recommendation in the [project guide](TAKE_HOME_PROJECT_GUIDE.md).

The [commit plan](TAKE_HOME_APPROACH_A_COMMIT_PLAN.md) defines coding increments. The [progress record](TAKE_HOME_PROGRESS.md) records decisions and exact validation results. Implemented features do not mean the entire [assignment](PROJECT_INSTRUCTIONS.txt) is complete.

## 1. Budget and completion criteria

The original budget remains **about 20 hours total**, including checks, deployment and presentation. The earlier 18-hour schedule plus 2-hour reserve was an estimate, not an elapsed-time record. Do not restart that budget with each revision. Prioritize evidence and delivery over additional features.

| Stage | Required outcome | Current status |
| --- | --- | --- |
| Local MVP | Package-owned threads, authenticated demo, attributed requests, shared agents/workspace, independent histories, queues, stop, reconnect and bounds | Implemented and deterministically tested; preview exercised in a browser |
| Live integration | Native Pi and T3-backed Codex perform real coding turns | Native local Ollama smoke verified; hosted-provider turns and real Codex turns pending |
| Failure/capacity evidence | Reproducible recovery, actual HTTP/SSE load measurements and failure analysis | Scripted subprocess/owner-crash evidence plus first load/600-second soak report complete; remaining recovery and real-process checks pending |
| Assignment hand-in | GCP deployment, access/restart/teardown instructions, measured report and presentation | Deployment templates/runbook prepared; actual GCP and presentation pending |

The preview demonstrates **three members sharing two agent lanes**, including all six user/agent pairs. These are shared agent identities, histories and queues. Every member currently accesses every lane. Fixed membership is sufficient; online presence and a permission editor are optional.

Target one native Pi lane and one external Codex lane for the final live walkthrough. Native OpenAI/GPT, Anthropic/Claude, Google/Gemini and DeepSeek are registered through existing Pi AI providers. Only OpenAI credentials are planned now; other live and multi-key checks remain deferred. A native model provider is distinct from an external harness such as Claude Code.

For independent local development, [Ollama/Qwen3 setup](apps/collab-demo/LOCAL_MODELS.md) now
provides actual native model/tool execution without provider keys. Two users/two agents pass four
file-content assertions, receipt retries and graceful SQLite reopen. This supplements deterministic
tests; it does not fulfill hosted-provider authentication, real Codex turns or GCP verification.
Notify the user at those exact access-dependent gates; they do not block other local implementation.

## 2. Architecture and actual implementation locations

| Responsibility | Owner |
| --- | --- |
| Plain thread/agent/command data and external-driver contract | `packages/durable/src/collaboration/types.ts` |
| Membership, configuration, atomic admission, receipts, status, history and stop | `collaboration/thread.ts` |
| Stored metadata and terminal-task state interpretation | `collaboration/state.ts` |
| External predecessor ordering, dispatch marker, outcome and continuation | `collaboration/external.ts`, using existing Durable tasks |
| Bounded projections and disposable watches | `collaboration/view.ts` |
| Generic public entry | `collaboration/index.ts`; `/collaboration` package export |
| T3 client integration and session/process lifecycle | `src/adapters/codex/`; explicit `/adapters/codex` export |
| Optional single-file coordination experiment | `collaboration/managed-file.ts`; not integrated with agents/demo |
| Authentication, configuration, HTTP/SSE and browser | `apps/collab-demo/` |
| Current package contract | [Collaboration addendum](packages/durable/docs/collaboration.md); main spec/README integration pending |

There is no separate `commands.ts` or application execution database. Reuse Harness transactions, conversations, native inboxes, scheduling, watches and SQLite. The server verifies tokens; Durable enforces membership. A direct library host remains responsible for authenticating its callers.

Generic contracts do not expose Effect/T3 types. The optional Node adapter isolates exact Effect/platform dependencies behind its subpath. **Chord remains inside Durable.** Approach A adds collaboration without completing framework removal. Later approach B can replace internals inside this fork, retaining behavioral tests; preparing for it does not require a second runtime package.

## 3. Execution and recovery rules

**Admission:** Alice submits `c17`. One transaction authorizes her, checks scoped identity/capacity, and commits attributed input, receipt and executable intent. If the HTTP reply is lost, retrying the same ID/text returns the same receipt; changed text conflicts. Identity is scoped by thread, actor and agent. Duplicate checks precede capacity checks. HTTP `202` means durable acceptance, not successful execution.

**Concurrency:** requests queue within a lane; different lanes can run concurrently in one directory. Alice requesting React and Bob requesting Vue execute in order with attribution. Ordering does not decide which requirement should win. Messages are not automatically copied into every agent's context.

**Native execution:** preserve existing submission, inbox, generation and recovery. Forced owner-kill tests show one receipt can span two model requests, while a declared unsafe tool is not replayed after its effect. The demo configures a 60-second shell timeout; prompt Windows Bash shutdown remains unresolved, so this is not a verified process-lifetime, memory or spend bound.

**External execution:** each command's Durable task waits for its predecessor. Persist a dispatch marker before external I/O. After restart, a marker without a committed result becomes interrupted and is not automatically resent. This can sacrifice an attempt that never reached the provider to avoid repeating uncertain filesystem effects. Failed predecessors stop queued successors; a new explicit command can proceed.

Only a correlated root completion settles Codex work. Tool/item completion cannot finish it; unrelated starts cannot retarget it. Unsupported approvals/user-input requests fail visibly. Stop attempts a bounded interrupt exchange before closing; acknowledgement does not prove all tool descendants terminated.

The Codex spawner requests forced-kill escalation after one second. Two Windows scripted
attached-descendant cases pass, but this does not certify detached writers, abrupt host death
or Linux containment. A storage exception can follow a successful SQLite commit: fail the
whole Harness, retain the original retry identity and reopen after old-owner shutdown. Do not
interpret an exception as proof of rejection or automatically reopen a failed owner.

When a task becomes terminal before collaboration settlement, public status/capacity derive interruption from that outcome. Raw metadata may retain `running`; reads do not repair it or invent missing history. Missing driver registration fails visibly. Other blocked scheduler states remain a separate risk.

**Files:** Agent B can read an old `App.tsx`, then overwrite Agent A's completed edit. The demo deliberately reproduces this lost update. The opt-in managed-file API rejects stale proposals using retained base/current/proposed content under the existing mutation gate. Model tools, shell commands and Codex do not use it. Direct-writer coordination remains a future extension by scope decision.

## 4. T3 reuse and reference designs

The adapter executes vendored T3 typed client/protocol/replay code from local revision `d5fc29fe5cb62db68bfbf824cfabe0ae94ac6ac4`. [Provenance and notices](packages/durable/src/adapters/codex/vendor/UPSTREAM.md) identify copied paths and fixture adaptations; notices ship in built output. Effect/platform dependencies are pinned to `4.1.2`.

The [local T3 coordination review](apps/collab-demo/CONFLICT_RESOLUTION_PROPOSAL.md#what-the-local-t3-code-implementation-actually-provides) identifies useful future patterns:

- Optional worktrees isolate edits; shared-folder side chats still share files. Worktrees change immediate shared-workspace visibility.
- Hidden Git checkpoints support inspection. Guarded restore refuses unsafe shared-workspace restoration; checkpoints alone do not resolve concurrent writes.
- The inspected workspace lease is released before the provider turn, so it is not a whole-turn writer lock.
- Serialized commands, guarded approval decisions and moderated guests offer interaction patterns without requiring a second orchestration engine.
- Prompt stashing saves drafts, not agent filesystem changes. Do not automatically Git stash/pop the shared repository.

Replay/scripted children establish protocol behavior without paid calls. Local Codex `0.164.0-alpha.11.1` initialized; real turns and continuation remain unverified. An older fixture version is not a compatibility promise.

## 5. Remaining delivery sequence

**First load increment complete:** [runner/report](apps/collab-demo/load/README.md) uses actual
HTTP/SSE, disposable SQLite and isolated simulated execution. Baseline completed 20 commands;
burst completed 81 with 519 capacity rejections; 600.89-second soak completed 1200 with 120 viewer
reattachments. All 30 retry probes avoided duplicate starts. Client/server share one process.
Isolated commit timing, rate sweeps, real Codex load and stronger socket-pressure evidence remain
follow-ups, not reasons to delay the next correctness slice. No paid-provider load was run.

**Recovery increment added:** 12 admission/native/storage boundary cases and two attached-tree
cases pass on Windows; [the addendum](packages/durable/docs/collaboration.md#recovery-and-external-effects)
records exact guarantees and costs. Core native recovery and receipt formats were reused.

1. **Process-ownership investigation deferred by user.** The existing Windows Bash interruption/reopen test's roughly 30-second delay remains open; it fails at the default five-second limit and passes with a 40-second runner limit. Resume investigation later. Prompt shutdown, real Codex descendants and Linux process groups still need verification before workspace takeover claims. Injected SQLite failures and owner kills do not certify disk-full/corruption or power-loss safety.
2. **Verify live integration when privately configured.** Bounded OpenAI-native and real Codex coding turns, continuation and stop. Separate real model evidence from initialization/simulation. Do not require all four provider keys.
3. **Deploy to GCP after local readiness.** Verify the single-owner setup below. Missing project/access is a dependency, not completed cloud delivery.
4. **Finish documentation and presentation.** Integrate package README/spec references, publish measurements/failure analysis and rehearse eight minutes. Read the main Durable spec fully before modifying it; the addendum is not completed normative integration.

The [commit plan](TAKE_HOME_APPROACH_A_COMMIT_PLAN.md#remaining-reviewable-increments) defines coding/test gates. Evidence includes examples 38–41, recovery/boundary tests, 18 scripted Codex subprocess cases, 33 demo tests, an opt-in real local-model smoke and an ad-hoc browser check. Exact validation dates, runner limits and results remain in [progress](TAKE_HOME_PROGRESS.md#validation-log); do not add repeated runs as new coverage.

## 6. GCP design, deferred until local readiness

Use one Linux Compute Engine VM, persistent data storage, a dedicated OS account and one owning process per thread store. Bind locally and use evaluator SSH forwarding. Keep SQLite outside agent workspaces and credentials outside repository/logs.

The [preparation kit](apps/collab-demo/deploy/README.md) now supplies a systemd unit, environment template, stopped-store backup script and access/restore/teardown runbook. Shared startup validation and a read-only preflight command are implemented; the host exits after Harness failure instead of waiting indefinitely for a signal. Preflight verifies selected API-key environment presence, not live authentication. No cloud resources were created.

The service template disables automatic restart, holds a cooperative owner lock, requires the data mount and requests service-cgroup cleanup. These policies need Linux runtime verification; they do not certify process containment. Verify authentication in the service account environment. Test restart/reboot, descendant cleanup, persistence, coordinated SQLite/WAL-aware backup/restore and teardown including retained disks. Copying only a live SQLite main file is not a verified backup procedure.

One VM/process/store remains a failure domain. A second process opening the same store is not a scaling strategy. Check current prices/access before provisioning. Prior planning ceilings of $30 infrastructure and $10 live smoke calls are caps, not estimates or automatic billing stops. GCP credit does not supply model-provider access.

## 7. Post-MVP extensions and trade-offs

These are options after core delivery, not mandatory additions. Select one coherent extension based on measurements and the [problem scenarios](apps/collab-demo/PROBLEM_SCENARIOS.md) and [conflict proposal](apps/collab-demo/CONFLICT_RESOLUTION_PROPOSAL.md).

| Extension | Proposed behavior | Trade-off / prerequisite |
| --- | --- | --- |
| Managed tools and conflict UI | Bind proposals to trusted actor/command context; show stale rejection and explicit resolution | Participating tools only; add reconciliation/unblock for prepared/uncertain writes before unattended use |
| Multi-file/stale-context validation | Validate retained read sets; retain conflicts and review Git-style three-way merge candidates | More recovery state; files and metadata are not automatically one atomic transaction |
| Unrestricted shell/Codex coordination | Own workspace for the full turn and descendant lifetime, including shell effects | Less parallelism; every writer must participate. Advisory leases cannot fence an existing raw process |
| Isolated task worktrees | Separate edits, then reviewed integration | Merge/setup costs; alternative to immediate shared-file visibility |
| Checkpoints and guarded undo | Adapt hidden checkpoints/diffs and refuse unsafe shared restore | Aids review/recovery, not write concurrency. No automatic stash/pop or rollback of others' edits |
| Approvals and command controls | First valid authorized pending decision wins; queue withdrawal and capability-aware steering | Durable decision/delivery states and race tests; lane stop is simpler |
| Roles/membership | Dynamic members, per-agent access, moderated guests, real identity integration | Authorize reads/streams/tools as well as submit; wider security surface |
| More external harnesses | Implement existing driver contract, reusing more T3 adapters where useful | Each needs lifecycle/capability/recovery evidence; native providers are not harnesses |
| Richer UI/retry recovery | Tool/diff views, optional terminal/presence, bounded retry drafts surviving reload | More client state/testing; access matrix is not presence and current drafts are memory-only |
| Resource fairness/retention | Per-user budgets, fair admission, process limits and explicit receipt archival | Prioritize measured hotspots; expiring receipts changes retry semantics |
| Multiple workers/availability | Exclusive thread owners, isolated workspaces, tested fencing and backup recovery | Ownership/filesystem design together; a database lease alone does not prove safe takeover |
| Approach B: replace framework internals | Replace Chord/storage/scheduling inside this fork, retaining contracts/tests | Separate redesign; use fresh incompatible stores. Live checkpoint migration and full Effect removal are outside MVP |

## 8. Presentation claims

Show package-owned admission first, then M:N interaction: same-agent ordering, different-agent overlap, retry, stop and reconnect. Show the lost update and exactly which managed edits are protected. Distinguish uncertain external interruption from native recovery.

Hand in the fork, examples/tests, T3 attribution, setup/deployment instructions, measurements and risks. Separate deterministic evidence, manual live evidence and proposals. The result is collaborative Pi Durable with an isolated T3 adapter; framework independence, conflict-free arbitrary writes and distributed availability remain future work.
