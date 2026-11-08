// Two members use independent native/external lanes on the same Durable store and directory.
// This example uses deterministic providers, not a live Codex model or paid API calls.
// Run from packages/durable:
//   node --conditions=source --experimental-strip-types test/examples/38-collaborative-thread.ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createCollaboration } from "../../src/collaboration/index.ts";
import { NodeExecutionEnv } from "../../src/env/node.ts";
import { createRegistry, Harness } from "../../src/index.ts";
import { openNodeSqliteStorage } from "../../src/storage/sqlite/node.ts";
import { CodingTools } from "../../src/tools/index.ts";

const context = BACKGROUND_CONTEXT;
const directory = await mkdtemp(join(tmpdir(), "pi-collaborative-example-"));

// Install execution code before opening the Harness. The application owns its lifetime.
const collaboration = createCollaboration([
	{
		name: "example",
		open: async ({ workspace }) => ({
			run: async ({ text, progress }) => {
				await progress("Writing the external agent's file");
				await writeFile(join(workspace, "external.txt"), text);
				return { status: "completed", text: "External file written", continuation: null };
			},
			close: async () => {},
		}),
	},
]);
const registry = createRegistry();
registry.install(CodingTools);
registry.install(collaboration.extension);
const models = createModels();
const faux = fauxProvider();
models.setProvider(faux.provider);
faux.setResponses([
	fauxAssistantMessage(fauxToolCall("write", { path: "native.txt", content: "Native agent change" }), {
		stopReason: "toolUse",
	}),
	fauxAssistantMessage("Native file written"),
]);
const harness = await Harness.open(
	await openNodeSqliteStorage(join(directory, "thread.sqlite")),
	{
		models,
		registry,
		settings: { afterFailedRun: "withdraw" },
		env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? directory }),
	},
	context,
);
try {
	const thread = await collaboration.open(
		harness,
		{
			id: "shared-project",
			workspace: directory,
			members: ["alice", "bob"],
			agents: [
				{ id: "pi", kind: "native", model: { provider: "faux", modelId: "faux-1" } },
				{ id: "peer", kind: "external", driver: "example" },
			],
		},
		context,
	);

	// Commands are attributed and durably admitted, then execute independently.
	const first = { id: "first", agentId: "pi", text: "Write native.txt" };
	await Promise.all([
		thread.submit("alice", first, context),
		thread.submit("bob", { id: "second", agentId: "peer", text: "External agent change" }, context),
	]);
	await harness.waitForIdle(context);
	console.log("Alice:", await thread.command("alice", "pi", "first", context));
	console.log("Bob:", await thread.command("bob", "peer", "second", context));
	console.log(
		"Shared files:",
		await readFile(join(directory, "native.txt"), "utf8"),
		"/",
		await readFile(join(directory, "external.txt"), "utf8"),
	);

	// Retry returns the same receipt, not another model/tool run.
	console.log("Retry:", await thread.submit("alice", first, context));
	const view = await thread.watch("bob", "pi", context);
	console.log("Bob sees Alice's lane:", view.value.messages);
	await view.stop();
} finally {
	await harness.close(context);
	await rm(directory, { recursive: true, force: true });
}
