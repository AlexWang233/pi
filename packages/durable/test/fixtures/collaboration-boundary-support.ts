// Shared deterministic native/external declarations for admission, storage-fault and owner-kill tests.
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { obj } from "@earendil-works/pi-schema";
import { type CollaborativeThreadConfig, createCollaboration } from "../../src/collaboration/index.ts";
import { createRegistry, defineTool } from "../../src/index.ts";

export type Boundary = "before-admission" | "after-admission" | "native-request" | "native-tool";

/** Use the same declarations on both sides of a crash, with a caller-supplied execution barrier. */
export function boundaryRuntime(workspace: string, barrier: (boundary: Boundary) => Promise<void>) {
	const collaboration = createCollaboration([
		{
			name: "controlled",
			open: async () => ({
				run: async () => {
					await appendFile(join(workspace, "external.txt"), "effect\n");
					return { status: "completed", text: "external answer", continuation: null };
				},
				close: async () => {},
			}),
		},
	]);
	const registry = createRegistry();
	registry.install(collaboration.extension);
	registry.install({
		name: "boundary-tools",
		tools: [
			defineTool({
				name: "side_effect",
				description: "Append once to a disposable file",
				parameters: obj({}),
				replay: "unsafe",
				execute: async () => {
					await appendFile(join(workspace, "tool.txt"), "effect\n");
					await barrier("native-tool");
					return {};
				},
			}),
		],
	});
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses(
		Array.from({ length: 4 }, () => async () => {
			await appendFile(join(workspace, "model.txt"), "request\n");
			await barrier("native-request");
			return fauxAssistantMessage("native answer");
		}),
	);
	const config: CollaborativeThreadConfig = {
		id: "boundary",
		workspace,
		members: ["alice", "bob"],
		agents: [
			{ id: "native", kind: "native", model: { provider: "faux", modelId: "faux-1" } },
			{ id: "external", kind: "external", driver: "controlled" },
		],
	};
	return {
		collaboration,
		registry,
		models,
		config,
		faux,
		toolCall: fauxAssistantMessage(fauxToolCall("side_effect", {}), { stopReason: "toolUse" }),
	};
}
