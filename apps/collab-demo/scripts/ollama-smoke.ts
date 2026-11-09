// Opt-in real local inference over HTTP and SQLite; no paid providers, shell tools or external harness.
// From apps/collab-demo: node --conditions=source --experimental-strip-types scripts/ollama-smoke.ts --run
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, defineExtension, Harness } from "@earendil-works/pi-durable";
import { type CollaborativeThreadConfig, createCollaboration } from "@earendil-works/pi-durable/collaboration";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";
import { parseConfiguration } from "../src/configuration.ts";
import { createDemoServer } from "../src/server.ts";
import { prepareHost } from "../src/startup.ts";

if (!process.argv.includes("--run"))
	throw new Error("Start local Ollama, then add --run to opt into real local inference");
const started = performance.now();
const context = BACKGROUND_CONTEXT;
const root = await mkdtemp(join(tmpdir(), "pi-ollama-smoke-"));
const workspace = join(root, "workspace");
await mkdir(workspace);
const config = parseConfiguration(JSON.parse(await readFile("config.ollama.example.json", "utf8")));
// Configuration policy: this opt-in check must never become a hosted-provider call if the example is edited.
if (config.agents.some((agent) => agent.kind !== "native" || agent.model.provider !== "ollama"))
	throw new Error("The local smoke check only accepts native Ollama lanes");
const { models, tokens } = prepareHost(
	config,
	{
		COLLAB_TOKEN_ALICE: "local-smoke-alice-not-for-deployment",
		COLLAB_TOKEN_BOB: "local-smoke-bob-not-for-deployment",
		COLLAB_OLLAMA_URL: process.env.COLLAB_OLLAMA_URL,
	},
	process.cwd(),
);
const collaboration = createCollaboration();
const registry = createRegistry();
registry.install(collaboration.extension);
registry.install(defineExtension({ name: "smoke-files", tools: [createReadTool(), createWriteTool()] }));
const threadConfig: CollaborativeThreadConfig = {
	id: "local-smoke",
	workspace,
	members: config.members.map(({ id }) => id),
	agents: config.agents.map((agent) => ({
		...agent,
		instructions:
			"Use the requested file tool, then give one short confirmation. Do not merely describe the tool call. Never repeat a successful write.",
	})),
};
const options = {
	models,
	registry,
	settings: { afterFailedRun: "withdraw" as const },
	env: ({ cwd }: { cwd?: string }) => new NodeExecutionEnv({ cwd: cwd ?? workspace }),
};
const store = join(root, "thread.sqlite");
const commands = config.members.flatMap(({ id: actor }) =>
	config.agents.map(({ id: agent }) => ({
		actor,
		agent,
		id: `${actor}-${agent}`,
		file: `${actor}-${agent}.txt`,
		text: `Use the write tool once to create ${actor}-${agent}.txt containing exactly PROOF-${actor}-${agent}. Then confirm briefly.`,
	})),
);
try {
	const harness = await Harness.open(await openNodeSqliteStorage(store), options, context);
	try {
		const thread = await collaboration.open(harness, threadConfig, context);
		const demo = await createDemoServer(
			{ threads: new Map([[threadConfig.id, { thread, config: threadConfig }]]), tokens, assets: new Map() },
			context,
		);
		const timeout = setTimeout(() => {
			void Promise.all(config.agents.map(({ id }) => thread.stop("alice", id, context))).catch(() => {});
		}, 120_000);
		try {
			await new Promise<void>((resolveListen, reject) => {
				demo.server.once("error", reject);
				demo.server.listen(0, "127.0.0.1", resolveListen);
			});
			const address = demo.server.address();
			if (!address || typeof address === "string") throw new Error("Expected TCP address");
			const origin = `http://127.0.0.1:${address.port}/api/threads/${threadConfig.id}/agents`;
			const submit = async (command: (typeof commands)[number]) => {
				const token = [...tokens].find(([, actor]) => actor === command.actor)![0];
				const response = await fetch(`${origin}/${command.agent}/commands`, {
					method: "POST",
					headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
					body: JSON.stringify({ id: command.id, text: command.text }),
					signal: AbortSignal.timeout(10_000),
				});
				assert.equal(response.status, 202);
				return response.json();
			};
			const receipts = await Promise.all(commands.map(submit));
			assert.deepEqual(await submit(commands[0]), receipts[0]);
			harness.resume();
			await harness.waitForIdle(context);
			for (const command of commands) {
				const status = await thread.command(command.actor, command.agent, command.id, context);
				console.log(command.id, status.status);
				assert.equal(status.status, "completed", JSON.stringify(status));
				assert.equal(
					(await readFile(join(workspace, command.file), "utf8")).trim(),
					`PROOF-${command.actor}-${command.agent}`,
				);
			}
			const peer = await thread.watch("bob", "local-a", context);
			try {
				assert.deepEqual(new Set(peer.value.commands.map(({ actorId }) => actorId)), new Set(["alice", "bob"]));
			} finally {
				await peer.stop();
			}
		} finally {
			clearTimeout(timeout);
			await demo.close();
		}
	} finally {
		await harness.close(context);
	}
	const reopened = await Harness.open(await openNodeSqliteStorage(store), options, context);
	try {
		const thread = await collaboration.open(reopened, threadConfig, context);
		for (const command of commands) {
			assert.equal((await thread.command(command.actor, command.agent, command.id, context)).status, "completed");
			assert.deepEqual(
				await thread.submit(command.actor, { id: command.id, agentId: command.agent, text: command.text }, context),
				{ id: command.id, actorId: command.actor, agentId: command.agent },
			);
		}
	} finally {
		await reopened.close(context);
	}
	const report = {
		date: new Date().toISOString(),
		node: process.version,
		models: config.agents.map((agent) => (agent.kind === "native" ? agent.model : agent.driver)),
		agents: 2,
		users: 2,
		completed: commands.length,
		filesVerified: commands.length,
		receiptRetry: "stable before and after reopen",
		sqliteReopen: "passed",
		elapsedMs: Math.round(performance.now() - started),
		limits: [
			"Read/write tools only",
			"No Codex or hosted-provider verification",
			"Ollama serializes inference; agent lanes retain separate histories",
		],
	};
	await writeFile(
		resolve(process.env.COLLAB_SMOKE_REPORT ?? "../../.artifacts/ollama-smoke.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	console.log(JSON.stringify(report, null, 2));
} finally {
	await rm(root, { recursive: true, force: true });
}
