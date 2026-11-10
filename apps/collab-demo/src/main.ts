// Compose real provider/CLI execution with SQLite and the local HTTP demo.
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { createCodexDriver } from "@earendil-works/pi-durable/adapters/codex";
import { createCollaboration } from "@earendil-works/pi-durable/collaboration";
import type { ShellExecOptions } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { loadAssets } from "./assets.ts";
import { parseConfiguration } from "./configuration.ts";
import { ConflictDemo } from "./conflict-demo.ts";
import { waitForHostShutdown } from "./lifetime.ts";
import { createDemoServer } from "./server.ts";
import { prepareHost } from "./startup.ts";

// Clamp every native tool shell invocation, including when the model omits a timeout.
class DemoExecutionEnv extends NodeExecutionEnv {
	override exec(command: string | readonly string[], options: ShellExecOptions | undefined, context: Context) {
		return super.exec(command, { ...options, timeout: Math.min(options?.timeout ?? 60, 60) }, context);
	}
}

const context = BACKGROUND_CONTEXT;
const config = parseConfiguration(JSON.parse(await readFile(process.env.COLLAB_CONFIG ?? "config.local.json", "utf8")));
const { port, tokens, models, data, workspace } = prepareHost(config, process.env, process.cwd());
for (const agent of config.agents) {
	if (agent.kind !== "native") continue;
	if (!(await models.getAuth(agent.model.provider)))
		throw new Error(`Configure credentials for ${agent.model.provider}`);
}
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
let conflictDemo: ConflictDemo | undefined;
try {
	const threadConfig = {
		id: "project",
		workspace,
		members: config.members.map((member) => member.id),
		agents: config.agents,
	};
	const thread = await collaboration.open(harness, threadConfig, context);
	if (threadConfig.members.length >= 2)
		conflictDemo = await ConflictDemo.open(resolve(data, "conflict-demo"), threadConfig.members, context);
	const demo = await createDemoServer(
		{ threads: new Map([[threadConfig.id, { thread, config: threadConfig, conflictDemo }]]), tokens, assets },
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
		await waitForHostShutdown(harness.closed);
	} finally {
		await demo.close();
	}
} finally {
	try {
		await conflictDemo?.close(context);
	} finally {
		await harness.close(context);
	}
}
