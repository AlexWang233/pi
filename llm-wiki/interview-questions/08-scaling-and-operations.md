# Questions about scaling and operating the system

These questions change the number of users, owners or machines and ask whether today's guarantees still hold. Keep storage, workspace access, external processes and transport as separate resources when reasoning about deployment.

The [scaling/deployment overview](../07-evidence-scaling-and-deployment.md) describes the current one-owner plan and its evidence limits. The GCP preparation files are a design and runbook, not an already verified deployment.

## Could we scale by starting two web servers against the same thread database and workspace?

That would violate the current single-owner assumption instead of safely adding capacity. Both owners could interpret tasks or launch effects while sharing files, so a database transaction alone would not make their external work mutually exclusive.

A safer next boundary is assigning independent threads to exclusive owners with isolated workspaces and tested recovery. View-only frontends could be a separate concern, but they still need an authoritative owner for commands/state and a coherent routing policy. Ownership transfer must ensure old writers cannot continue after a new owner starts. See [failure domains](../07-evidence-scaling-and-deployment.md#single-points-of-failure-and-scaling) and [workspace ownership](03-file-conflicts.md#why-not-just-lock-the-workspace-until-an-agent-finishes-its-instruction).

## Would moving the metadata to PostgreSQL make the agents safely run on several machines?

A shared database could make metadata accessible across machines, but would not automatically share or isolate coding workspaces and provider sessions correctly. The system would still need ownership, routing, filesystem and process-lifetime rules.

For example, owner A could lose its database lease while its shell continues writing to shared storage; owner B starting a replacement can then race that old shell. Preventing new database commits from A does not prevent all filesystem writes from A. Database choice should follow the required ownership/failure model rather than be treated as the complete scaling solution. See [the database trade-off](../07-evidence-scaling-and-deployment.md#why-sqlite-rather-than-adding-postgresql-or-redis-immediately).

## What happens when a thread reaches 256 commands, and why not delete old receipts automatically?

At the default lifetime cap, new admission rejects while existing receipts remain retryable. Automatically forgetting old identities would change the answer to a delayed retry and could allow an old intention to be admitted again.

The prototype chooses bounded retained receipts over an unbounded thread lifetime. A later design could archive receipts with lookup support or explicitly define a retry-expiration window and new identity epoch, but those are changes to the API contract. Simply deleting the oldest records is not a transparent storage optimization. The per-lane pending cap is a different limit: it can free capacity as work settles, whereas the lifetime cap does not. See [admission bounds](../02-commands-and-concurrency.md#bounds-fairness-and-fixed-configuration).

## One browser stops reading output: can that stall agents or consume unlimited memory?

The host coalesces lane snapshots and limits viewers, frames and application write buffering, so it does not keep an unbounded queue of every progress update for that browser. Those controls do not establish a whole-process memory bound or prove every kernel socket behavior.

Each lane shares one package watch, and a blocked viewer keeps only a latest pending snapshot under the documented thresholds. Execution is independent of viewer lifetime, so disconnecting that browser does not cancel accepted work. Tests cover controlled buffering/coalescing, while the real paused-reader load case does not establish that kernel buffers saturated. See [delivery limits](../06-web-and-demonstration.md#slow-viewers-and-bounded-delivery) and [the stream implementation](../../apps/collab-demo/src/streams.ts).

## Why isn't copying thread.sqlite while the demo is running enough for a recovery backup?

The system's recoverable state includes workspace files and potentially SQLite sidecar state, not just one main database filename. A copy taken while writers continue can also capture a database and workspace from different logical moments.

The prepared procedure stops the service, verifies writers are gone and archives the complete data directory, with credentials/configuration handled separately. Restore must be tested in an isolated stopped installation with compatible fixed configuration and workspace location. An online backup strategy could be designed later, but would need explicit consistency across database and agent filesystem effects. See [backup acceptance](../07-evidence-scaling-and-deployment.md#backups-and-operational-acceptance) and [the deployment runbook](../../apps/collab-demo/deploy/README.md).

## Why disable automatic service restart on the planned GCP VM?

Automatic restart could bring a replacement owner online before old descendants or uncertain filesystem effects have been inspected. The current preparation chooses manual recovery and lower availability rather than implying that process restart alone makes takeover safe.

The service template requests cgroup cleanup, a required data mount and a cooperative owner lock, but those policies still need Linux verification with actual tools. Before enabling more automatic recovery, demonstrate that former writers stop, reopened receipts/history remain correct and uncertain external work is not blindly resent. Reboot, missing-mount, restore and evaluator-access checks also remain part of actual deployment delivery. See [process recovery](../03-durability-and-recovery.md#stop-graceful-close-and-process-death) and [prepared GCP policy](../../apps/collab-demo/deploy/README.md).
