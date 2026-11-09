# Interview answer drills

Use these questions to practice concise explanations followed by a concrete example and trade-off. The first paragraph of each answer is the short response; the second supplies material for follow-up questions.

These answers describe the current implementation, not an ideal future system. Keep the [claim boundaries](README.md#claims-you-can-defend) visible while rehearsing so that proposals do not become accidental delivery claims.
For more concrete situations and detailed follow-up answers, use the [categorized question bank](interview-questions/README.md).

## What is the actual contribution beyond shared chat?

The contribution is package-owned collaborative admission and execution with attributed requests, persistent retry identity, shared observations and explicit recovery policy. The browser makes those behaviors usable, but the package examples demonstrate that collaboration is not owned by HTTP.

A concrete trace is a lost submit response: the command remains admitted, and repeating the same scoped ID returns its receipt rather than adding a second job. An external turn interrupted after a potential file effect has a deliberately conservative outcome instead of blind resend. Those policies, the T3 adapter, the opt-in managed-file experiment and failure/load evidence are the substantive engineering contribution. Existing storage, tools and native generation were reused rather than rebuilt.

## Why not build a clean framework-independent runtime first?

Reusing the existing Session, inbox and scheduler made a working collaboration feature possible within the take-home scope. Generic contracts isolate adapter-specific dependencies, but Chord remains inside Durable and full framework removal is unfinished.

A complete replacement would create new storage/recovery semantics before demonstrating the requested user interaction. The current boundaries and behavioral tests give a later replacement something concrete to preserve. This is a trade-off in delivery risk and scope, not a claim that framework dependence is unimportant or already eliminated. The assignment's original approximately twenty-hour budget was a prioritization target, not a measured claim of elapsed effort.

## Why must saving a request and deciding when the agent runs it be separate steps?

The transaction decides what was accepted atomically, while the queue decides when work on an agent conversation can run. They address different races and neither guarantees conflict-free filesystem effects.

Alice and Bob can be admitted in adjacent commits while the model spends seconds on Alice's command; Bob's follow-up remains queued. Independent agents can execute meanwhile because the mutation line is not held over inference. If both later publish stale replacements to the same file, queue correctness within each lane does not save the shared file. This example connects the runtime architecture directly to the managed-file experiment.

## If a user submits one instruction, can the model call or file write happen twice?

Here, “execution” means the work triggered by a user's instruction: accepting a command, calling a model and running a tool are separate actions. Retrying the same command identity does not create a second accepted command, but a native model request can repeat after recovery. There is no general guarantee that every filesystem effect happens exactly once.

Suppose Alice asks an agent to append `hello` to a file. The file changes, then the host crashes before saving the result; rerunning the whole instruction could append `hello` again. The runtime can recognize Alice's accepted command from its receipt, but that receipt alone cannot reveal whether the file changed. Native tools follow their declared recovery policy, while an uncertain external turn is interrupted instead of automatically resent. If an interviewer says “exactly once,” clarify which action they mean before claiming a guarantee; see the [worked crash questions](interview-questions/04-failures-and-recovery.md).

| Action under discussion | Current guarantee or limitation |
| --- | --- |
| Accepting Alice's same scoped command ID/text | Returns the existing receipt instead of admitting another command |
| Sending a native model request | Can repeat after interruption/recovery |
| Performing a filesystem or shell effect | No universal exactly-once guarantee; depends on the operation and recovery policy |
| Resending an uncertain external Codex turn | Not done automatically; reported interrupted |

## How do you handle simultaneous file edits?

Ordinary shared-workspace agents can still lose updates; an opt-in managed-file API rejects stale cooperative proposals and retains conflict evidence. It is not yet integrated into native model tools, Codex or the GUI.

Explain the trace: both agents retain `base`, Alice applies `base + alice`, Bob's old-base proposal conflicts, and a fresh combined proposal resolves it explicitly. No automatic merge is claimed. Whole-turn workspace ownership would be simpler for unrestricted writers but would reduce parallelism and require verified descendant cleanup. Worktrees offer stronger edit separation at the cost of changing immediate shared-file visibility and adding integration work.

## What is the hardest failure you addressed?

One useful example is a durable write succeeding before its acknowledgement fails, because a thrown exception then does not prove rejection. Another is correlating asynchronous Codex events so an unrelated turn cannot complete the current user's command.

For storage, the fix is a consistent fatal-Harness rule, stable retry identity and recovery from persisted state, with fault injection before and after persistence. For the adapter, scripted subprocesses reproduced wrong-turn retargeting and interrupt delivery racing cleanup, then tested the corrected behavior through the real T3 client. Describe the actual trace and test boundary rather than saying the implementation “handles all crashes.”

## When Bob presses Stop on a shared agent, what happens to active work, queued requests and files?

Stop requests cancellation for one lane and withdraws its queued user inputs under the demo's policy; peer lanes can continue. It neither rolls back file changes nor proves every spawned process has terminated.

An interrupt acknowledgement is protocol evidence, while safe owner replacement needs process/OS evidence that former writers are gone. The deferred Windows Bash delay and unverified escaped/real CLI descendants remain explicit limitations. The service's proposed cgroup policy addresses this operationally, but must be exercised on Linux before claiming containment. This answer shows why a UI success badge and actual resource lifetime are different concerns.

## What did the stress test tell you?

The simulated-execution workload completed 1200 commands over roughly ten minutes and exposed configured pending capacity during a burst. It verified admission, delivery and retry accounting for that workload, not maximum real agent throughput.

The first observed limit was the queue cap, with 519 burst rejections, rather than an isolated database bottleneck. Client and server shared one process, so RSS and CPU included both. Real models, CLI subprocesses, provider quotas and shell/file contention need separate measurements. The next sensible performance work is attribution of commit/projection cost and separate-client pressure testing, not extrapolating those numbers to production capacity.

## Why should the interviewer trust the demo?

Different demonstrations are labelled by what they actually exercise, and difficult orderings are forced with barriers instead of relying on model timing. File contents and execution starts are checked independently of an agent's completion text.

The live GUI shows real native tool use and shared observations; deterministic examples show exact concurrency and recovery boundaries. Example 41 uses real files but no model, while T3 replay/scripted processes test the actual bridge without establishing live Codex authentication. A user-reported successful OpenAI turn is useful manual evidence but is not an automated crash/continuation report. Being precise about these distinctions makes the overall evidence easier to evaluate.

## What would you implement next, and what would you defer?

The most useful presentation extension is a small step-controlled conflict scenario that exposes retained proposals and explicit resolution. Stronger everyday protection would then require managed tools bound to trusted commands, a restricted execution mode and recovery reconciliation.

Keep dynamic roles, shared approval arbitration, more harnesses, worktrees, distributed workers and framework replacement as separate options with explicit costs. GCP delivery and real external-harness verification remain outstanding assignment work, not optional polish hidden by new UI features. A good prioritization answer distinguishes the next demonstrable slice from the work needed for production isolation or high availability.

## What would invalidate your current assumptions?

Untrusted users, multiple concurrent owners, arbitrary detached writers or requirements for private per-agent conversations would change the design materially. The present prototype assumes trusted collaborators sharing one workspace with fixed membership and a single owner.

A public service would need real identity, revocation, secure transport, stronger execution isolation, budgets and sensitive-history handling. Multiple owners need coordinated process/workspace ownership and fencing, not just a lease in a database. Fully automatic file integration requires semantics beyond matching destination bytes. State these assumption changes before proposing infrastructure so the response addresses the actual new requirement.

## How do you explain AI-assisted development?

AI assistance helped implement and document the project, while the design still requires an accountable explanation of decisions, tests and limitations. Be clear about reused upstream code, generated integration work and the choices you directed or reviewed.

Useful examples of deliberate direction are evolving Durable itself rather than an external wrapper, requiring actual T3 reuse, questioning many-to-many behavior, keeping filesystem risks explicit and choosing the native OpenAI/Ollama default. Demonstrate understanding by tracing a command, explaining a crash boundary and interpreting the lost-update test without relying on an assistant's summary. Avoid claiming that generated code, a passing test or fluent documentation substitutes for source understanding; use this wiki to practice that understanding.
