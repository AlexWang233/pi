// Read-only API-key environment preflight: no storage open, provider authentication, model turn or CLI spawn.
import { readFile } from "node:fs/promises";
import { loadAssets } from "./assets.ts";
import { parseConfiguration } from "./configuration.ts";
import { prepareHost } from "./startup.ts";

try {
	let configuration: unknown;
	try {
		configuration = JSON.parse(await readFile(process.env.COLLAB_CONFIG ?? "config.local.json", "utf8"));
	} catch {
		throw new Error("Cannot read valid configuration JSON; check COLLAB_CONFIG");
	}
	const config = parseConfiguration(configuration);
	const host = prepareHost(config, process.env, process.cwd());
	try {
		await loadAssets();
	} catch {
		throw new Error("Browser assets unavailable; run the demo build first");
	}
	const missingKeys = host.requiredKeys.filter((name) => !process.env[name]?.trim());
	console.log(
		JSON.stringify(
			{
				status: missingKeys.length ? "missing-api-key-environment" : "configuration-valid",
				node: process.version,
				memberCount: config.members.length,
				agents: config.agents.map(({ id, kind }) => ({ id, kind })),
				port: host.port,
				data: host.data,
				workspace: host.workspace,
				missingKeys,
				unchecked: [
					"Provider authentication/model access",
					"Local Ollama availability/downloaded models/capabilities",
					"Codex executable/authentication/protocol",
					"Data-directory permissions and stored configuration",
					"Process containment and deployment",
				],
			},
			null,
			2,
		),
	);
	if (missingKeys.length) process.exitCode = 1;
} catch (error) {
	console.error(error instanceof Error ? error.message : "Preflight failed");
	process.exitCode = 1;
}
