// Disposable child owner used by collaboration-recovery.test.ts; the parent kills it at an IPC barrier.
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createCollaboration } from "../../src/collaboration/index.ts";
import { createRegistry, Harness } from "../../src/index.ts";
import { openNodeSqliteStorage } from "../../src/storage/sqlite/node.ts";

const [workspace, boundary] = process.argv.slice(2);
// Fixture process arguments and IPC are the trust boundary; never run this against an existing store.
if (
	!workspace ||
	!["before-turn", "after-effect", "after-result", "restart-limit"].includes(boundary ?? "") ||
	!process.send
) {
	throw new Error("Expected disposable workspace, crash boundary and parent IPC channel");
}
const context = BACKGROUND_CONTEXT;
const reached = Promise.withResolvers<void>();
const collaboration = createCollaboration([
	{
		name: "controlled",
		open: async () => {
			await appendFile(join(workspace, "dispatches.txt"), "open\n");
			if (boundary === "before-turn") {
				reached.resolve();
				await new Promise<void>(() => {});
			}
			return {
				run: async ({ text }) => {
					await appendFile(join(workspace, "effects.txt"), `${text}\n`);
					if (boundary === "after-effect" || boundary === "restart-limit") {
						reached.resolve();
						await new Promise<void>(() => {});
					}
					return { status: "completed", text: "persisted answer", continuation: "controlled-session" };
				},
				close: async () => {},
			};
		},
	},
]);
const registry = createRegistry();
registry.install(collaboration.extension);
const harness = await Harness.open(
	await openNodeSqliteStorage(join(workspace, "thread.sqlite")),
	{ models: createModels(), registry },
	context,
);
const thread = await collaboration.open(
	harness,
	{
		id: "crash",
		workspace,
		members: ["alice", "bob"],
		agents: [{ id: "external", kind: "external", driver: "controlled" }],
	},
	context,
);
await thread.submit("alice", { id: "first", agentId: "external", text: "first-effect" }, context);
if (boundary === "after-result") await harness.waitForIdle(context);
else {
	await reached.promise;
	if (boundary !== "restart-limit")
		await thread.submit("bob", { id: "queued", agentId: "external", text: "queued-effect" }, context);
}
// No graceful close: the test waits for this committed boundary, kills this exact process, then reopens.
process.send({ type: "ready", boundary });
