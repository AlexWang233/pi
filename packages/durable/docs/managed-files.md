# Managed single-file edits

**Implemented:** an opt-in package API for one bounded text file per collaborative thread/store.
**Not yet connected:** native model tools, external Codex, HTTP routes, or the browser UI.
The existing demo still permits direct writes and its lost-update example remains valid.

## Problem and behavior

Alice's agent and Bob's agent both read `App.tsx = base`. Alice publishes `base + alice`.
Bob's replacement, computed from `base`, would erase Alice's work.

`ManagedFile` retains the original read and compares it with the current file while holding
the same in-process gate used for publication. Alice's edit applies; Bob's edit records a
`conflict` containing **base, current, and proposed content** and leaves the file unchanged.
This is optimistic concurrency control: prepare work concurrently, validate before publishing.

For this small slice the version comparison uses exact bounded UTF-8 content, including
existence and a byte-order mark, rather than a hash. This avoids another token format and
retains the bytes needed for review. It does not distinguish content changing away and back.

```typescript
import { ManagedFile } from "@earendil-works/pi-durable/collaboration";

// Open the collaborative thread first. The host owns this environment and authenticates callers.
const file = await ManagedFile.open(harness, env, "App.tsx", context);
await file.read("alice", "agent-a", "read-1", context);
await file.read("bob", "agent-b", "read-1", context);
await file.propose("alice", {
  id: "edit-1", agentId: "agent-a", baseId: "read-1", content: "base + alice",
}, context); // applied
await file.propose("bob", {
  id: "edit-1", agentId: "agent-b", baseId: "read-1", content: "base + bob",
}, context); // conflict, preserving Alice's file
const evidence = await file.proposals("alice", context);
```

The example assumes an initial file containing `base`; see the runnable example below for
complete setup. Agent IDs must exist in the thread. The host supplies the authenticated actor;
this API does not authenticate arbitrary strings or prove which model generated a proposal.
Proposal IDs are separate from command IDs; there is no command-to-proposal linkage yet.

Read and proposal identities are scoped by `(thread, actor, agent, id)`. Repeating a read ID
returns its retained base, even after disk changes. Repeating a proposal ID with the same
payload returns its recorded result without writing again; changing its payload conflicts.
Use **a new read ID and a new proposal ID** to explicitly resolve a stale proposal. A fresh
read does not invalidate the retained record or silently retry a model turn.

## Failure and recovery policy

| State | Meaning and next action |
| --- | --- |
| `applied` | The filesystem write and outcome commit returned successfully; this is not a power-loss durability guarantee |
| `conflict` | Current content differed from the retained base; no write was attempted; prepare a resolution from a fresh read |
| `prepared` | Durable intent exists but a final result is absent; a write may or may not have happened |
| `uncertain` | A write or post-write settlement failed; partial or complete changes may exist |

Intent is committed **before** filesystem I/O. A failed intent commit prevents writing.
If a write fails, the API attempts to record `uncertain`; if reporting also fails, `prepared`
remains. Either state blocks new managed reads and proposals. Existing receipts and retained
evidence remain readable. A same-ID retry returns the state without redispatching the write.

This slice deliberately has **no automatic unblock, reconciliation, rollback, or force-apply**.
Inspect the retained intent and disk while writers are stopped. Recovery tooling must establish
the outcome before unblocking; its API is follow-up work. Do not work around a blocked store
by opening a second owner or assuming the old writer died. A cancellation after intent can
also leave a blocked file. This favors preserving uncertain work over unattended availability.

Durable metadata and filesystem effects are separate transactions. Writes currently use the
environment's ordinary write operation, so partial writes are possible. No atomic replacement,
file/directory flush protocol, multi-file atomicity, or power-loss claim is made. Tests inject
write and settlement failures; they are not forced-process-kill or power-loss tests.

## Bounds and trust assumptions

- One fixed root-level filename per store, up to 128 portable characters; no nested paths or
  target changes on reopen. Final-component symbolic links and non-regular files are rejected
  by the environment's `openBinaryReader({ noFollow: true })` contract. The trusted workspace
  and its parent paths must remain stable; this is not a sandbox against path replacement or hard links.
- Valid UTF-8 text, at most **16,384 bytes**, no NUL; missing and empty files are distinct.
  Reads are bounded at the filesystem interface, rather than loading arbitrary files and clipping them.
- **64 retained reads and 32 retained proposals** over the store's lifetime. Existing retries
  remain available at capacity. No silent eviction, compaction, or unbounded artifact directory.
- All thread members may inspect all retained proposals, as with shared conversation histories.
  File content is persisted in the store; it must not contain credentials.
- One owner process per store/workspace. All protected writers must use this API. Ordinary
  `write`/`edit`, shells, external CLIs, manual editors, plugins, and other processes are not
  converted into conditional writes. They can invalidate these guarantees by bypassing the API.

The implementation reuses Durable documents and its existing file-mutation gate. No separate
storage engine, application queue, database service, provider SDK, or framework dependency was added.

## Evidence and presentation

From `packages/durable`:

```powershell
node ../../node_modules/vitest/dist/cli.js --run test/managed-file.test.ts
node --conditions=source --experimental-strip-types test/examples/41-managed-file-conflict.ts
```

The example creates real temporary files, demonstrates an applied edit, a retained conflict,
and an explicit combined proposal after a fresh read. It invokes no model or CLI.
Tests additionally cover concurrent handles, stable retries, create/create and edit/delete,
auth/read ownership, bounds/UTF-8, partial writes, failed intent/settlement, and SQLite reopen.

Present this beside the original lost-update test: it shows why conditional publication helps,
and why an unrestricted harness cannot be made safe merely by adding a new tool.

## Next increments

1. Bind model-facing managed read/propose tools to trusted command/actor context; expose retained
   conflicts over authorized HTTP and distinguish publication state from command state in the UI.
2. Restrict that execution mode to mediated filesystem tools, or implement whole-turn ownership
   and verified descendant cleanup for unrestricted shells/Codex. Keep concurrent mode explicit.
3. Add recovery inspection/reconciliation before making blocked stores unattended or long-lived.
4. Add Git-style three-way **candidates for review**, then version-bound publication; multi-file
   dependency validation, operation revisions, and finer concurrency remain later scope.
