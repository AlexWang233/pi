# Users, agents, and conflicting work

## Relationship model

A thread is a shared workspace with a list of users and a list of agents. Every member may
message every agent in that thread. The preview has three members and two agents:

| Member | Native Pi agent | External agent |
| --- | --- | --- |
| Alice | Message and observe | Message and observe |
| Bob | Message and observe | Message and observe |
| Carol | Message and observe | Message and observe |

These are six user/agent relationships, not three private copies of two agents. Each agent has
one history and queue shared across those users. Agent histories are separate from each other;
files are shared. Membership is fixed per thread/store. There is no per-agent permission model
or online-presence tracking in this prototype. The UI matrix shows access, not who is online.

`test/concurrency.test.ts` submits all six pairs concurrently through HTTP, intentionally using
the same command ID. All six are distinct because identity is `(thread, user, agent, command ID)`.
It verifies successful outcomes and all three authors visible to each member on both agents.

## Two users instruct the same agent

Suppose Alice says “make the heading red” and Bob says “make the heading blue” at the same time:

1. Both requests enter the package's serialized admission transaction. One commits first;
   wall-clock arrival or which user clicked first is not a priority guarantee.
2. The first command runs. The second remains queued on that same agent.
3. The second command runs after the first completes. It sees the same agent's accumulated
   history and current shared files. Both commands retain their authenticated author metadata.

The native demo uses Pi's default one-at-a-time follow-up inbox. External commands depend on
their predecessor tasks. A gated native-model test proves that the second model invocation
does not start while the first is blocked; the existing package tests cover external ordering.
Hosts can change native inbox settings: batching with `followUpMode: "all"` is not the policy
demonstrated here. Follow-ups do not interrupt a running command.

This covers the demo's foreground model/tool turns. Detached shell processes or custom host
tasks that outlive an answer are not protected by this queue ordering.

**Ordering is not conflict resolution.** Blue may overwrite red even though both commands run
correctly. There is no automatic decision about whose intent should win. Attribution is stored
and displayed; the runtime does not adjudicate contradictory instructions or assign user priority.

## Different agents edit the same file

Agents run independently, so two instructions can overlap:

```text
shared.txt = base
agent A reads base                 agent B reads base
agent A writes base|alice
                                  agent B writes base|bob
shared.txt = base|bob              Alice's change is lost
```

The test holds both agents after reading, then releases the two writes in that order. Both
commands report completed, and the final file contains only Bob's replacement. This is an
explicitly reproduced limitation, not a conflict-detection feature. Actual unsynchronized I/O
can also produce errors or partial/interleaved content; clean last-writer-wins is not guaranteed.

Pi's in-process tool queues do not coordinate all external CLI/shell writers, nor do they make
an agent's whole read/modify/write turn atomic. A SQLite admission transaction protects queue
records, not filesystem operations. Stopping an agent does not undo files it already changed.

## Other troublesome cases

| Situation | Current policy |
| --- | --- |
| Lost submit response | Same user/agent/ID/text returns the original receipt; changed text is 409 |
| Queue full | Reject new work with 429; existing receipts remain retryable |
| User disconnects | Observation closes; accepted work continues |
| Member stops an agent | Active and queued work on that lane stops, including other users' queued commands; peers continue |
| External failure | Already queued successors stop; a fresh command may be admitted after settlement |
| Native failed run | Demo host withdraws queued work; this is a Harness setting |
| Uncertain external dispatch on restart | Report interrupted; do not automatically resend possible filesystem effects |

These policies cover execution and delivery failures, not semantic agreement between users.
Forced-process crashes, full process-tree cleanup, and real-provider behavior still need the
separate validation listed in the project progress record.

## Reproduce in the browser

Restart `npm run preview` after rebuilding. Open three profiles with `preview-alice`,
`preview-bob`, and `preview-carol`; the page shows a 3×2 access matrix.

1. Alice and Bob both send a message to `native-simulated` before its short simulated response
   finishes. Observe one running command and one queued follow-up, with both authors visible.
2. While that lane is busy, Carol sends a command to `external-simulated`. It can progress
   independently. Swap users/targets to demonstrate that no agent belongs to one user.
3. Send `shared: Alice replacement` to either agent, then `shared: Bob replacement` to the
   other. Inspect `shared-preview.txt` in the temporary workspace printed by the launcher.
   Both target that file. Concurrent sends may overwrite each other; sequential sends replace
   the previous content deliberately. The prefix is preview syntax, not a real-agent protocol.

The short delays make the queue visible; the automated tests use explicit barriers to establish
ordering and overlap without relying on those delays. This preview remains simulated model/CLI
I/O. It does not establish a live Codex integration or a measured capacity result.

## Reasonable next protections

| Option | Benefit | Cost / limitation |
| --- | --- | --- |
| Retain concurrent agents with explicit conflict warning and human review | Smallest assignment scope; preserves agent concurrency | Does not prevent data loss; current implemented policy |
| Exclusive workspace ownership for an entire agent turn | Prevents overlapping participating turns from reading/writing stale workspace state | Serializes agents within a thread; independent threads can still run concurrently; all writers and crash cleanup must honor ownership |
| File-version checks and coordinated writes | Rejects stale edits while allowing unrelated-file concurrency | Must cover the complete read/modify/write operation and external shell/CLI writers; a Pi-only write hook is insufficient |

Do not add a lock around only the final write and call the problem solved: both agents may
already have read stale content. For a 20-hour take-home, present the reproduced limitation
clearly. If preventing it is required, workspace ownership for a whole turn is a smaller next
step than reliable cross-harness per-file coordination. Neither option resolves contradictory
human intentions; sequential commands can still deliberately reverse earlier changes.
