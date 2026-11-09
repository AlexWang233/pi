// In-process host composition using real Durable and HTTP, with deterministic provider I/O.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { type FauxProviderHandle, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import {
	type CollaborativeThread,
	createCollaboration,
	type ExternalAgentDriver,
} from "@earendil-works/pi-durable/collaboration";
import { createDemoServer } from "../src/server.ts";

export const context = BACKGROUND_CONTEXT;
export const aliceToken = "fixture-alice-token-not-a-secret";
export const bobToken = "fixture-bob-token-not-a-secret";
export const outsiderToken = "fixture-outsider-not-a-secret";

type Fixture = {
	url: string;
	harness: Awaited<ReturnType<typeof Harness.open>>;
	thread: CollaborativeThread;
	faux: FauxProviderHandle;
	demo: Awaited<ReturnType<typeof createDemoServer>>;
	externalCalls(): number;
	request(path: string, token?: string, init?: RequestInit): Promise<Response>;
	close(): Promise<void>;
};

/** Start an ephemeral local server around one actual package-owned thread. */
export async function fixture(driver?: ExternalAgentDriver, workspace = process.cwd()): Promise<Fixture> {
	let calls = 0;
	const collaboration = createCollaboration([
		driver ?? {
			name: "fixture",
			open: async () => ({
				run: async () => {
					calls++;
					return { status: "completed", text: "external answer", continuation: null };
				},
				close: async () => {},
			}),
		},
	]);
	const registry = createRegistry();
	registry.install(collaboration.extension);
	const models = createModels();
	const faux = fauxProvider();
	faux.setResponses([fauxAssistantMessage("native answer"), fauxAssistantMessage("follow-up answer")]);
	models.setProvider(faux.provider);
	const harness = await Harness.open(
		new MemoryStorage(),
		{ models, registry, settings: { afterFailedRun: "withdraw" } },
		context,
	);
	const config = {
		id: "room",
		workspace,
		members: ["alice", "bob"],
		agents: [
			{ id: "pi", kind: "native" as const, model: { provider: "faux", modelId: "faux-1" } },
			{ id: "external", kind: "external" as const, driver: driver?.name ?? "fixture" },
		],
		maxCommands: 4,
	};
	const thread = await collaboration.open(harness, config, context);
	const demo = await createDemoServer(
		{
			threads: new Map([[config.id, { thread, config }]]),
			tokens: new Map([
				[aliceToken, "alice"],
				[bobToken, "bob"],
				[outsiderToken, "mallory"],
			]),
			assets: new Map([["/", { contentType: "text/html", body: "<h1>fixture</h1>" }]]),
		},
		context,
	);
	await new Promise<void>((resolve, reject) => {
		demo.server.once("error", reject);
		demo.server.listen(0, "127.0.0.1", resolve);
	});
	const address = demo.server.address();
	if (address === null || typeof address === "string") throw new Error("Expected TCP address");
	const url = `http://127.0.0.1:${address.port}`;
	return {
		url,
		harness,
		thread,
		faux,
		demo,
		externalCalls: () => calls,
		request: (path: string, token = aliceToken, init?: RequestInit) =>
			fetch(url + path, {
				...init,
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
			}),
		async close() {
			await demo.close();
			await harness.close(context);
		},
	};
}

/** Build the shared route used for both native and external lanes. */
export function lane(agentId = "pi"): string {
	return `/api/threads/room/agents/${agentId}`;
}
