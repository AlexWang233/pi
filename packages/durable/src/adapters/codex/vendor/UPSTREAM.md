# T3 Codex client provenance

Source: `https://github.com/pingdotgg/t3code`, commit `d5fc29fe5cb62db68bfbf824cfabe0ae94ac6ac4`.

Copied from `packages/effect-codex-app-server/src/`:

- `client.ts`, `protocol.ts`, `errors.ts`, `replay.ts`
- `_internal/shared.ts`, `_internal/stdio.ts`
- `_generated/meta.gen.ts`, `_generated/schema.gen.ts`

The adjacent LICENSE retains the upstream MIT notice. Source files are initially unmodified.
Generated schemas are upstream artifacts, not hand-maintained Pi model catalog definitions.
Vendor source is excluded from Pi formatting/lint rewrites to retain provenance; it remains
included in TypeScript, dependency, and import-graph checks. Authored integration lives outside
this directory and follows the repository's normal checks. Effect/platform versions are pinned
to the inspected upstream workspace's 4.1.2.

Runtime use: typed Codex app-server transport/client. Test use: deterministic replay transport.
The complete T3 orchestration graph, provider-account management, UI, and credential files are
not imported. The adapter is exposed only through `/adapters/codex`.

`test/fixtures/collaboration-codex.json` derives from the same revision's
`apps/server/src/orchestration-v2/testkit/fixtures/simple/codex_transcript.ndjson`.
It retains the relevant recorded replies/notifications, replaces outbound initialization,
thread policy, and prompt expectations for this bridge, and omits unrelated notifications
and the final process-exit frame. Legacy frame normalization is the upstream replay code.
