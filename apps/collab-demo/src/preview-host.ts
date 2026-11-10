// A separate deterministic host composition: real Durable/tools/HTTP, simulated model and CLI I/O.
import { writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	type FauxResponseFactory,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { type CollaborativeThreadConfig, createCollaboration } from "@earendil-works/pi-durable/collaboration";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { loadAssets } from "./assets.ts";
import { ConflictDemo } from "./conflict-demo.ts";
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
	const writeResponse: FauxResponseFactory = async (request, options) => {
		const input = request.messages.findLast((message) => message.role === "user")!;
		const text =
			typeof input.content === "string"
				? input.content
				: input.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
		await delay(700, undefined, { signal: options?.signal });
		const shared = text.startsWith("shared: ");
		return fauxAssistantMessage(
			fauxToolCall("write", {
				path: shared ? "shared-preview.txt" : "native-preview.txt",
				content: shared ? text.slice(8) : "Deterministic native tool write",
			}),
			{ stopReason: "toolUse" },
		);
	};
	faux.setResponses(
		Array.from({ length: 256 }, () => [
			writeResponse,
			fauxAssistantMessage(
				"Simulated model: the real Pi write tool completed. A shared: prefix targets shared-preview.txt.",
			),
		]).flat(),
	);
	const collaboration = createCollaboration([
		{
			name: "preview",
			open: async ({ workspace: cwd }) => ({
				run: async ({ text, progress, signal }) => {
					const shared = text.startsWith("shared: ");
					const file = shared ? "shared-preview.txt" : "external-preview.txt";
					await progress(`Simulated external harness: waiting, then writing ${file}`);
					await delay(500, undefined, { signal });
					await writeFile(join(cwd, file), shared ? text.slice(8) : text, { signal });
					return {
						status: "completed",
						text: `Simulated external harness wrote ${file}.`,
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
	let conflictDemo: ConflictDemo | undefined;
	try {
		const config: CollaborativeThreadConfig = {
			id: "preview",
			workspace,
			members: ["alice", "bob", "carol"],
			agents: [
				{ id: "native-simulated", kind: "native", model: { provider: "faux", modelId: "faux-1" } },
				{ id: "external-simulated", kind: "external", driver: "preview" },
			],
		};
		const thread = await collaboration.open(harness, config, context);
		conflictDemo = await ConflictDemo.open(
			join(workspace, ".conflict-demo"),
			config.members,
			{ kind: "scripted" },
			context,
		);
		const demo = await createDemoServer(
			{ threads: new Map([[config.id, { config, thread, conflictDemo }]]), tokens, assets: await loadAssets() },
			context,
		);
		return {
			server: demo.server,
			harness,
			async close(): Promise<void> {
				try {
					await demo.close();
				} finally {
					try {
						await conflictDemo?.close(context);
					} finally {
						await harness.close(context);
					}
				}
			},
		};
	} catch (error) {
		await conflictDemo?.close(context);
		await harness.close(context);
		throw error;
	}
}
