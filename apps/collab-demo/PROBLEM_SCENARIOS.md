# Problem scenarios, current handling, and open risks

This is the project's risk register and presentation reference, covering multi-user interaction,
shared files, transport, recovery, security, capacity, and deployment. It includes known gaps
and future scenarios; **a proposed MVP response is not an implemented guarantee**.

**Scope:** trusted collaborators, one owning process per thread/store, independent agent
histories, and a shared filesystem within each thread. Native Pi, external Codex, and simulated
preview drivers have different capabilities. The preview is not live-provider evidence.
Assessment reflects the implementation record dated November 8, 2026.

See [Proposed coordination and conflict resolution](CONFLICT_RESOLUTION_PROPOSAL.md) for
concrete database/Git-inspired designs addressing selected scenarios, their guarantees,
implementation sequence and acceptance cases. Its first opt-in
[`ManagedFile` API](../../packages/durable/docs/managed-files.md) is implemented and tested;
model-tool/HTTP integration and broader cross-harness protections remain proposals.

## How to read the register

- **Tested:** a focused deterministic test demonstrates the behavior stated in that row.
- **Partial:** some handling exists, but coverage or an important part of the protection is missing.
- **Open:** the scenario is possible without a dedicated protection, or is a reproduced limitation.
- **Deferred:** the feature or operating environment is outside the current implementation.

Severity describes potential impact in the trusted-team prototype: **High** means lost work,
unintended effects, credential exposure, or substantial outage; **Medium** means disrupted work,
ambiguous interaction, or recoverable delivery problems; **Low** means a limited presentation
or convenience issue. An untrusted/public deployment increases several severities. These are
engineering assessments, not measured incident probabilities. A tested policy can still leave
a high-severity risk, such as an interrupted command whose filesystem effects are unknown.

## User intent, ordering, and control

| ID / problem and example | Severity | Current handling and evidence | MVP response or next protection |
| --- | --- | --- | --- |
| U1 — Conflicting user instructions: Alice requests React; Bob asks the same agent for Vue | High | **Partial:** same-agent ordering and author attribution are tested; no semantic agreement or priority policy | Keep one instruction per turn and show the author. Make contradictory requirements a visible human decision; ordering alone does not reconcile them |
| U2 — Conversation-history ordering: two users submit almost simultaneously | Medium | **Tested:** package admission serializes; persisted identities and entry IDs support stable display. Native queued inputs enter transcript history when placed. No global cross-agent timeline is promised | Use server-owned identities/order, not client timestamps. Display the chosen order; do not promise that the first click or HTTP response wins |
| U3 — Conflicting approvals: Alice approves while Bob rejects | High for destructive work; otherwise Medium | **Deferred:** no shared approval workflow. Codex uses approval policy `never` and visibly rejects interactive approval requests; this path is not established by live tests | If added, persist an approval ID, eligible responders, expiry, and one atomic decision. Define whether first valid response wins or rejection takes priority. Reject stale/unauthorized replies and publish the decision |
| U4 — Agent cancellation: Alice stops an agent while Bob has queued work | Medium–High | **Partial:** lane-wide stop and peer isolation are tested; Bob's queued work also stops. Outcomes are observable, but the initiating member is not persisted in a cancellation audit record | Label stop scope before the action. Persist initiator/time/reason and broadcast it. Do not equate stopping execution with undoing prior file changes |
| U5 — Stale UI causes the wrong action: a user clicks Stop just as one command finishes and another starts | Medium | **Open:** Stop targets the current lane, not an expected command/version | Keep the lane-wide label explicit. A later command-specific control should include the expected command ID and reject stale requests |
| U6 — Lost authorship or misunderstood context: an agent treats two users' competing requests as one person's plan | Medium–High | **Partial:** authenticated author metadata is stored/displayed. Model input is the submitted text; stored attribution is not a guarantee that the model understands user identity or authority | Add trusted caller attribution to model-facing context if required, while distinguishing it from untrusted text. Define who can override requirements; never infer privileges from a prompt |
| U7 — Changing membership or agents mid-session: Bob is removed while his stream remains open | High if revocation is expected | **Deferred:** thread configuration is fixed and incompatible reopen is rejected; no dynamic revocation or per-agent access model | Keep fixed membership explicit. Dynamic changes need durable membership versions, stream revocation, and a policy for already accepted/queued work |
| U8 — Agent-to-agent deadlock or runaway delegation: A waits for B, which waits for A | Medium–High | **Deferred:** no general agent-to-agent delegation protocol. Current external ordering is a one-way predecessor chain | If introduced, bound depth/turns, correlate requests, propagate deadlines/cancellation, and reject dependency cycles. Do not add another scheduler just to anticipate this feature |

## Filesystem and shell interactions

| ID / problem and example | Severity | Current handling and evidence | MVP response or next protection |
| --- | --- | --- | --- |
| F1 — Simultaneous file edits: agents A and B both modify `App.tsx` | High | **Partial:** opt-in `ManagedFile` API rejects a stale replacement and retains base/current/proposed. Concurrent handles are tested. Existing model tools and demo bypass it and still reproduce lost updates | Wire a restricted managed execution mode, or own the whole workspace turn for unrestricted harnesses. All native, CLI, shell and manual writers must participate; the API alone does not protect them |
| F2 — Stale agent context: B plans against code A has since changed | High | **Partial:** managed publication compares the retained destination content before writing. Separate histories, cached plans and dependencies in other files are not invalidated | Connect fresh-read/propose tools to agents, then add declared read-set validation if needed. A new read ID is required to refresh the managed base; rejecting stale destination content does not refresh model assumptions |
| F3 — Shared shell-command side effects: A runs tests while B changes dependencies or Git state | High for destructive operations; otherwise Medium | **Partial:** live native shells have a 60-second cap; external turns have a deadline. No workspace-wide operation coordination or rich shared operation list | Expose active operations and serialize incompatible installs, migrations, resets, builds, or test environments. Bound command runtime; a timeout does not make overlapping commands compatible |
| F4 — Partial changes and rollback: a cancelled agent edited two of five files | High | **Open:** cancellation/failure does not restore files; receipt and filesystem changes are not one transaction | Report partial-effects risk and preserve a reviewable diff/checkpoint. Reverting requires ownership-aware review; blindly resetting can destroy another agent's accepted changes |
| F5 — Detached work and process-tree survival: a child keeps writing after its parent stops | High | **Partial:** native/adapter cleanup paths exist, but forced-kill and cross-platform descendant cleanup are not verified. Foreground queue ordering does not cover detached work | Supervise the full process tree and verify termination before replacement ownership. Test Windows and Linux. Do not release workspace ownership while a former writer can still mutate files |

## Delivery, retries, and presentation

| ID / problem and example | Severity | Current handling and evidence | MVP response or next protection |
| --- | --- | --- | --- |
| T1 — Lost submit reply and duplicate execution: Alice retries an accepted command | High | **Tested:** same user/agent/ID/text returns the original receipt; changed text conflicts. Different users/agents may reuse an ID | Preserve the original identity/text across ambiguous retries. Admission deduplication does not mean exactly-once shell or provider effects |
| T2 — Browser reload loses an ambiguous draft: Bob cannot tell whether Send succeeded | Medium | **Open:** retry ID/text lives only in page memory and is lost on reload/relogin/discard | Show command state/history and keep the retry warning. Later persist a bounded draft/receipt ledger without tokens; do not silently generate a fresh ID for the same ambiguous action |
| T3 — Disconnection/reconnection: Bob misses activity while offline | Medium | **Partial:** disconnect does not stop work; reconnect receives a bounded snapshot, with paged history available. There is no durable SSE replay cursor | Restore current state from Durable and page history. Do not promise delivery of every intermediate progress frame; reconcile committed messages by stable ID |
| T4 — Slow viewers and reconnect storms: a stalled client accumulates output or many viewers reconnect together | Medium–High | **Partial:** one watch per lane, 32 viewers per lane, one pending coalesced snapshot, frame/write-buffer limits; focused tests cover fanout and controlled backpressure. No sustained socket-pressure measurement | Bound buffers and disconnect overloaded viewers. Measure real sockets; add retry backoff/jitter and admission controls if reconnect bursts overload the owner |
| T5 — Misleading status or duplicate events: a tool completes before the root command, or a reconnect repeats messages | Medium–High | **Partial:** root-turn correlation has T3 replay coverage; commands have stable IDs. Ad-hoc Chrome checks verified peer messages and reconnect without duplicate entries. `202` is admission, progress is transient, and lane idleness is separate | Keep accepted/running/completed/failed distinct. Ignore duplicate/stale execution events, test malformed and late protocol events, and never treat a tool completion as the root result |
| T6 — Incomplete history or clipped output: an older failure is no longer in the latest command panel | Medium | **Partial:** snapshots retain eight commands, bounded recent messages and previews; browser transcript retains 200 entries. History is paged/projected, not a complete audit export | Label display/retention limits. Provide explicit outcome/history inspection or an export if needed; do not present bounded projections as every event or full native tool output |

## Execution, persistence, and recovery

| ID / problem and example | Severity | Current handling and evidence | MVP response or next protection |
| --- | --- | --- | --- |
| R1 — Crash recovery and uncertain execution: an agent writes a file, then the owner dies before recording success | High | **Partial:** external dispatch memo prevents automatic resend on re-entry; active close/reopen is tested. Forced-process crash boundaries are not | Report `interrupted` and require an explicit retry after inspecting effects. Test before/after admission, dispatch, effect, and outcome commit. Native recovery follows Durable's existing semantics, not the external policy |
| R2 — Two owners or stale ownership: a replacement host starts before the former writer is dead | High | **Open:** one owner per store/workspace is an operational assumption, not a distributed ownership protocol | Start only one owner and supervise shutdown. Scaling needs exclusive ownership with stale-owner prevention, coordinated with workspace access; a database lock alone does not stop old external writers |
| R3 — Provider/CLI failure or timeout: a rate limit, dead CLI, or failed cleanup occurs mid-turn | High | **Partial:** missing drivers, external deadlines and cleanup failure settlement are tested; live provider/Codex turn failures and continuation are not fully verified | Surface failure without hiding possible side effects. Test CLI exit/interrupt/continuation and provider errors. Retry only where the specific operation's semantics permit it |
| R4 — Storage failure or disk full: an admission commit fails, or a result cannot be persisted after a tool ran | High | **Partial:** HTTP waits for package admission before `202`. Managed-file tests inject failed intent, partial write and post-effect settlement failure; uncertain/prepared intent blocks new managed edits. General storage-failure behavior remains unverified | Keep explicit uncertainty and original retry identities. Add recovery inspection/reconciliation and broader storage fault injection; no automatic replay or blind unblocking |
| R5 — Orphaned command status: a scheduler-level fault leaves metadata showing running after the task terminates | High | **Open:** ordinary adapter errors settle; reconciliation for exceptional task faults/restart limits is an outstanding issue | Derive/reconcile public status against terminal task outcomes and test fault/restart-limit paths; avoid a permanently busy UI or blocked lane |
| R6 — Incompatible reopen, upgrade, or missing adapter: stored work references code/config no longer installed | High | **Partial:** fixed configuration mismatch is rejected and missing drivers visibly fail; live store migration and full upgrade compatibility are not supported | Pin the tested build/CLI; validate configuration before resuming. Use a new store for incompatible changes and keep a backup/export rather than silently rewriting old identities |
| R7 — Failure cascades and queue policy surprises: one failed instruction causes later users' work to run unexpectedly | Medium–High | **Partial:** external queued successors stop after predecessor failure; demo native failures withdraw queued input through Harness settings. Fresh commands can run after settlement | Show skipped/stopped commands and why. Keep both host policies explicit; add coverage when changing them. Do not silently spend more tokens on queued work after failure |

## Authorization, credentials, and trust

| ID / problem and example | Severity | Current handling and evidence | MVP response or next protection |
| --- | --- | --- | --- |
| S1 — Unauthorized access: a nonmember reads history or submits to a thread | High | **Tested within the API:** bearer identity plus package membership checks cover reads, streams and mutations. All members intentionally see all agents' histories; this is not per-user privacy | Keep thread-level authorization on every path. Per-agent/private conversations would need a new policy, not a claim that shared histories are already private |
| S2 — Stolen or stale tokens: a copied token continues granting access | High | **Partial:** real-host tokens are private environment values and stay out of URLs/browser storage; no login, roles, expiry or live token revocation. Public preview tokens are loopback-only examples | Keep the trusted-team/loopback boundary; rotate tokens and restart to replace the mapping. Before public hosting, define secure transport, expiry/revocation and operational secret handling |
| S3 — Workspace escape or destructive execution: a shell follows a symlink outside the shared directory | High | **Open:** shared cwd is not an execution sandbox or hostile-tenant boundary. Membership does not confine filesystem or network access | Keep disposable repositories and minimal credentials. Untrusted use requires enforced OS/process/filesystem/network isolation covering every harness, not just HTTP path validation |
| S4 — Prompt injection or credential disclosure: repository text induces an agent to print host secrets | High | **Open:** wire validation is not prompt-injection protection; trusted local execution can access host environment credentials. No comprehensive log/history redaction guarantee | Minimize exposed secrets, treat repository/model/tool content as untrusted, and review credential/log flows. Never promote prompt text into authenticated authority; do not promise that redaction alone prevents exfiltration |
| S5 — Unsafe rendering or accidental secret persistence: tool output includes HTML or users paste keys into chat | High for secrets; otherwise Medium | **Partial:** client uses `textContent`, a static asset allowlist and CSP; an ad-hoc Chrome check verified HTML-like messages remain literal text. Submitted text/history can still persist sensitive material | Keep text-only rendering and tokens out of URLs/storage. Tell users to configure keys on the host. Define retention/export access; test the actual browser before expanding rich rendering |

## Capacity, operations, and project evidence

| ID / problem and example | Severity | Current handling and evidence | MVP response or next protection |
| --- | --- | --- | --- |
| O1 — Queue saturation, unfairness, and lifetime capacity: Alice fills the queue or the thread reaches 256 commands | Medium–High | **Partial:** default 16 pending per agent and 256 lifetime receipts; new work rejects while old retries remain valid. No per-user fairness/rate limiter or receipt compaction | Explain finite prototype capacity. Measure rejection/queue latency; add per-user admission fairness if needed. Never prune receipts in a way that silently permits duplicate work |
| O2 — Resource or cost exhaustion: large output, many subprocesses, or repeated model rounds drain the host/budget | High | **Partial:** body/text/frame/viewer/turn limits and deadlines exist; these are not whole-process CPU/RSS/disk/process-count or monetary caps. No multi-provider live or soak measurements | Use deterministic load, measure memory/process/disk/event-loop effects, and enforce explicit execution/spend budgets before broader exposure. Output clipping does not cap provider spend |
| O3 — Serialized-write and fanout hotspots: many active lanes contend on one owner | Medium–High | **Open measurement:** one Session commit line per thread; shared metadata/projection work and one process can become bottlenecks. No measured throughput claim | Measure acceptance, queue, completion and delivery latency, commit cost and event-loop delay. Optimize measured hotspots; later distribute exclusive thread owners rather than concurrent owners of one store |
| O4 — Single points of failure and backups: owner, VM, disk, or zone becomes unavailable | High | **Deferred deployment evidence:** real host has SQLite; preview is memory-only. No verified GCP deployment, reboot/failover or restore runbook | Document outage scope; back up SQLite consistently with its journal/WAL and verify restores. Storage recovery does not recover lost filesystem effects or kill surviving writers automatically |
| O5 — Model/CLI/dependency drift: the tested replay differs from the installed CLI or an account lacks a chosen model | Medium–High | **Partial:** exact adapter dependencies, vendored T3 revision/license and CLI initialization evidence exist. Four native providers register; only OpenAI credentials are planned. Live turns are not verified by catalog loading or replay | Pin and record tested versions/models; run opt-in live checks when credentials exist. Keep provenance and compatibility evidence distinct; registration is not a live integration result |
| O6 — Scope/evidence mismatch: a simulated demo is presented as deployed, stress-tested, production-safe collaboration | High for assignment credibility | **Open deliverables:** deterministic tests and headless browser checks establish narrow contracts; live calls, forced crashes, load/soak, a human live-demo walkthrough, and GCP remain separate unfinished checks | Record implemented/tested/measured/deferred status. Keep cloud setup for the agreed later phase; document provisioning, access, restart, restore and teardown when deployment is actually performed |

## Priorities within the take-home budget

This register is not a commitment to implement every proposed protection in 20 hours.

1. Preserve the tested contracts: authenticated admission, scoped retry, per-agent ordering,
   bounded observation, explicit stop/failure outcomes, and conservative external recovery.
2. Resolve or explicitly disclose the highest work-loss risks: shared-file writes, stale context,
   partial effects, uncertain dispatch, orphaned status, and old processes surviving restart.
3. Complete the missing evidence: human live-demo walkthrough, opt-in live turns, forced-crash tests,
   deterministic load/soak and the agreed later GCP deployment. Do not label these complete
   because the preview or replay passed.
4. Defer dynamic membership, approval arbitration, autonomous delegation, distributed failover,
   and hostile multi-tenancy unless they replace other scope explicitly.

For a first protective extension, whole-turn workspace ownership is smaller than universal
cross-harness file coordination, but serializes participating agents within that thread.
Version-checked mutations preserve more concurrency but must coordinate every writer. Neither
option automatically refreshes an agent's old plan or resolves conflicting human requirements.
The worked examples below show the current behavior and these trade-offs concretely.

## Evidence map

| Reference | What it establishes |
| --- | --- |
| [HTTP tests](test/http.test.ts) | Authentication/membership, scoped retries/conflicts, input validation and capacity mapping |
| [Stream tests](test/streams.test.ts) | Deterministic fanout/reconnect/stop isolation, viewer limit, framing and controlled response backpressure |
| [Concurrency tests](test/concurrency.test.ts) | Six user/agent pairs, gated native ordering and a deliberately reproduced lost update |
| [Preview test](test/preview.test.ts) | Real native tools/shared-file writes and served browser modules with simulated provider/CLI I/O |
| [Package collaboration tests](../../packages/durable/test/collaboration.test.ts) | Admission, external ordering/stop/deadline/cleanup, close/reopen and SQLite identity preservation |
| [Managed-file tests](../../packages/durable/test/managed-file.test.ts) | Opt-in single-file stale rejection, retained proposals, stable retries, partial-write/settlement failure and SQLite reopen; not direct shell/Codex protection |
| [Codex replay tests](../../packages/durable/test/codex-session.test.ts) | T3 typed replay through the adapter and admitted-task path, not real provider execution |
| [Implementation record](../../TAKE_HOME_PROGRESS.md) | Actual check results, remaining risks and unperformed validation |

## Worked examples and walkthrough

### Relationship model

A thread is a shared workspace with a list of users and a list of agents. Every member may
message every agent in that thread. The preview has three members and two agents:

| Member | Native Pi agent | External agent |
| --- | --- | --- |
| Alice | Message and observe | Message and observe |
| Bob | Message and observe | Message and observe |
| Carol | Message and observe | Message and observe |

These are six user/agent relationships, not three private copies of two agents. Each agent has
one history and queue shared across those users. Agent histories are separate from each other;
files are shared. Membership is fixed per thread/store. There is no per-agent permission model
or online-presence tracking in this prototype. The UI matrix shows access, not who is online.

`test/concurrency.test.ts` submits all six pairs concurrently through HTTP, intentionally using
the same command ID. All six are distinct because identity is `(thread, user, agent, command ID)`.
It verifies successful outcomes and all three authors visible to each member on both agents.

### Two users instruct the same agent

Suppose Alice says “make the heading red” and Bob says “make the heading blue” at the same time:

1. Both requests enter the package's serialized admission transaction. One commits first;
   wall-clock arrival or which user clicked first is not a priority guarantee.
2. The first command runs. The second remains queued on that same agent.
3. The second command runs after the first completes. It sees the same agent's accumulated
   history and current shared files. Both commands retain their authenticated author metadata.

The native demo uses Pi's default one-at-a-time follow-up inbox. External commands depend on
their predecessor tasks. A gated native-model test proves that the second model invocation
does not start while the first is blocked; the existing package tests cover external ordering.
Hosts can change native inbox settings: batching with `followUpMode: "all"` is not the policy
demonstrated here. Follow-ups do not interrupt a running command.

This covers the demo's foreground model/tool turns. Detached shell processes or custom host
tasks that outlive an answer are not protected by this queue ordering.

**Ordering is not conflict resolution.** Blue may overwrite red even though both commands run
correctly. There is no automatic decision about whose intent should win. Attribution is stored
and displayed; the runtime does not adjudicate contradictory instructions or assign user priority.

### Different agents edit the same file

Agents run independently, so two instructions can overlap:

```text
shared.txt = base
agent A reads base                 agent B reads base
agent A writes base|alice
                                  agent B writes base|bob
shared.txt = base|bob              Alice's change is lost
```

The test holds both agents after reading, then releases the two writes in that order. Both
commands report completed, and the final file contains only Bob's replacement. This is an
explicitly reproduced limitation, not a conflict-detection feature. Actual unsynchronized I/O
can also produce errors or partial/interleaved content; clean last-writer-wins is not guaranteed.

Pi's in-process tool queues do not coordinate all external CLI/shell writers, nor do they make
an agent's whole read/modify/write turn atomic. A SQLite admission transaction protects queue
records, not filesystem operations. Stopping an agent does not undo files it already changed.

### Existing execution policies in brief

| Situation | Current policy |
| --- | --- |
| Lost submit response | Same user/agent/ID/text returns the original receipt; changed text is 409 |
| Queue full | Reject new work with 429; existing receipts remain retryable |
| User disconnects | Observation closes; accepted work continues |
| Member stops an agent | Active and queued work on that lane stops, including other users' queued commands; peers continue |
| External failure | Already queued successors stop; a fresh command may be admitted after settlement |
| Native failed run | Demo host withdraws queued work; this is a Harness setting |
| Uncertain external dispatch on restart | Report interrupted; do not automatically resend possible filesystem effects |

These policies cover execution and delivery failures, not semantic agreement between users.
Forced-process crashes, full process-tree cleanup, and real-provider behavior still need the
separate validation listed in the project progress record.

### Reproduce in the browser

Restart `npm run preview` after rebuilding. Open three profiles with `preview-alice`,
`preview-bob`, and `preview-carol`. Open **Access & coordination** to view the 3×2 access matrix.

1. Alice and Bob both send a message to `native-simulated` before its short simulated response
   finishes. Observe one running command and one queued follow-up, with both authors visible.
2. While that lane is busy, Carol sends a command to `external-simulated`. It can progress
   independently. Swap users/targets to demonstrate that no agent belongs to one user.
3. Send `shared: Alice replacement` to either agent, then `shared: Bob replacement` to the
   other. Inspect `shared-preview.txt` in the temporary workspace printed by the launcher.
   Both target that file. Concurrent sends may overwrite each other; sequential sends replace
   the previous content deliberately. The prefix is preview syntax, not a real-agent protocol.

The short delays make the queue visible; the automated tests use explicit barriers to establish
ordering and overlap without relying on those delays. This preview remains simulated model/CLI
I/O. It does not establish a live Codex integration or a measured capacity result.

### File-coordination options

| Option | Benefit | Cost / limitation |
| --- | --- | --- |
| Retain concurrent agents, disclose conflicts, and inspect diffs manually | Smallest assignment scope; preserves agent concurrency | No enforced review or data-loss prevention; current coordination model |
| Exclusive workspace ownership for an entire agent turn | Prevents overlapping participating turns from reading/writing stale workspace state | Serializes agents within a thread; independent threads can still run concurrently; all writers and crash cleanup must honor ownership |
| File-version checks and coordinated writes | Rejects stale edits while allowing unrelated-file concurrency | Must cover the complete read/modify/write operation and external shell/CLI writers; a Pi-only write hook is insufficient |

Do not add a lock around only the final write and call the problem solved: both agents may
already have read stale content. For a 20-hour take-home, present the reproduced limitation
clearly. If preventing it is required, workspace ownership for a whole turn is a smaller next
step than reliable cross-harness per-file coordination. Neither option resolves contradictory
human intentions; sequential commands can still deliberately reverse earlier changes.
