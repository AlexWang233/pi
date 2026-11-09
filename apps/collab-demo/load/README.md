# Deterministic HTTP/SSE load report

This workload measures the collaboration package through the demo's actual authenticated
HTTP/SSE server. It uses **real SQLite per thread and simulated execution**, without provider
keys, model APIs, filesystem tools or Codex processes. T3 protocol correctness has separate
replay/subprocess tests; this report does not establish its process-load capacity.

## Reproduce

Build workspace packages first, using the repository environment instructions. From
`apps/collab-demo`:

```powershell
node --conditions=source --experimental-strip-types load/run.ts 600 ../../.artifacts/collab-load.json
```

The first argument is soak duration in seconds (1–600, default 600); the second is an output
path. A 5-second run is useful for smoke checks, not soak evidence. Each scenario starts fresh
stores/workspaces under a newly created temporary root and removes that exact root after
closing its owned HTTP server, observations and Harness instances. No running preview is used.

The raw JSON includes one-second memory samples. The [portable results file](results/2026-11-08-windows.json)
retains aggregate measurements and first/last resource samples; local `.artifacts/collab-load.json`
retains the full series. Versions and
the base Git revision are recorded. These measurements include the uncommitted load increment.

## Workload and accounting

| Scenario | Threads / lanes / healthy viewers | Arrival pattern | Simulated response |
| --- | --- | --- | --- |
| Baseline | 1 / 2 / 2 | 10 rounds, one command per lane every 200 ms | 40 ms service, 4096 output characters |
| Queue saturation | 5 / 10 / 10, plus one paused reader | One burst of 60 commands per lane; at most 16 concurrent submissions | 100 ms service, 4096 characters |
| Soak | 5 / 10 / 10, plus one paused reader | One command per lane every 5 seconds for 600 seconds | 40 ms service, 4096 characters |

Each thread has 256 lifetime receipts and eight pending commands per lane. Each native lane
has its own faux response state; external execution is a deterministic driver. Automatic native
compaction is disabled only in this load composition, so retained synthetic answers do not add
unplanned summary-model calls. Normal demo/runtime settings are unchanged. Every successful
command requires one response or external run, with no tool rounds. All requests use
the fixed loopback load identity Alice; M:N attribution is covered separately by concurrency
tests. Job injection is grouped by lane, not a fairness experiment.

Baseline reconnects both viewers every five rounds. Soak reconnects all ten every ten rounds;
these are sequential reattachment waves, not an unbounded simultaneous reconnect storm.
Ten accepted IDs per scenario are retried with their original text. Retry probes are counted
separately from first-submit HTTP statuses. Each accepted ID is checked through its status
endpoint, even if it has fallen out of the eight-command SSE projection.

Completion accounting rejects missing/unexpected/duplicate execution starts, unsettled commands,
non-completed terminal outcomes, failed retry probes and unexpected healthy-stream termination.
Healthy SSE terminal coverage is counted, not assumed. A paused reader is attached using Node
HTTP without consuming its response; its attachment alone proves neither buffer saturation
nor server-side disconnection.

## Measurements

Recorded November 8, 2026, against base revision `f21ff4314b8ec9def126179352e2963b9056efed`
plus this uncommitted increment. The corrected soak completed in **600.89 seconds**.

| Scenario | First attempts | Accepted / completed | 429 | Acceptance p95 | Submit to terminal observation p95 |
| --- | --- | --- | --- | --- | --- |
| Baseline | 20 | 20 / 20 | 0 | 37.4 ms | 84.0 ms |
| Queue saturation | 600 | 81 / 81 | 519 | 56.5 ms | 894.0 ms |
| Soak | 1200 | 1200 / 1200 | 0 | 205.6 ms | 236.6 ms |

All **1301 accepted logical commands** completed with exactly one recorded execution start.
All were observed terminal over healthy SSE and independently checked through command-status
HTTP. All **30 retry probes** returned acceptance without another start. There were no
unexpected healthy-stream endings or unsettled/failed commands. The soak completed **120 viewer
reattachments**; the paused reader did not report peer closure before cleanup. That observation
does not establish whether the server had closed a socket whose buffered data was never read.

| Scenario | Sampled RSS peak, client + server | Event-loop delay p99 | Driver result to terminal SSE p95 |
| --- | --- | --- | --- |
| Baseline | 92.8 MiB | 35.8 ms | 5.7 ms |
| Queue saturation | 134.7 MiB | 44.2 ms | 16.8 ms |
| Soak | 179.2 MiB | 45.2 ms | 36.2 ms |

The soak offered two commands/second across ten lanes; it was not a throughput ceiling test.
Its measured CPU usage was 28.781 user seconds plus 3.578 system seconds for the combined
client/server process. Event-loop monitoring uses a 20-ms sampling resolution. Percentiles
use nearest rank; small baseline sample counts make tail estimates particularly coarse.

These are single local runs, not production throughput estimates. Machine: Windows
10.0.26200, Node 22.23.4, AMD Ryzen 7 7745HX, 16 logical CPUs, approximately 31.2 GiB RAM.
Other repository checks ran during the early part of the soak; this was not an isolated host.

## Interpretation and failure domains

- **First observed limit: configured queue capacity.** The burst received explicit `429`
  responses. More than 80 commands can be admitted across ten eight-pending lanes because
  completed work frees slots while injection continues. This does not locate maximum CPU,
  SQLite or network throughput. A paced rate sweep is a follow-up measurement.
- **Queue wait increases completion time.** Submit-to-driver-start includes network and
  admission; it is not isolated scheduler wait. Submit-to-terminal observation uses first
  healthy SSE observation, falling back to status polling. Polling can overstate completion
  latency. Driver-return-to-SSE timing includes settlement/projection/network work and is
  not a direct commit-duration measurement.
- **One process hosts client and server.** CPU, heap, RSS and event-loop samples include both.
  There are no external child processes in this composition. Retained transcripts/receipts,
  faux prompt state, client measurements, HTTP buffers and garbage collection can all affect
  memory. A sampled peak or a ten-minute run does not prove a leak-free or bounded process.
- **Observation limits are narrower than process limits.** Existing stream tests exercise
  controlled coalescing and oversized-frame disconnection. Healthy clients completing beside
  a paused socket does not prove kernel buffers hit a limit or guarantee arbitrary slow-reader
  isolation. Reconnect storms and separate-client socket-pressure tests remain open.
- **Store and workspace ownership remain single-owner.** One process failure affects every
  hosted thread; independent SQLite files do not provide independent process availability.
  Per-thread commits and shared metadata/projections are candidate hotspots, not identified
  bottlenecks without isolated measurements.
- **Real execution has additional limits.** Provider quotas/cost, shell effects, Codex process
  pressure, descendant cleanup, storage failure/recovery time, power loss and cross-agent file
  conflicts are outside this workload. Separate tests/risks remain authoritative.

## Focused verification

```powershell
node ../../node_modules/vitest/dist/cli.js --run test/load.test.ts
```

Three tests cover percentile semantics, detection of accounting errors, and a real five-thread
SQLite/HTTP burst with retry, reconnect and a paused reader. Initial unbounded client fanout
hit connection refusals; the runner now limits submission concurrency to 16 and drains all
workers before teardown. This was a generator defect, not a measured Durable queue failure.
An earlier soak was stopped during review because default automatic compaction would add
unplanned model rounds; only the corrected, completed run above is final evidence.
