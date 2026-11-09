# Web state, user experience and demonstrations

The web application makes package-owned coordination observable, but it does not create stronger execution guarantees than the package provides. A good presentation shows a controlled transition and its consequence rather than only showing two chat windows.

The existing [runbook](../apps/collab-demo/README.md) explains actual controls and [presentation outline](../TAKE_HOME_PRESENTATION.md) gives an eight-minute structure. The scenario panel discussed below remains proposed work.

## Why HTTP commands and SSE snapshots

Commands use authenticated HTTP requests, while Server-Sent Events deliver changing lane snapshots to viewers. This matches the current interaction pattern without requiring a bidirectional connection protocol.

Sending instructions, stopping lanes and paging history fit request/response routes; downstream progress fits a stream. The browser uses authenticated fetch-based SSE so tokens can stay in headers rather than URLs. WebSockets could support richer bidirectional interaction later, but would not independently solve durable admission, reconnect recovery or file conflicts. Node HTTP and plain browser modules keep the host small and avoid importing T3's complete UI framework. [Server](../apps/collab-demo/src/server.ts), [browser stream](../apps/collab-demo/web/stream.ts).

## Snapshots are convergent views, not an event journal

Viewers receive bounded current state and can load earlier history rather than requiring every transient progress event. Reconnect restores the latest committed view; it does not replay an authoritative global event sequence.

Package projections combine separate metadata/conversation watches and command reads, so they are not one atomic cross-source snapshot. Stable entry identities support deduplication, and source folding can omit intermediate updates when consumers lag. A durable audit stream would require separately persisted facts and cursor semantics. The distinction matters when an interviewer asks whether reconnect guarantees delivery of every token or whether two agents share a global order. [Projection](../packages/durable/src/collaboration/view.ts).

## Slow viewers and bounded delivery

The host shares one package watch per lane and coalesces updates rather than creating a runtime watch for every browser. Viewer and output limits bound parts of the delivery path, but not total process memory or kernel socket buffers.

Each lane allows 32 viewers, with at most one pending snapshot behind a blocked socket. Frames over 1 MiB and writes exceeding the 2-MiB application buffer threshold cause disconnection; snapshots show recent bounded state rather than every progress frame. The package keeps eight recent command summaries and projects up to twenty recent entries, while the browser retains at most 200 transcript entries per lane. Slow-reader tests and a paused load reader exist, but actual kernel saturation and an isolated server memory bound were not demonstrated. [Fanout](../apps/collab-demo/src/streams.ts), [stream tests](../apps/collab-demo/test/streams.test.ts).

## Ambiguous submissions and browser reload

The browser retains an ambiguous draft's ID/text in page memory so a retry can return the same durable receipt. Reloading, signing in again or explicitly discarding that draft loses this local retry record, even though accepted server work may still exist.

This is the difference between a server-side idempotency contract and a durable client retry experience. The UI must not silently create a new ID for the same ambiguous action, and discard does not mean cancellation. A future bounded draft/receipt ledger could survive reload without storing bearer tokens, but it would need clear retention, reconciliation and user controls. Current state/history help inspect accepted work but are not a replacement for every lost client draft. [Browser implementation](../apps/collab-demo/web/app.ts).

## What the current GUI can prove

The GUI can show shared attributed history, queued follow-ups, independent lanes, lane-wide stop, reconnect and direct inspection of agent-written files. Those are coordination and observation behaviors, not proof that arbitrary coding requests succeeded or that concurrent edits merge safely.

Use two browser identities and show Bob observing Alice's work, Bob queuing on that same agent, and work on the peer lane continuing independently. Disconnect a viewer without cancelling its work, then reconnect and inspect persisted messages and files. With local Ollama, inference is serial even though lanes are independent; scripted execution can make overlapping runtime activity easier to explain. Avoid equating the access matrix with online presence or “completed” with verified semantic correctness.

## The file browser is inspection, not version control

Users can inspect current relative-path directory listings and small UTF-8 files without relying on an agent's description. Refresh is manual, and the viewer does not provide an atomic snapshot, editor, diff, checkpoint or write policy.

The endpoint rejects hidden paths, `node_modules`, traversal and linked targets under its documented policy, caps reads at 64 KiB, and considers the first 200 directory entries plus an overflow probe. That improves reviewability and limits read cost, while concurrent edits can still change what is read. Parent replacement races mean it is path hygiene for trusted collaborators, not confinement against hostile writers. [File API](../apps/collab-demo/src/workspace-files.ts), [browser module](../apps/collab-demo/web/files.ts).

## How the proposed scenario panel improves the story

A step-controlled scenario panel would expose difficult races at understandable pause points. It should run real package operations with deterministic participants and clearly label which parts are scripted.

The first bounded scenario should show both retained reads, Alice's applied proposal, Bob's rejected stale proposal, retained base/current/proposed content and an explicit resolution. Queue/cancellation and reconnect presets can follow if they add value. This is proposed UI integration, not a feature currently available in the live agents; adding buttons alone would not bind ordinary OpenAI/Ollama tools to managed publication. An isolated disposable scenario store would avoid altering the live team's workspace and fixed thread configuration.

## Separate the live and deterministic demonstrations

Use real OpenAI/Ollama for a short tool-use and sharing demonstration, then use deterministic examples for precise concurrency/recovery boundaries. This makes the presentation repeatable without pretending scripted participants are real model intelligence.

Example 41 can run independently of the web server and model services, including in an SSH terminal on a future GCP VM. It creates actual temporary files, shows applied/conflict/resolution results, and cleans up. Automated tests create their own isolated runtime and servers where needed; only explicit live-model checks require model availability. Build workspace packages first where the examples/tests consume built exports. [Example 41](../packages/durable/test/examples/41-managed-file-conflict.ts), [concurrency test](../apps/collab-demo/test/concurrency.test.ts).

```powershell
. E:\Github\pi\.artifacts\env.ps1
Set-Location E:\Github\pi\packages\durable
node --conditions=source --experimental-strip-types test/examples/41-managed-file-conflict.ts
```

## The presentation sequence to rehearse

Tell one coherent story: shared users submit work, ordering protects an agent conversation, independent agents can still conflict on files, and durable state makes failures inspectable. Finish with measured evidence, remaining limits and the next deliberate extension.

For eight minutes, spend roughly two on architecture and ownership, two on the live shared-agent GUI, two on a controlled race/managed API comparison, and two on recovery, load and deployment trade-offs. A backup terminal example or saved result is useful when model latency is unpredictable. Human rehearsal timing, live Codex and GCP delivery remain separate checks; a prepared outline is not evidence those checks ran. Do not expose `.env` values while screen-sharing.
