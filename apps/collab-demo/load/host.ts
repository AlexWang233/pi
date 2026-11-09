// Disposable SQLite host for deterministic transport load; no model APIs or external processes.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { type FauxResponseFactory, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { type CollaborativeThreadConfig, createCollaboration } from "@earendil-works/pi-durable/collaboration";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createDemoServer, type HostedThread } from "../src/server.ts";

export type ExecutionSample = { starts: number; started: number; returned?: number };
export type LoadLane = { path: string; threadId: string; agentId: string };
export const loadToken = "load-alice-loopback-only";

/** Open independent thread stores and a shared real HTTP server in a caller-owned temporary root. */
export async function openLoadHost(root: string, threadCount: number, serviceMs: number, outputChars: number) {
	const context = BACKGROUND_CONTEXT;
	const threads = new Map<string, HostedThread>();
	const harnesses: Awaited<ReturnType<typeof Harness.open>>[] = [];
	const executions = new Map<string, ExecutionSample>();
	const lanes: LoadLane[] = [];
	const answer = "x".repeat(outputChars);
	const execute = async (key: string, signal?: AbortSignal) => {
		const previous = executions.get(key);
		const sample: ExecutionSample = { starts: (previous?.starts ?? 0) + 1, started: performance.now() };
		executions.set(key, sample);
		await delay(serviceMs, undefined, { signal });
		sample.returned = performance.now();
		return answer;
	};
	try {
		for (let index = 0; index < threadCount; index++) {
			const id = `thread-${index}`;
			const workspace = join(root, id, "workspace");
			await mkdir(workspace, { recursive: true });
			const collaboration = createCollaboration([
				{
					name: "load",
					open: async () => ({
						run: async ({ text, signal, progress }) => {
							await progress(answer);
							return { status: "completed", text: await execute(text, signal), continuation: null };
						},
						close: async () => {},
					}),
				},
			]);
			const faux = fauxProvider({ tokenSize: { min: 1024, max: 1024 } });
			const response: FauxResponseFactory = async (request, options) => {
				const input = request.messages.findLast((message) => message.role === "user")!;
				const text =
					typeof input.content === "string"
						? input.content
						: input.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
				return fauxAssistantMessage(await execute(text, options?.signal));
			};
			faux.setResponses(Array.from({ length: 256 }, () => response));
			const models = createModels();
			models.setProvider(faux.provider);
			const registry = createRegistry();
			registry.install(collaboration.extension);
			const harness = await Harness.open(
				await openNodeSqliteStorage(join(root, id, "thread.sqlite")),
				{
					models,
					registry,
					// Keep this workload at one response per command; compaction has separate runtime tests.
					settings: { afterFailedRun: "withdraw", compaction: { enabled: false } },
				},
				context,
			);
			harnesses.push(harness);
			const config: CollaborativeThreadConfig = {
				id,
				workspace,
				members: ["alice", "bob"],
				maxCommands: 256,
				maxPendingPerAgent: 8,
				agents: [
					{ id: "native", kind: "native", model: { provider: "faux", modelId: "faux-1" } },
					{ id: "external", kind: "external", driver: "load" },
				],
			};
			threads.set(id, { config, thread: await collaboration.open(harness, config, context) });
			for (const agent of config.agents)
				lanes.push({
					threadId: id,
					agentId: agent.id,
					path: `/api/threads/${id}/agents/${agent.id}`,
				});
		}
		const demo = await createDemoServer(
			{ threads, tokens: new Map([[loadToken, "alice"]]), assets: new Map() },
			context,
		);
		try {
			await new Promise<void>((resolve, reject) => {
				demo.server.once("error", reject);
				demo.server.listen(0, "127.0.0.1", resolve);
			});
			const address = demo.server.address();
			if (address === null || typeof address === "string") throw new Error("Expected TCP address");
			return {
				url: `http://127.0.0.1:${address.port}`,
				lanes,
				executions,
				async close() {
					try {
						await demo.close();
					} finally {
						await Promise.all(harnesses.map((harness) => harness.close(context)));
					}
				},
			};
		} catch (error) {
			await demo.close();
			throw error;
		}
	} catch (error) {
		await Promise.all(harnesses.map((harness) => harness.close(context)));
		throw error;
	}
}
