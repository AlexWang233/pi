# Questions about requests and concurrent users

These questions follow instructions from the browser into the runtime and back to users. The important distinction is whether the question concerns acceptance, scheduling, observation or cancellation.

The [command lifecycle](../02-commands-and-concurrency.md) explains the general flow. Here the situations are more specific: lost replies, ambiguous retries and users acting on a shared agent at nearly the same time.

## Alice clicks Send, receives no reply, and clicks again: could that create two jobs?

It depends on whether the second request preserves the original command identity and text. With the same scoped ID/text, Durable returns the existing receipt; a newly generated ID is a distinct instruction and can admit another job.

The dangerous trace is “database commits, HTTP response is lost,” because the browser cannot infer rejection from a missing reply. The client retains an ambiguous draft's ID/text in page memory for that retry. Reloading or discarding the draft can lose the local retry record even though server work continues. This is why server-side duplicate protection and a reload-safe client experience are separate requirements. See [retry identity](../02-commands-and-concurrency.md#retry-identity-and-idempotent-admission) and [browser reload](../06-web-and-demonstration.md#ambiguous-submissions-and-browser-reload).

## Why can Alice and Bob use the same command ID without colliding?

The ID is scoped by thread, authenticated actor and target agent, rather than being one global string. Alice's `edit-1` to A and Bob's `edit-1` to A therefore identify different accepted commands.

Within one scope, reusing `edit-1` with different text is rejected because otherwise an ambiguous retry could change the meaning of an earlier command. The actor comes from host authentication, not a user-supplied claim inside the message. The concurrency tests deliberately reuse IDs across six user/agent pairs to verify this distinction. See [admission code](../../packages/durable/src/collaboration/thread.ts) and [the M:N test](../../apps/collab-demo/test/concurrency.test.ts).

## If Alice and Bob submit conflicting requests to the same agent together, which runs first?

The package admits requests on its serialized transaction line, and the demo's native agent processes follow-ups one at a time. The chosen order is the server's committed order, not a promise that the earliest mouse click or fastest HTTP reply wins.

Alice's “use React” and Bob's “use Vue” become attributed ordered inputs, but the runtime does not decide whose requirement has authority. Other lanes can progress while this lane is busy. Hosts can also change native inbox settings, so describe the demonstrated one-at-a-time policy rather than promising every possible configuration uses it. See [instruction conflict](../02-commands-and-concurrency.md#contradictory-instructions-are-a-human-policy-problem).

## JavaScript runs on one event loop, so how can two agents still lose a file edit?

One JavaScript callback runs at a time, but an asynchronous operation can pause at a read or model request and let another operation progress. Two agents can therefore both retain old file content before either publishes a replacement.

For example, A reads `base`, awaits inference, B reads `base`, A writes `base + alice`, and B later writes `base + bob`. No two JavaScript statements need to run at the identical instant for Alice's change to disappear. A lock around only an individual write also misses the earlier stale read. See [the lost-update trace](../04-files-and-conflicts.md#the-lost-update-example-to-remember).

## Bob presses Stop while Alice is working on that shared agent: what happens to each user's work?

Stop targets the lane, so it can cancel Alice's active ordinary work and Bob's queued user input on that lane. It does not cancel the other agent lane or reverse file changes already made.

The current control does not carry an expected command version, so clicking as one command finishes can affect the next command on the lane. A later command-specific stop would need an expected command ID and a stale-action policy. The UI should make the shared scope explicit, and protocol cancellation must still be distinguished from verified process termination. See [stop semantics](../02-commands-and-concurrency.md#cancellation-and-what-busy-means).

## Alice disconnects for a minute while Bob continues: what should she see after reconnecting?

Her disconnect stops observation, not accepted agent work. Reconnect fetches current bounded state and can load earlier history, but does not promise delivery of every missed token or transient progress event.

Stable entry IDs let the browser merge committed messages without displaying a second copy. The stream has no durable global replay cursor, and projections can coalesce intermediate updates. If the latest window no longer contains all missing history, the client must page it rather than infer that no work occurred. This is recovery of current state and history, not a complete real-time audit log. See [snapshot semantics](../06-web-and-demonstration.md#snapshots-are-convergent-views-not-an-event-journal).
