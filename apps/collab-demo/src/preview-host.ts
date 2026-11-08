// A separate deterministic host composition: real Durable/tools/HTTP, simulated model and CLI I/O.
import { writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { type CollaborativeThreadConfig, createCollaboration } from "@earendil-works/pi-durable/collaboration";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { loadAssets } from "./assets.ts";
import { createDemoServer } from "./server.ts";

type PreviewHost = { server: Server; harness: Awaited<ReturnType<typeof Harness.open>>; close(): Promise<void> };

/** Open a credential-free preview in an existing disposable directory. */
export async function openPreview(
	workspace: string,
	tokens: ReadonlyMap<string, string>,
	context: Context,
): Promise<PreviewHost> {
	const models = createModels();
	const faux = fauxProvider();
	models.setProvider(faux.provider);
	faux.setResponses(
		Array.from({ length: 256 }, () => [
			fauxAssistantMessage(
				fauxToolCall("write", { path: "native-preview.txt", content: "Deterministic native tool write" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Simulated model: the real Pi write tool created native-preview.txt."),
		]).flat(),
	);
	const collaboration = createCollaboration([
		{
			name: "preview",
			open: async ({ workspace: cwd }) => ({
				run: async ({ text, progress, signal }) => {
					await progress("Simulated external harness: waiting, then writing external-preview.txt");
					await delay(500, undefined, { signal });
					await writeFile(join(cwd, "external-preview.txt"), text, { signal });
					return {
						status: "completed",
						text: "Simulated external harness wrote external-preview.txt.",
						continuation: null,
					};
				},
				close: async () => {},
			}),
		},
	]);
	const registry = createRegistry();
	registry.install(CodingTools);
	registry.install(collaboration.extension);
	const harness = await Harness.open(
		new MemoryStorage(),
		{
			models,
			registry,
			settings: { afterFailedRun: "withdraw" },
			env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? workspace }),
		},
		context,
	);
	try {
		const config: CollaborativeThreadConfig = {
			id: "preview",
			workspace,
			members: ["alice", "bob"],
			agents: [
				{ id: "native-simulated", kind: "native", model: { provider: "faux", modelId: "faux-1" } },
				{ id: "external-simulated", kind: "external", driver: "preview" },
			],
		};
		const thread = await collaboration.open(harness, config, context);
		const demo = await createDemoServer(
			{ threads: new Map([[config.id, { config, thread }]]), tokens, assets: await loadAssets() },
			context,
		);
		return {
			server: demo.server,
			harness,
			async close(): Promise<void> {
				try {
					await demo.close();
				} finally {
					await harness.close(context);
				}
			},
		};
	} catch (error) {
		await harness.close(context);
		throw error;
	}
}
