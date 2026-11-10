# Questions about testing and diagnosing failures

These questions ask what evidence supports a claim and how to distinguish a runtime defect from an unrelated failure. A useful answer names the observation, the controlled boundary and the conclusions that observation does not support.

The [evidence overview](../07-evidence-scaling-and-deployment.md) summarizes recorded runs. These questions help explain the reasoning behind those tests instead of memorizing a test count.

## The agent says DONE and the command is completed: why check the file separately?

Completed status means the model/tool run reached its defined terminal outcome, not that the requested code is correct. A model can answer confidently while failing to create the requested file or producing the wrong content.

The earlier small local-model trial demonstrated exactly that distinction: a completed response failed the independent file-content assertion. The accepted smoke checks therefore inspect actual files, and more complex coding work would need appropriate tests or review as well. This separates runtime completion from task correctness and model quality. See [the local smoke evidence](../../apps/collab-demo/LOCAL_MODELS.md) and [the GUI's claim boundary](../06-web-and-demonstration.md#what-the-current-gui-can-prove).

## How can a test reliably force two agents to read stale content before either writes?

Use explicit promises or barriers that let both participants report a finished read before the test releases either writer. Sending two requests with `Promise.all` only overlaps submission; it does not guarantee the necessary file-operation order.

The lost-update test initializes `base`, waits until both drivers have read it, releases A, checks A's file result, then releases B and checks the overwritten result. A managed counterpart can use the same base-sharing setup and assert stale rejection instead. This makes the causal ordering inspectable and lets the implemented scripted GUI stop at the same boundaries for explanation. See [the actual test](../../apps/collab-demo/test/concurrency.test.ts) and [conflict demonstration](../04-files-and-conflicts.md#how-to-demonstrate-the-race-reliably).

## A recovery test passes after increasing its timeout: have you fixed the problem?

Increasing the runner's waiting limit can reveal that work eventually finishes, but it does not make cancellation or cleanup faster. The longer pass is diagnostic evidence, not a runtime fix.

The existing Windows Bash interruption/reopen case fails at short limits and takes roughly thirty seconds when allowed to finish. A correct investigation would locate the delay, verify writer lifetime and then add a regression for the intended behavior. The user deferred that investigation, so it remains a disclosed limit. Unrelated test fixture errors should also be separated from product faults; for example, retained HTTP response bodies were needed to keep a viewer-cap test independent of garbage collection. See [the validation record](../../TAKE_HOME_PROGRESS.md#validation-log).

## If injected SQLite errors pass, why test real owner-process termination too?

An injected error controls what a storage method returns, while killing the owner interrupts real process execution at a chosen point. They exercise related but different boundaries and neither certifies every disk or power-loss failure.

Before/after-persistence fault injection distinguishes a rejected write from a committed write whose acknowledgement failed. Owner-kill tests verify that reopened SQLite and task recovery interpret the durable state left at explicit barriers. Real disk-full, corruption, host death and escaped CLI descendants add additional failure paths. The useful claim is coverage of the tested boundary, not “the database survives anything.” See [boundary tests](../../packages/durable/test/collaboration-boundaries.test.ts) and [recovery tests](../../packages/durable/test/collaboration-recovery.test.ts).

## Why use simulated models for stress testing if the real product calls LLMs?

Deterministic execution lets the test measure admission, storage and delivery without paid calls or unpredictable provider latency. It does not measure real model throughput, quotas, subprocess pressure or coding quality.

The recorded workload uses real SQLite and authenticated HTTP/SSE, but controlled short responses and driver behavior. That makes queue saturation, stable retries and missing/duplicate execution starts easier to identify. Live checks then validate actual provider/tool integration separately and should not be mistaken for load results. A later real-harness load test would need explicit cost/resource limits and would answer a different performance question. See [the load workload](../../apps/collab-demo/load/README.md).

## Process memory peaked at 179.2 MiB during the soak: does that prove memory is bounded or there are no leaks?

Resident set size (RSS) measures the memory a process currently has resident in RAM. A sampled peak describes the observed run and cannot prove a universal memory bound or absence of leaks. In this workload the client and server share a process, so the measurement is not isolated server memory.

Garbage collection, retained transcripts, client measurements and HTTP buffers can affect the curve. Stronger evidence would use separate clients, longer runs, repeated workloads and measurements tied to released owners/watchers/processes. The ten-minute soak is useful operational evidence without being a proof that memory stays flat indefinitely. See [measurement limits](../07-evidence-scaling-and-deployment.md#what-the-measurements-cannot-prove).
