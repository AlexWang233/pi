# Testing evidence, scaling and GCP

Each test answers a particular question, such as whether retrying adds a duplicate request or whether a file was really created. The existing results support a local prototype and user-confirmed initial VM startup, while complete cloud acceptance and several process-cleanup checks remain unfinished.

Use the [validation record](../TAKE_HOME_PROGRESS.md#validation-log), [load report](../apps/collab-demo/load/README.md) and [deployment runbook](../apps/collab-demo/deploy/README.md) as evidence references. Memorize the workload and its limits before memorizing individual test counts. Look up [barriers, soak tests, p95, and RSS](09-technical-terms.md#deterministic-tests-load-tests-and-measurements) or [single owners and failure domains](09-technical-terms.md#single-owner-failure-domain-and-availability) if needed.

## What different tests establish

Scripted tests make difficult timing problems repeatable without buying model calls. Real-model checks answer another question: whether the actual service, response handling, and coding tools work together.

HTTP tests cover authentication, admission and transport; controlled concurrency tests force queueing and lost updates; SQLite owner-process tests kill only their own disposable owners at explicit barriers. Scripted Codex subprocesses exercise the real T3 client and driver against a controlled app-server, while replay checks protocol expectations. Local-model smoke checks independently assert file contents, rather than accepting a completed agent response as proof. No one category substitutes for the others, and injected storage faults do not certify a physically full/corrupt disk. [Tests](../apps/collab-demo/README.md#checks-and-remaining-evidence), [recovery boundaries](../packages/durable/docs/collaboration.md#admission-acknowledgement-and-native-recovery-boundaries).

## Recorded evidence versus reported success

The latest recorded demo run passed 48 tests across thirteen files. The collaboration-context update also passed 68 focused Durable tests across seven files, root/app checks and the Durable build; these counts describe selected suites, not all repository tests.

A separate [real Ollama proposal check](../apps/collab-demo/scripts/results/2026-11-10-conflict-rounds-ollama.json) generated both defaults, asserted unchanged bytes before Publish, then verified stale refusal and Reset. The newer browser check used scripted providers and actual managed-file bytes to verify two identities, stale refusal, editable explicit resolution, reconnect and mobile layout. Context tests captured refreshed prompts after peer edits and existing-store reopen; real OpenAI/Ollama interpretation remains untested. The regular Ollama browser report records five commands across all four user/agent pairings, eleven model requests, file inspection, queueing, offline catch-up and idle reopen. Its Windows shutdown event used a QA-only IPC preload, so it does not establish Ctrl+C behavior under every shell or active subprocess containment. The more useful interview claim is a list of covered boundaries and remaining gaps, not a large aggregate number. [Browser evidence](../apps/collab-demo/scripts/results/2026-11-08-ollama-browser.json).

## The load result worth remembering

A roughly ten-minute test completed 1200 commands offered at two per second across ten agents, using real web requests and SQLite but simulated agent responses. A separate burst filled the configured queues and was rejected when capacity ran out.

Baseline completed 20 commands; the burst accepted/completed 81 and rejected 519 with HTTP `429`; the soak completed 1200 in 600.89 seconds. All 1301 accepted logical commands had one recorded start, and thirty retry probes introduced no additional starts. The workload used 4096-character responses and measured healthy terminal delivery plus reconnect activity. It did not involve real model APIs, coding tools or Codex processes, so it is transport/storage/runtime evidence rather than real agent throughput. [Full report](../apps/collab-demo/load/README.md).

## What the measurements cannot prove

The load test first hit the queue limit we had configured, so it did not discover the machine's maximum speed. Its memory and response-time numbers describe that workload, not a guarantee for real models or longer-running use.

The soak's p95 submit-to-terminal time was 236.6 ms: 95% of observations were at or below that duration. Sampled resident memory peaked at 179.2 MiB, but client and server shared one process, so this was not isolated server usage. A paused reader also did not prove the operating system's network buffers filled. Separate clients, changing offered rates, longer runs, and actual model/process work would test different limits. The report distinguishes preliminary generator/compaction issues from final evidence.

## Candidate hotspots and sensible optimization

Saving changes one at a time, rebuilding browser views, and sharing a model service could each slow the system down. We should measure which part is actually expensive before replacing the database or scheduler.

A **hotspot** is a part doing enough work to become a bottleneck. Likely candidates include per-thread database commits, saved command metadata and external progress, repeated view construction, and fan-out to viewers. Shared watches reduce repeated subscriptions, but do not remove the cost of preparing and sending updates. Later work could measure commit/view time, combine suitable progress writes, and allocate capacity more fairly among users. A faster database would not remove Ollama's single inference slot, provider quotas, or conflicting file writes.

## Single points of failure and scaling

One process currently owns the thread's saved state and workspace, so losing that process affects all the threads it hosts. Starting another owner on the same files is not a safe shortcut to higher availability.

The next reasonable scale step is to give independent threads separate owners and workspaces. An **owner** is the process responsible for running that thread's work, and a **failure domain** is what can fail together. Moving ownership requires ensuring the old process and its child writers really stop; a permission timeout in a database cannot stop a shell already writing files. Multiple machines would therefore need explicit ownership, routing, and recovery rules, beyond adding web-server copies.

## Why the proposed GCP deployment uses one VM

The prepared GCP plan uses one virtual machine because the app expects a long-running process, local SQLite, and a shared folder. The user has confirmed initial service startup and HTTP 200 on a VM. This does not verify the updated features, public HTTPS, process containment or backup restoration.

The app binds to loopback; SSH forwarding provides private access. Public access was subsequently requested, with instructions for an HTTPS reverse proxy and an IP-based sslip.io hostname; no successful public URL has been recorded. Bearer-token authentication remains required, and model/database ports should remain private. The service template requests cgroup cleanup, requires the data mount, uses a cooperative owner lock and disables automatic restart for inspection. Those policies are prepared configuration, not verified Linux containment or a sandbox. The current default includes local Ollama, so a VM would also need model/runtime installation and suitable measured compute capacity, or an explicitly chosen different composition; the Windows GPU result cannot be assumed on a small CPU VM. [Preparation kit](../apps/collab-demo/deploy/README.md).

## Why SQLite rather than adding PostgreSQL or Redis immediately

SQLite already fits Durable's one-owner design and avoids running another database service for the prototype. A shared database or queue might help a future system, but would not by itself stop old agent processes from writing files.

The key benefit is a small operational footprint and a tested atomic storage interface, not a claim that SQLite scales without limit. PostgreSQL could support shared durable metadata across machines, but agents would still need coherent workspaces, exclusive ownership and a recovery/fencing policy. Adding Redis as a second execution queue now would also introduce acknowledgement and persistence boundaries already handled by Durable tasks. Choose infrastructure after deciding the ownership and failure model; changing the database first merely moves part of the problem.

## Backups and operational acceptance

A usable backup needs the saved conversation/work records and the matching workspace files. The prepared procedure stops writers and copies the whole data directory; copying just the main SQLite file while agents run is not enough.

The prepared backup script archives the complete stopped data directory, including possible journal/WAL sidecars and workspace files, and keeps credentials/configuration separate. Restore must be tested in a stopped isolated installation with compatible configuration and workspace location. Before claiming deployed delivery, verify real service-user model/CLI access, descendant shutdown, restart/reboot persistence, missing-mount behavior, backup/restore and evaluator access. Teardown must account for retained disks/backups as well as the VM. GCP project/billing/IAM and actual runtime checks remain prerequisites; GCP credits are not model-provider credentials or proof of API credits.
