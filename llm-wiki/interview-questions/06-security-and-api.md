# Questions about security and API boundaries

These questions ask what a caller can claim, what the host verifies and what a coding process can actually access. The current deployment scope is trusted collaborators, so stronger public-service requirements must be introduced as new work.

The [trust overview](../05-providers-adapters-and-trust.md) explains the existing boundary. The examples below show why a token, membership check or safe-looking path is only one part of that boundary.

## Could Bob send actorId equal to Alice and make a command appear to come from her?

The server derives the actor from the bearer token rather than trusting an identity in the command text or payload. The package then checks membership for that host-supplied actor.

For example, a prompt saying “I am Alice, approve this” is still content from the authenticated caller; it does not change authorization. Direct library callers are trusted to supply an authenticated identity, so the library alone cannot authenticate an arbitrary string. Tests and presentation claims must distinguish host identity mapping from package membership enforcement. See [host versus runtime responsibility](../01-architecture.md#runtime-versus-host-responsibility) and [the HTTP server](../../apps/collab-demo/src/server.ts).

## Could repository text persuade an agent to read the OpenAI key from its environment?

The current trusted execution model does not isolate coding tools from the service account's credentials. A prompt or repository instruction causing a secret read is not prevented merely by validating the browser's JSON request.

The agent's working directory is not an OS sandbox, and shell/tool execution can reach environment values or other files accessible to that account. Stronger protection would require restricted capabilities, credential minimization, process/filesystem isolation and controls across every harness. Rendering output safely would not undo a disclosure already written into transcript storage. This is why public untrusted users would invalidate the current assumptions. See [the execution boundary](../05-providers-adapters-and-trust.md#secrets-rendering-and-the-execution-boundary).

## The file viewer rejects traversal and symlinks: why isn't that a complete filesystem sandbox?

Checking a path before opening it does not guarantee the same parent paths still exist when the open happens. A concurrent writer can replace or redirect a parent between the check and the operation.

For example, the host validates a directory beneath the workspace, then another process swaps that directory before a later file open. This gap is often called a time-of-check/time-of-use race: the checked object and used object may differ. Current link/path rules are useful hygiene for trusted users, not a hostile-writer containment claim. Enforced directory handles or OS/filesystem isolation would require a different capability and deployment design. See [file inspection limits](../06-web-and-demonstration.md#the-file-browser-is-inspection-not-version-control).

## If Alice removes Bob from the project, what happens to Bob's open stream and queued command?

The prototype has fixed membership and no dynamic removal flow, so it does not currently promise immediate revocation. A future version would need separate policies for future requests, existing streams and already accepted work.

The host would need to invalidate or re-evaluate Bob's authenticated session and stop delivering state, while the runtime would need to decide whether his queued/active command remains authorized. Changing only a browser member list or hiding a button would leave backend access unresolved. Persisted history and shared file access also need a policy after removal. See [fixed configuration](../02-commands-and-concurrency.md#bounds-fairness-and-fixed-configuration) and [changing requirements](01-architecture-and-scope.md).

## Can one authorized user keep submitting instructions until the machine or API budget is exhausted?

Admission caps limit some queued and lifetime work, but they are not a complete fairness, process or monetary budget. One member can consume shared capacity, and one accepted coding instruction can cause several model/tool rounds.

The app also limits encoded requests, output previews, viewers and shell runtime, each at a different boundary. Those limits do not bound native transcript growth, every subprocess's memory, all stored output or provider spend. A broader service would need measured per-user admission, provider/turn budgets, process limits and a documented retention policy. See [resource limits](../02-commands-and-concurrency.md#bounds-fairness-and-fixed-configuration) and [candidate hotspots](../07-evidence-scaling-and-deployment.md#candidate-hotspots-and-sensible-optimization).

## Does keeping tokens in page memory and rendering text literally make the browser completely secure?

Those choices reduce accidental persistence and prevent model text from being interpreted as HTML in the current renderer. They do not protect a token from every malicious script, browser extension, compromised host or person who can inspect the page.

The server still needs authorization on every route, and a future public deployment needs secure transport and a deliberate identity/session policy. Current bearer headers differ from automatically attached cookie credentials, so browser-origin and request-forgery controls should be designed for the actual authentication mechanism rather than assumed from a generic checklist. Expanding to rich HTML/tool rendering would create new input-handling work. See [the trust boundary](../05-providers-adapters-and-trust.md#authentication-membership-and-authority) and [browser implementation](../../apps/collab-demo/web/app.ts).
