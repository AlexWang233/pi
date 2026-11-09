# Commit plan: collaborative Pi Durable, approach A

**Revised November 8, 2026.** Build in this fork's existing `packages/durable`, reuse T3's Codex implementation and keep `apps/collab-demo` a transport/UI host. The [implementation plan](TAKE_HOME_IMPLEMENTATION_PLAN.md) defines architecture and extensions; [progress](TAKE_HOME_PROGRESS.md) contains exact evidence and decisions.

These are **reviewable increments, not actual Git history or permission to commit**. Implemented rows group existing work; do not rebuild them or manufacture retrospective commits. No commits without the user's request.

## Budget and scope

The original budget remains about **20 hours total**, previously estimated as 18 planned plus 2 reserve. Elapsed effort is not recorded here. Remaining timeboxes are prioritization guides, not a fresh budget or a claim that all gaps fit the time remaining.

Protect package ownership, actual T3 reuse, bounded failure behavior, evidence and GCP delivery. Defer extra features if time is tight. **General file-conflict prevention, managed-tool/UI integration, steering, dynamic roles and framework replacement are post-MVP options.** The existing managed-file experiment does not need expansion before delivery.

## Implemented reviewable increments

| Suggested message / increment | Actual implementation and evidence | Remaining gap |
| --- | --- | --- |
| `docs: specify collaborative threads and external execution` | [Collaboration addendum](packages/durable/docs/collaboration.md), package README, plans and decisions | Full core-spec review/integration |
| `feat: add a T3-backed Codex adapter to Durable` | `src/adapters/codex/`, typed client/protocol/replay, exact optional peers, provenance and built notices | Real model turn; replay and CLI initialization already verified |
| `feat: add collaborative threads and targeted commands` | `collaboration/types.ts`, `state.ts`, `thread.ts`, `index.ts`; atomic admission, membership, receipts and limits | Broader failure coverage; no separate `commands.ts` |
| `feat: execute external commands through Durable tasks` | `external.ts`; predecessor FIFO, dispatch marker, outcomes, no uncertain redispatch | Live continuation; native retains existing inbox/generation |
| `feat: expose bounded collaborative views and stop` | `view.ts`, bounded projections/history, disposal and lane stop | Rich tool views and total resource budgets deferred |
| `feat: demonstrate many-to-many interaction over HTTP and SSE` | Token identity, package-backed routes, shared watches, three-user/two-agent preview and responsive UI | Live provider evidence; 16 demo tests and ad-hoc browser check exist |
| `feat: prototype managed single-file publication` | Optional `managed-file.ts`, 15 tests and example 41 | Not integrated with model tools/HTTP/UI; general protection deferred |
| `fix: reconcile interrupted commands after owner failure` | Task-derived public status/capacity; seven recovery tests including four SQLite owner-kill cases | Native/storage boundaries and real descendant cleanup |
| `fix: correlate Codex turns and await interrupt delivery` | Session correlation/teardown fixes; 16 scripted subprocess cases using actual T3 client | Direct child cleanup tested; real CLI tool descendants unverified |
| `feat: measure collaborative HTTP and SSE limits` | Four load modules, three new tests and [report](apps/collab-demo/load/README.md); 1301 accepted/completed commands including 1200-command soak, 30 stable retries | First slice complete; isolated commit timing, rate sweeps and real harness pressure remain follow-ups |
| `fix: verify persistence boundaries and configure Codex kill escalation` | 12 new admission/native/storage tests, two Windows attached-descendant cases, one-second spawner escalation | Deterministic slice complete; Windows Bash delay and real/Linux containment remain open |
| `feat: prepare host preflight and manual deployment` | Shared startup validation, read-only preflight, host exit on Harness failure, Linux service/backup templates and runbook | No live/GCP deployment or Linux runtime validation; automatic restart disabled |
| `feat: verify native collaboration with local models` | Loopback Ollama composition using Pi's existing API, two-user/two-agent configuration, opt-in real HTTP/SQLite/tool smoke and offline contract tests | Qwen3 4B passes four actual writes/retry/reopen; hosted providers, Codex and GCP still need their own access/evidence |
| `feat: inspect workspace files from the demo` | Authenticated read-only directory/text API and browser controls, manual refresh, five new HTTP/filesystem tests and desktop/mobile Chrome verification | No editing, diffs, automatic refresh or write-conflict protection |
| `docs: record regular-host local integration and presentation` | Actual Ollama/browser check: five commands, all four user/agent pairings, file inspection, queue, reconnect and idle reopen; [presentation runbook](TAKE_HOME_PRESENTATION.md) and README API/examples | Human rehearsal and full core-spec review remain; no runtime changes in this increment |

Reference examples: [38: collaboration](packages/durable/test/examples/38-collaborative-thread.ts), [39: CLI initialization](packages/durable/test/examples/39-codex-initialize.ts), [40: native providers](packages/durable/test/examples/40-native-providers.ts), [41: managed-file conflict](packages/durable/test/examples/41-managed-file-conflict.ts). Examples 38/41 are deterministic; 39 starts no model turn; 40 defaults to catalog-only execution.

## Completed load increment: acceptance record

Suggested message: `feat: measure collaborative HTTP and SSE limits`.

**Timebox:** about 2 hours for bounded first measurements/report; broaden only to investigate observed failures.

**Implemented:** [load runner/report](apps/collab-demo/load/README.md), isolated SQLite stores,
16-request submit concurrency, start/receipt accounting, retry probes, reconnect waves and a
paused reader. Automatic compaction is disabled only in the load host. All 19 demo tests and
the corrected 600.89-second soak pass. The checklist below remains the acceptance reference,
not work to rebuild. Broader rate sweeps, isolated commit timing and real CLI load are deferred
measurements rather than implied results of this first slice.

**Build**

- Add a reproducible entry under `apps/collab-demo/load/` and an ordinary deterministic host composition. Use real authentication/routes, Durable execution and SSE, disposable stores and isolated per-agent replay/driver state. No public HTTP test-mode switch or paid providers.
- Start one thread/two agents/two viewers, then five threads/ten agents/ten viewers. Increase arrivals to expose caps/saturation, then run a roughly ten-minute below-saturation soak. Include a slow viewer and reconnect bursts.
- Record attempted/accepted/rejected/completed commands, scoped IDs, driver starts, acceptance/queue/completion/delivery latency, CPU/RSS, event-loop delay and process counts. Capture commit latency if supported; label unavailable metrics. Separate commands from model/tool rounds and retries.
- Emit machine-readable results and a human report with machine/runtime/revision, duration, output sizes, bounds and sample counts. Identify the observed bottleneck without extrapolating production capacity.

**Test / done**

- Test nontrivial accounting/measurement logic. Verify no duplicate starts for retried IDs and expected replay consumption where replay is used.
- Healthy viewers proceed beside a paused reader; controlled stream tests establish application coalescing/frame caps. Actual kernel-buffer saturation/disconnection remains unmeasured. All accepted IDs are terminal, and burst rejections expose configured pending capacity.
- Retain the known same-file lost-update demonstration. Load success does not establish conflict-free files.
- Run app check/build, changed tests, root check and required package builds. Fix measured bugs separately and repeat affected measurements.

## Remaining reviewable increments

### Immediate next implementations

1. **Finish specification review and rehearse:** package README/API/example links and the
   [presentation runbook](TAKE_HOME_PRESENTATION.md) are written. Read the full normative spec
   before integrating collaboration references; rehearse the eight-minute trace. No external
   credentials required. The normal Ollama browser walkthrough passed; no runtime defect was found.
2. **Hosted integration at the credential gate:** bounded native OpenAI and actual Codex turns
   require a privately configured OpenAI key and separate Codex authentication. Notify the user
   now that local evidence is ready; do not request all four provider keys. GCP remains later.

End implementation summaries with the immediate next planned work and its prerequisites, per
the user's request recorded in [AGENTS.md](AGENTS.md). The access-dependent gates below remain
pending; Windows Bash investigation remains deferred rather than blocking independent work.

### Deferred by user: finish process ownership after the recovery boundary slice

Suggested message: `fix: verify collaborative recovery and process ownership`; split by discovered defect.

**Timebox:** about 1–2 hours for prioritized boundaries; document remaining gaps rather than claim exhaustive coverage.

**Completed:** native/external admission kills before persistence and after persistence before
acknowledgement; native model/tool kills; admission/result storage exceptions before/after
persistence. Six forced-kill and six storage-fault cases verify stable retry and no uncertain
external resend. Two Windows scripted attached-child cases pass; Codex requests one-second
kill escalation using its existing spawner. These are 14 additional tests, not new orchestration.

**Deferred defect investigation:** unmodified native Bash interruption/reopen takes about 30 seconds
on Windows. Default five-second and diagnostic 15-second runs fail; a 40-second runner limit
passes. Keep the test/runtime unchanged until the delay is localized. Do not treat the longer
test limit as a fix or claim prompt shutdown / safe workspace takeover.
The user explicitly deferred this issue; continue independent preparation/documentation first.

**Build / test**

- Keep the completed boundary tests as regression contracts. A storage exception can follow durable acceptance and fails peer lanes too; retry only the original command identity after recovery. Native generation may resend a model request even with one receipt; unsafe tools retain their no-replay policy.
- Verify real Codex child/tool descendants and Linux process-group shutdown before claiming safe owner replacement. A direct child PID disappearing on Windows is insufficient.
- Confirm stop/deadline/host shutdown finishes cleanup before a replacement admits workspace writes. Touch only owned disposable processes/workspaces; no broad process killing.
- Preserve native recovery and distinguish process crash from power loss. Do not add automatic workspace rollback or replay uncertain shell effects.

**Done:** record tested boundaries/platforms in progress/scenarios. Unverified descendant cleanup remains an explicit deployment limitation; do not silently mark this gate complete.

### When privately configured: live integration smoke

**Local substitute implemented:** [Ollama smoke](apps/collab-demo/LOCAL_MODELS.md) uses an actual
small chat model and verifies files, attributed 2x2 sharing, stable retries and graceful SQLite
reopen. The regular host also passed a five-command browser walkthrough with file inspection,
same-agent queue, offline/reconnect and idle reopen; [portable evidence](apps/collab-demo/scripts/results/2026-11-08-ollama-browser.json).
This supports continued local coding without keys; MiniLM embeddings do not exercise
agent tool calls. Keep the hosted-provider/Codex gates below pending and notify the user when
those checks are next. No need to wait for GCP to continue independent implementation.

Suggested message: `docs: record live native and Codex integration evidence`; code defects get separate `fix:` increments.

**Timebox:** about 0.5–1 hour once prerequisites exist; credential waiting is not evidence.

- Use OpenAI for native Pi and a separately authenticated real Codex harness. An OpenAI key does not establish Codex service authentication.
- Complete bounded coding turns in the same disposable workspace. Verify attribution, lane overlap, follow-up, continuation and stop. Use distinct files for successful edits and disclose cross-agent file races.
- Record model/CLI/runtime versions and outcomes without credentials. Recheck authentication in the deployed service environment.
- Leave other providers' live and multi-key tests deferred. No paid stress tests. Initialization alone does not satisfy this gate.

### After local readiness: GCP deployment

Suggested message: `feat: deploy collaborative Durable on a single GCP VM`.

**Timebox:** about 2 hours after project/billing/access exist. GCP is still required by the assignment and explicitly deferred until local readiness.

**Preparation implemented:** [deployment kit](apps/collab-demo/deploy/README.md), shared startup
validation, read-only API-key preflight and host failure exit. The unit uses a cooperative owner
lock, required data mount, service-cgroup cleanup and `Restart=no`. The stopped-service archive
includes the complete data directory. Templates are not installed or Linux-verified; preflight
does not establish live authentication. Remaining gates below still apply.

**Build**

- Add secret-free configuration, scripts, service unit and access/restart/backup/teardown runbook. One Linux VM, persistent data storage, dedicated account, process-group-aware supervision and exclusive store ownership.
- Keep SQLite outside agent workspaces; bind locally with SSH forwarding. Pin verified Node/Codex versions and build Durable with T3 notices.
- Check current prices against planned ceilings. Install with scripts disabled; review any required lifecycle exception. Keep credentials out of source, workspace and logs.

**Verify / done**

- Real Pi/Codex coding turns work as the service account with multiple viewers; label simulated paths.
- Restart/reboot retains receipts/history and conservative external recovery. Old descendants cannot race replacement ownership; document evidence and exceptions.
- Verify coordinated SQLite/WAL-aware backup/restore, fresh-terminal evaluator access and teardown including retained disks. Record deployed revision/versions. A local runbook alone is not deployed delivery.

### Final: documentation, report and presentation

Suggested message: `docs: document collaborative Durable guarantees and measured results`.

**Timebox:** about 1 hour; preserve time for clean setup and rehearsal.

- README/public API links and the presentation runbook are written. Finish normative spec integration after reading the main spec fully; the addendum is not already integrated into it.
- Document reproducible setup, T3 reuse/licenses, dependency changes, measured load, failure domains, cloud access/teardown and limits. Keep progress/scenarios consistent.
- Explain VM/process/store failure, serialized commits, provider quotas, process pressure, observer memory and uncoordinated writes. Separate measurements from predictions.
- Rehearse eight minutes: package API, M:N sharing, ordering/parallelism, retry/stop/reconnect, uncertain recovery, file-conflict limit, measured bottleneck and next options.
- Follow clean setup instructions; identify automated/manual evidence. No actual commit unless requested; follow current-branch changelog rules.

## Post-MVP commit options

Select only after core evidence/delivery or an explicit scope change. The [extension table](TAKE_HOME_IMPLEMENTATION_PLAN.md#7-post-mvp-extensions-and-trade-offs) explains alternatives and costs.

| Optional increment | Build/test acceptance | Main dependency or cost |
| --- | --- | --- |
| `feat: integrate managed proposals with agent tools` | Trusted actor/command binding, retained stale conflicts, explicit resolution and visible outcomes; concurrent proposals cannot silently overwrite | Participating tools only; uncertain-write reconciliation/unblock first |
| `feat: validate multi-file proposals and review merges` | Read sets, stale rejection, three-way candidates, explicit publication and partial-effect crash tests | Files/metadata are not automatically atomic |
| `feat: coordinate unrestricted workspace writers` | Whole-turn ownership through descendant termination; shell/Codex overlap and takeover tests | Less parallelism; every writer must participate, no lease-only safety claim |
| `feat: offer worktrees and guarded checkpoints` | Separate edits, reviewed integration, inspectable checkpoints, unsafe restore refusal | Different shared-file semantics and merge cost; no automatic stash/pop |
| `feat: add approvals and finer command controls` | Authorized first valid pending decision wins; delivery failure, cancellation and late-response tests | New durable decision states; steering depends on harness capability |
| `feat: add roles and dynamic membership` | Reads/streams/commands/approvals obey permissions; test revocation and guest moderation | Identity integration and wider authorization surface |
| `feat: add another external coding harness` | Driver lifecycle, progress, capabilities, continuation and uncertain recovery | More T3 reuse possible; native provider support is not an adapter |
| `feat: improve tool views and retry persistence` | Useful tool/diff views, bounded retry drafts surviving reload, safe literal rendering | More client state; no credentials in browser storage |
| `feat: enforce measured resource and fairness limits` | Per-user admission/spend/process budgets, retention policy and pressure tests | Use measured hotspots; receipt expiration changes retry guarantees |
| `feat: assign exclusive thread owners across workers` | Isolated workspaces, fenced ownership and tested takeover/backup recovery | Separate availability project; concurrent store opens are not scaling |
| `feat: replace framework internals behind collaboration contracts` | Approach B inside this fork, retaining behavioral tests and adapter contracts | Larger redesign; fresh incompatible stores, no implicit checkpoint migration |

## Verification rules

- Read edited files fully and reread changes before reporting. Inspect installed external types. Keep generic imports free of Node/Effect adapter dependencies.
- After code changes run full `npm run check`, plus the app's own check for app changes. Build whenever tests/examples need `dist/`; checking is not building.
- Run every new/modified test and focused affected regressions. Example from `packages/durable`: `node ../../node_modules/vitest/dist/cli.js --run test/collaboration-recovery.test.ts`. Follow [AGENTS.md](AGENTS.md): no unfiltered root Vitest suite, and no `npm test` unless requested. Automated checks consume no paid keys.
- Maintain exact dependencies, scripts-disabled installs and scoped lockfile review. No dependency changes for docs-only updates.
- Docs-only revisions need rereading and `git diff --check`, not code tests. Label historical validation as historical.
- No commits unless asked. When authorized, inspect status and stage only explicit session-owned paths. Never reset, stash or clean others' work.
