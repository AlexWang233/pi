// Two cooperative agent proposals share a base: one applies, one conflicts, then explicitly resolves.
// No model/CLI is invoked. This exercises the package API, not protection of direct shell writes.
// Run from packages/durable:
//   node --conditions=source --experimental-strip-types test/examples/41-managed-file-conflict.ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createCollaboration, ManagedFile } from "../../src/collaboration/index.ts";
import { NodeExecutionEnv } from "../../src/env/node.ts";
import { createRegistry, Harness, MemoryStorage } from "../../src/index.ts";

const context = BACKGROUND_CONTEXT;
const workspace = await mkdtemp(join(tmpdir(), "pi-managed-example-"));
const collaboration = createCollaboration();
const registry = createRegistry();
registry.install(collaboration.extension);
const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
try {
	await collaboration.open(
		harness,
		{
			id: "managed-example",
			workspace,
			members: ["alice", "bob"],
			agents: [
				{ id: "agent-a", kind: "native", model: { provider: "faux", modelId: "faux-1" } },
				{ id: "agent-b", kind: "external", driver: "not-invoked" },
			],
		},
		context,
	);
	await writeFile(join(workspace, "shared.txt"), "base");
	const file = await ManagedFile.open(harness, new NodeExecutionEnv({ cwd: workspace }), "shared.txt", context);

	// Both agents retain the same content before preparing their independent edits.
	await file.read("alice", "agent-a", "read-1", context);
	await file.read("bob", "agent-b", "read-1", context);
	console.log(
		"Alice:",
		await file.propose(
			"alice",
			{
				id: "edit-1",
				agentId: "agent-a",
				baseId: "read-1",
				content: "base + alice",
			},
			context,
		),
	);
	console.log(
		"Bob:",
		await file.propose(
			"bob",
			{
				id: "edit-1",
				agentId: "agent-b",
				baseId: "read-1",
				content: "base + bob",
			},
			context,
		),
	);
	console.log("Current (Alice preserved):", await readFile(join(workspace, "shared.txt"), "utf8"));

	// Explicitly reread and propose a combined change. No automatic merge or agent-turn replay.
	await file.read("bob", "agent-b", "read-2", context);
	console.log(
		"Resolution:",
		await file.propose(
			"bob",
			{
				id: "edit-2",
				agentId: "agent-b",
				baseId: "read-2",
				content: "base + alice + bob",
			},
			context,
		),
	);
	console.log("Retained evidence:", await file.proposals("alice", context));
} finally {
	await harness.close(context);
	await rm(workspace, { recursive: true, force: true });
}
