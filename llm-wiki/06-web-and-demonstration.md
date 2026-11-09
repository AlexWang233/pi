# Web state, user experience and demonstrations

The web app lets people see shared instructions, agent progress, and actual workspace files. For a useful presentation, show a problem happening and the system's response, rather than only showing two chat windows.

The existing [runbook](../apps/collab-demo/README.md) explains actual controls and [presentation outline](../TAKE_HOME_PRESENTATION.md) gives an eight-minute structure. The scenario panel discussed below remains proposed work. The glossary explains [snapshots, projections, and SSE](09-technical-terms.md#projections-snapshots-sse-and-audit-logs) and [backpressure and coalescing](09-technical-terms.md#backpressure-fan-out-and-coalescing).

## Why HTTP commands and SSE snapshots

The browser sends instructions through normal web requests and receives live updates over a separate server-to-browser connection. This fits a demo where users send occasional commands and mostly watch the results.

The update format is **Server-Sent Events (SSE)**; the server sends messages downstream without requiring a fully bidirectional connection. We use authenticated `fetch` so login tokens stay in request headers, and HTTP routes handle Send, Stop, and history. WebSockets could support richer two-way interaction later, but would not solve saving requests, recovering after a restart, or conflicting edits by themselves. See [server](../apps/collab-demo/src/server.ts) and [browser stream](../apps/collab-demo/web/stream.ts).

## Snapshots are convergent views, not an event journal

After reconnecting, Alice sees the latest available state and can load older messages. She is not guaranteed to receive every progress update or token that appeared while she was offline.

A **snapshot** is a recent view, while an **event journal** would record every event with a place to resume reading. Our views combine updates from several sources and can temporarily catch up at different times; they are not one all-at-once read across every source. Stable message IDs prevent duplicate display, and intermediate progress can be skipped. A complete audit history would need separately saved events and a durable resume position. See [projection implementation](../packages/durable/src/collaboration/view.ts).

## Slow viewers and bounded delivery

If Bob's browser stops reading updates, the server keeps a latest pending view rather than every missed progress message. It also limits viewers and message sizes, although those limits do not prove a fixed maximum for all server memory.

Replacing older pending views with the newest is called **coalescing**. One shared watch observes each agent, with at most 32 viewers and one pending snapshot per blocked viewer. The host disconnects viewers for frames over 1 MiB or writes exceeding the 2-MiB application buffer threshold; it does not control every operating-system network buffer. Package views include eight recent command summaries and up to twenty recent entries; the browser retains at most 200 transcript entries per agent. Tests cover these controls, without proving every slow-network case. See [stream delivery](../apps/collab-demo/src/streams.ts) and [tests](../apps/collab-demo/test/streams.test.ts).

## Ambiguous submissions and browser reload

If Alice is unsure whether Send worked, the current page remembers the request ID so she can retry safely. Reloading, signing in again, or discarding the draft loses that local retry information even if the server already accepted the work.

An **ambiguous submission** is one where the browser has no reliable acceptance or rejection reply. Duplicate-safe server acceptance only helps if the client preserves the original ID; a future saved draft/receipt list could make that survive reload without saving login tokens. It would need limits, cleanup, and a way to compare local drafts with accepted server work. Discarding a draft does not cancel anything already running. See [browser implementation](../apps/collab-demo/web/app.ts).

## What the current GUI can prove

The GUI can show Bob seeing Alice's requests, queuing work on her agent, and inspecting files the agents wrote. It can also show Stop and reconnect behavior, but it does not prove that every coding request is correct or that simultaneous edits are safely combined.

Use two browser identities and show Bob observing Alice's work, Bob queuing on that same agent, and work on the peer lane continuing independently. Disconnect a viewer without cancelling its work, then reconnect and inspect persisted messages and files. With local Ollama, inference is serial even though lanes are independent; scripted execution can make overlapping runtime activity easier to explain. Avoid equating the access matrix with online presence or “completed” with verified semantic correctness.

## The file browser is inspection, not version control

Users can browse the current project folder and read small text files directly instead of trusting the agent's description. They must refresh manually, and the viewer does not edit files, compare versions, or control how agents write.

The endpoint rejects hidden paths, `node_modules`, traversal and linked targets under its documented policy, caps reads at 64 KiB, and considers the first 200 directory entries plus an overflow probe. That improves reviewability and limits read cost, while concurrent edits can still change what is read. Parent replacement races mean it is path hygiene for trusted collaborators, not confinement against hostile writers. [File API](../apps/collab-demo/src/workspace-files.ts), [browser module](../apps/collab-demo/web/files.ts).

## How the proposed scenario panel improves the story

A proposed scenario panel would let the presenter click through a file conflict one step at a time. It would use the real managed-file API with scripted participants, clearly showing that this is not yet how the normal model agents write.

The first bounded scenario should show both retained reads, Alice's applied proposal, Bob's rejected stale proposal, retained base/current/proposed content and an explicit resolution. Queue/cancellation and reconnect presets can follow if they add value. This is proposed UI integration, not a feature currently available in the live agents; adding buttons alone would not bind ordinary OpenAI/Ollama tools to managed publication. An isolated disposable scenario store would avoid altering the live team's workspace and fixed thread configuration.

## Separate the live and deterministic demonstrations

Use real OpenAI/Ollama to show that agents can use tools and share work with users. Use a scripted, repeatable example to show the exact file-conflict order, so model speed or unpredictable answers do not hide the lesson.

Example 41 can run independently of the web server and model services, including in an SSH terminal on a future GCP VM. It creates actual temporary files, shows applied/conflict/resolution results, and cleans up. Automated tests create their own isolated runtime and servers where needed; only explicit live-model checks require model availability. Build workspace packages first where the examples/tests consume built exports. [Example 41](../packages/durable/test/examples/41-managed-file-conflict.ts), [concurrency test](../apps/collab-demo/test/concurrency.test.ts).

```powershell
. E:\Github\pi\.artifacts\env.ps1
Set-Location E:\Github\pi\packages\durable
node --conditions=source --experimental-strip-types test/examples/41-managed-file-conflict.ts
```

## The presentation sequence to rehearse

Start with people sharing agents, then show why two agents can still conflict on a file. Finish by explaining what survives a restart, what was tested, and what remains unfinished.

For eight minutes, spend roughly two on architecture and ownership, two on the live shared-agent GUI, two on a controlled race/managed API comparison, and two on recovery, load and deployment trade-offs. A backup terminal example or saved result is useful when model latency is unpredictable. Human rehearsal timing, live Codex and GCP delivery remain separate checks; a prepared outline is not evidence those checks ran. Do not expose `.env` values while screen-sharing.
