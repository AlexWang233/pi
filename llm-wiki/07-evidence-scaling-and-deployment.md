# Testing evidence, scaling and GCP

Testing should support a specific claim at a specific boundary rather than stand in for production readiness. The project has useful deterministic, local-model and load evidence, while cloud and unrestricted-process guarantees remain incomplete.

Use the [validation record](../TAKE_HOME_PROGRESS.md#validation-log), [load report](../apps/collab-demo/load/README.md) and [deployment runbook](../apps/collab-demo/deploy/README.md) as evidence references. Memorize the workload and its limits before memorizing individual test counts.

## What different tests establish

Deterministic tests verify ordering, retry and recovery invariants without paying for model requests or depending on model behavior. Live model checks verify a different boundary: actual streaming, authentication and tool outcomes.

HTTP tests cover authentication, admission and transport; controlled concurrency tests force queueing and lost updates; SQLite owner-process tests kill only their own disposable owners at explicit barriers. Scripted Codex subprocesses exercise the real T3 client and driver against a controlled app-server, while replay checks protocol expectations. Local-model smoke checks independently assert file contents, rather than accepting a completed agent response as proof. No one category substitutes for the others, and injected storage faults do not certify a physically full/corrupt disk. [Tests](../apps/collab-demo/README.md#checks-and-remaining-evidence), [recovery boundaries](../packages/durable/docs/collaboration.md#admission-acknowledgement-and-native-recovery-boundaries).

## Recorded evidence versus reported success

The automated suite contains 41 demo cases at this snapshot, but the latest full recorded demo run covered the earlier 38 cases. Later focused runs covered the added startup/preflight behavior; the user separately confirmed that OpenAI now works.

Do not state “all 41 passed in one fresh full run” without running and recording that check. The regular Ollama browser report records five commands across all four user/agent pairings, eleven model requests, file inspection, queueing, offline catch-up and idle reopen. Its Windows shutdown event used a QA-only IPC preload, so it does not establish Ctrl+C behavior under every shell or active subprocess containment. The more useful interview claim is a list of covered boundaries and remaining gaps, not a large aggregate number. [Browser evidence](../apps/collab-demo/scripts/results/2026-11-08-ollama-browser.json).

## The load result worth remembering

The load workload exercised actual authenticated HTTP/SSE and per-thread SQLite with simulated execution. A roughly ten-minute soak completed 1200 commands at an offered two commands per second across ten lanes, while a burst hit configured queue capacity.

Baseline completed 20 commands; the burst accepted/completed 81 and rejected 519 with HTTP `429`; the soak completed 1200 in 600.89 seconds. All 1301 accepted logical commands had one recorded start, and thirty retry probes introduced no additional starts. The workload used 4096-character responses and measured healthy terminal delivery plus reconnect activity. It did not involve real model APIs, coding tools or Codex processes, so it is transport/storage/runtime evidence rather than real agent throughput. [Full report](../apps/collab-demo/load/README.md).

## What the measurements cannot prove

The first observed limit was configured admission capacity, not maximum SQLite, CPU or network throughput. Sampled memory and short-run latency are observations under that workload, not system-wide bounds or guarantees.

Soak submit-to-terminal observation p95 was 236.6 ms, and sampled RSS peaked at 179.2 MiB for the combined client/server process. Those timings include more than isolated scheduling or commit duration, and the client itself contributes memory/CPU. A paused reader beside healthy viewers does not prove kernel socket buffers saturated or that every slow reader is isolated. Separate clients, paced rate sweeps, longer runs and real-process measurements would answer different questions. The report also records an early generator fanout defect and compaction-related workload correction, keeping preliminary runs separate from final evidence.

## Candidate hotspots and sensible optimization

Per-thread commit serialization, shared metadata, repeated command projections and real execution resources are plausible hotspots. Measure them separately before replacing the scheduler or storage engine.

The metadata document retains bounded receipts and external progress, whose updates are currently immediately stored; projections read recent command states and fan out snapshots. Shared lane watches avoid multiplying package subscriptions by viewer count, but do not eliminate publication/serialization costs. A later optimization could separate/coalesce progress in an eligible conversation document, instrument commit/projection latency and enforce per-user/provider fairness. Faster database access would not remove a serialized local GPU, provider quotas, shell contention or independent file races.

## Single points of failure and scaling

One owning process, its storage and its workspace are failure domains, and several thread stores in one process still share that process's fate. Adding another process against the same store/workspace is not a safe availability design.

The practical next scale boundary is independent threads assigned to exclusive owners, each with its own workspace/process containment and tested recovery. Ownership needs more than a lease that expires while an old external writer continues modifying files. A shared database or Redis queue alone does not make SQLite history, external sessions and workspace effects one fenced unit. Distributed availability would therefore be a separate design project, not simply adding HTTP replicas.

## Why the proposed GCP deployment uses one VM

The preparation kit uses a Linux Compute Engine VM, persistent data storage and a dedicated OS service account because the prototype expects long-lived processes, local SQLite and a shared local workspace. This is a deliberate proof-of-concept deployment choice with an explicit VM/zone failure domain.

The app binds to loopback and evaluator access uses SSH forwarding instead of a public application endpoint. The service template requests cgroup cleanup, requires the data mount, uses a cooperative owner lock and disables automatic restart for inspection. Those policies are prepared configuration, not verified Linux containment or a sandbox. The current default includes local Ollama, so a VM would also need model/runtime installation and suitable measured compute capacity, or an explicitly chosen different composition; the Windows GPU result cannot be assumed on a small CPU VM. [Preparation kit](../apps/collab-demo/deploy/README.md).

## Why SQLite rather than adding PostgreSQL or Redis immediately

SQLite reuses Durable's existing transactional backend and fits the chosen single-owner local workspace model without another service. A different database or queue could help a later architecture, but would not solve ownership of filesystem effects or external processes by itself.

The key benefit is a small operational footprint and a tested atomic storage interface, not a claim that SQLite scales without limit. PostgreSQL could support shared durable metadata across machines, but agents would still need coherent workspaces, exclusive ownership and a recovery/fencing policy. Adding Redis as a second execution queue now would also introduce acknowledgement and persistence boundaries already handled by Durable tasks. Choose infrastructure after deciding the ownership and failure model; changing the database first merely moves part of the problem.

## Backups and operational acceptance

A useful recovery backup must preserve the database state and corresponding workspace, with writers stopped or an explicitly coordinated snapshot procedure. Copying only an active SQLite main file is not a verified backup of this system.

The prepared backup script archives the complete stopped data directory, including possible journal/WAL sidecars and workspace files, and keeps credentials/configuration separate. Restore must be tested in a stopped isolated installation with compatible configuration and workspace location. Before claiming deployed delivery, verify real service-user model/CLI access, descendant shutdown, restart/reboot persistence, missing-mount behavior, backup/restore and evaluator access. Teardown must account for retained disks/backups as well as the VM. GCP project/billing/IAM and actual runtime checks remain prerequisites; GCP credits are not model-provider credentials or proof of API credits.
