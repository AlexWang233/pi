// Compose real provider/CLI execution with SQLite and the local HTTP demo.
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { createCodexDriver } from "@earendil-works/pi-durable/adapters/codex";
import { createCollaboration } from "@earendil-works/pi-durable/collaboration";
import type { ShellExecOptions } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { loadAssets } from "./assets.ts";
import { parseConfiguration } from "./configuration.ts";
import { createDemoServer } from "./server.ts";

// Clamp every native tool shell invocation, including when the model omits a timeout.
class DemoExecutionEnv extends NodeExecutionEnv {
	override exec(command: string | readonly string[], options: ShellExecOptions | undefined, context: Context) {
		return super.exec(command, { ...options, timeout: Math.min(options?.timeout ?? 60, 60) }, context);
	}
}

const context = BACKGROUND_CONTEXT;
const config = parseConfiguration(JSON.parse(await readFile(process.env.COLLAB_CONFIG ?? "config.local.json", "utf8")));
const port = Number(process.env.COLLAB_PORT ?? 4310);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("COLLAB_PORT must be 1..65535");
const tokens = new Map<string, string>();
for (const member of config.members) {
	const token = process.env[member.tokenEnv];
	if (!token || token.length < 24 || tokens.has(token))
		throw new Error(`Set a unique 24+ character ${member.tokenEnv}`);
	tokens.set(token, member.id);
}
const models = createModels();
for (const provider of [openaiProvider(), anthropicProvider(), googleProvider(), deepseekProvider()])
	models.setProvider(provider);
for (const agent of config.agents) {
	if (agent.kind !== "native") continue;
	if (!models.getModel(agent.model.provider, agent.model.modelId)) throw new Error(`Unknown model for ${agent.id}`);
	if (!(await models.getAuth(agent.model.provider)))
		throw new Error(`Configure credentials for ${agent.model.provider}`);
}
const data = resolve(process.env.COLLAB_DATA ?? "data");
const workspace = resolve(data, "workspace");
await mkdir(workspace, { recursive: true });
const collaboration = createCollaboration(
	config.agents.some((agent) => agent.kind === "external")
		? [createCodexDriver({ command: process.env.CODEX_BIN ?? "codex" })]
		: [],
);
const registry = createRegistry();
registry.install(CodingTools);
registry.install(collaboration.extension);
const assets = await loadAssets();

const harness = await Harness.open(
	await openNodeSqliteStorage(resolve(data, "thread.sqlite")),
	{
		models,
		registry,
		settings: { afterFailedRun: "withdraw" },
		env: ({ cwd }) => new DemoExecutionEnv({ cwd: cwd ?? workspace }),
	},
	context,
);
try {
	const threadConfig = {
		id: "project",
		workspace,
		members: config.members.map((member) => member.id),
		agents: config.agents,
	};
	const thread = await collaboration.open(harness, threadConfig, context);
	const demo = await createDemoServer(
		{ threads: new Map([[threadConfig.id, { thread, config: threadConfig }]]), tokens, assets },
		context,
	);
	try {
		await new Promise<void>((resolveListen, reject) => {
			demo.server.once("error", reject);
			demo.server.listen(port, "127.0.0.1", resolveListen);
		});
		harness.resume();
		console.log(`Collaborative Durable: http://127.0.0.1:${port} (workspace: ${workspace})`);
		console.log("Live agents enabled. Commands can spend provider tokens and modify the shared workspace.");
		await new Promise<void>((resolveStop) => {
			process.once("SIGINT", resolveStop);
			process.once("SIGTERM", resolveStop);
		});
	} finally {
		await demo.close();
	}
} finally {
	await harness.close(context);
}
