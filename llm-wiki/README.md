# Interview preparation: collaborative Pi Durable

This wiki explains the project through the questions an interviewer is likely to ask. Start with the architecture and guarantees, then use the deeper pages to defend decisions and distinguish evidence from planned work.

The snapshot reflects the repository and conversation on November 8, 2026. OpenAI now works according to the user's manual confirmation; the earlier credit error is historical. No new live model test or cloud deployment was performed while writing this wiki. Existing implementation records can contain older status descriptions, so use the claim boundaries below when preparing your presentation.

## The short project pitch

I extended Pi Durable itself so multiple people can instruct shared coding agents with separate histories in one thread workspace. Durable owns membership checks, attributed command admission, retry receipts, execution and recovery, while a thin web host handles authentication and delivery. I also integrated a T3-backed Codex adapter and investigated shared-file conflicts, failure boundaries and load behavior.

The central design choice was to reuse Durable's existing transaction line, conversations, inboxes and tasks instead of creating another orchestration engine. The normal local configuration uses OpenAI and Ollama through native Pi; Codex is an optional external harness. The result is a working local collaboration prototype with explicit limits, rather than a claim of conflict-free arbitrary coding or distributed availability. See the [assignment](../PROJECT_INSTRUCTIONS.txt) and [architecture](01-architecture.md).

## What to study first

Memorize a few distinctions rather than every filename or test count. The most useful ones are admission versus execution, command deduplication versus effect deduplication, shared access versus conflict resolution, and current state versus an audit log.

Be able to walk through one command from browser submission to durable receipt, execution, observation and recovery. Then explain a lost-update race and why the managed-file API helps only when writers participate. These two concrete traces support most follow-up questions about databases, concurrency, APIs and failure handling.

| Page | Main interview questions |
| --- | --- |
| [Architecture and project map](01-architecture.md) | What did you build, what did you reuse, and why does it belong in Durable? |
| [Commands and concurrency](02-commands-and-concurrency.md) | What happens when users submit together, retry, queue or cancel? |
| [Durability and recovery](03-durability-and-recovery.md) | What survives a crash, what can repeat, and when is recovery unsafe? |
| [Files and conflict resolution](04-files-and-conflicts.md) | What prevents lost updates, and how do database and Git ideas apply? |
| [Providers, adapters and trust](05-providers-adapters-and-trust.md) | How is T3 reused, how are providers different from harnesses, and what is trusted? |
| [Web experience and demonstrations](06-web-and-demonstration.md) | What can the GUI prove, how does reconnect work, and how do you present a race? |
| [Evidence, scaling and deployment](07-evidence-scaling-and-deployment.md) | What was tested, where are the bottlenecks, and how would GCP deployment work? |
| [Interview answer drills](08-interview-drills.md) | How do you answer difficult questions directly and acknowledge trade-offs? |

## Claims you can defend

Separate implemented behavior, measured evidence, manual observations and proposals. A precise limitation is more defensible than a broad guarantee unsupported by the runtime or tests.

The table is the presentation boundary for this snapshot. In particular, a successful OpenAI or Ollama edit does not establish live Codex integration, and a package-level conflict example does not establish protection of the ordinary browser agents.

| Claim | Evidence and qualification |
| --- | --- |
| Multiple users share named agents, histories and queues | Package/HTTP tests and browser walkthroughs; preview covers three users by two agents |
| Native model tools can edit actual workspace files | Recorded Ollama integration plus the user's manual Ollama/OpenAI confirmation |
| Admission, retries and selected recovery boundaries work | Deterministic tests, SQLite owner-kill cases and storage-fault injection |
| Stale cooperative edits can be rejected and retained for review | Managed-file API/tests and runnable example 41; not connected to ordinary model tools or GUI |
| T3 code is used for external Codex integration | Vendored client/protocol/replay, scripted subprocess tests and real CLI initialization; no recorded real Codex model turn |
| An initial load/soak measurement exists | Real SQLite/HTTP/SSE with simulated execution; not real provider throughput |
| GCP deployment has a design and preparation kit | Templates/runbook exist; actual VM deployment, Linux containment and restore verification remain pending |
| A step-controlled GUI scenario demonstration exists | Proposed next feature; not implemented at this snapshot |

## Presentation discipline

Lead with the user-visible problem and then explain the mechanism that solves one specific part of it. State the remaining failure mode immediately after the mechanism so reviewers can assess its actual scope.

For example: “If Alice loses the HTTP response, repeating the same command identity returns its receipt. This prevents duplicate admission, but a native model request can still repeat after recovery, and shell effects are not exactly once.” Use [the presentation runbook](../TAKE_HOME_PRESENTATION.md) for the live outline and [the progress record](../TAKE_HOME_PROGRESS.md) for historical validation details. Exact dependency versions and low-level storage schema trivia are reference material, not priorities to memorize.

## Current next steps

The recommended next presentation feature is a bounded step-controlled conflict walkthrough that makes the managed-file API visible. Live external Codex verification and actual GCP delivery remain separate outstanding gates.

The deterministic scenario runner needs neither another provider key nor GCP and should clearly disclose that its participants are scripted. Connecting managed publication to ordinary model tools is a further execution-policy change, not just a UI addition. Codex needs its own authentication for live external turns, and deployment needs GCP project/billing/IAM plus Linux runtime/restore checks. Human rehearsal remains valuable even while those prerequisites are pending.
