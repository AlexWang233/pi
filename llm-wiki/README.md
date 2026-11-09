# Interview preparation: collaborative Pi Durable

This wiki helps you explain what the project does, why we built it this way, and what its limits are. Start with the short explanations and examples; use the deeper paragraphs when practicing follow-up questions.

The implementation/evidence snapshot is from November 8, 2026; the explanations and glossary were revised on November 9. OpenAI works according to the user's manual confirmation; the earlier credit error is historical. No new live model test or cloud deployment was performed while writing this wiki. Existing implementation records can contain older status descriptions, so use the claim boundaries below when preparing your presentation.

## The short project pitch

I extended Pi Durable so several people can give instructions to shared coding agents working in the same project folder. The system records who asked for what, queues work for each agent, and keeps saved requests and results available after a restart. I also connected an optional Codex agent using code from T3 and explored how to detect conflicting file edits.

The central design choice was to reuse Durable's existing transaction line, conversations, inboxes and tasks instead of creating another orchestration engine. The normal local configuration uses OpenAI and Ollama through native Pi; Codex is an optional external harness. The result is a working local collaboration prototype with explicit limits, rather than a claim of conflict-free arbitrary coding or distributed availability. See the [assignment](../PROJECT_INSTRUCTIONS.txt) and [architecture](01-architecture.md).

## What to study first

Start with two stories: Alice loses the reply after clicking Send, and two agents try to replace the same file. These explain most of the important choices about saving work, avoiding duplicate requests, and detecting conflicting edits.

Practice explaining both stories without using special terminology first. Then learn the technical names: accepting and saving a request is **admission**, avoiding a second accepted copy is **deduplication**, and an edit based on an old file is a **stale edit**. The pages below explain the mechanisms and link to the relevant code.

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
| [Expanded interview question bank](interview-questions/README.md) | Concrete scenarios, deeper follow-ups and links by question type |
| [Technical terms with examples](09-technical-terms.md) | What do harness, admission, fencing, projection and other unfamiliar terms mean here? |
| [LaTeX/PowerPoint deck and speaker notes](../presentations/take-home/README.md) | What should I say and demonstrate on each slide, including after GCP deployment? |

## When a question uses unfamiliar terminology

Ask what specific action the question means before answering. For example, accepting Alice's instruction once is different from calling OpenAI once or writing a file once.

Use the [technical-terms guide](09-technical-terms.md#find-a-term) when an unfamiliar word interrupts your reading. It focuses on agent systems, shared work, and recovery rather than basic programming, with a short meaning followed by technical detail and an example. For instance, [exactly-once claims](09-technical-terms.md#idempotency-deduplication-and-exactly-once-claims) distinguish accepting a command, calling OpenAI, and writing a file. Diagrams show request flow, overwrites, managed conflict checks, and a crash during external work; the question bank retains deeper explanations for interview follow-ups.

## Claims you can defend

Say what works today, how we checked it, and what is still planned. For example, a successful OpenAI file edit does not prove that two agents can safely edit the same file.

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

Explain a problem, show one small example, and then explain the solution and its limit. You do not need to memorize every filename or test count to give a convincing answer.

For example: 'Alice's request was saved, but the network reply was lost. Retrying with the same request ID finds the saved request instead of adding another; this does not guarantee that every later model call or file operation happens only once.' Use [the presentation runbook](../TAKE_HOME_PRESENTATION.md) to rehearse and [the progress record](../TAKE_HOME_PROGRESS.md) to check historical evidence.

## Current next steps

The next proposed feature is a conflict walkthrough with buttons that let the presenter pause before each file change. Testing real Codex coding work and deploying to GCP are separate tasks that remain unfinished.

The deterministic scenario runner needs neither another provider key nor GCP and should clearly disclose that its participants are scripted. Connecting managed publication to ordinary model tools is a further execution-policy change, not just a UI addition. Codex needs its own authentication for live external turns, and deployment needs GCP project/billing/IAM plus Linux runtime/restore checks. Human rehearsal remains valuable even while those prerequisites are pending.
