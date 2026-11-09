// Shared live-host startup decisions; preflight reads configuration without opening storage or calling providers.
import { resolve } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { DemoConfiguration } from "./configuration.ts";
import { ollamaProvider } from "./ollama.ts";

const providerKeys: Readonly<Record<string, string>> = {
	openai: "OPENAI_API_KEY",
	anthropic: "ANTHROPIC_API_KEY",
	google: "GEMINI_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
};

/** Validate startup policy and resolve catalogs, identities and paths without starting agents or sockets. */
export function prepareHost(config: DemoConfiguration, environment: NodeJS.ProcessEnv, workingDirectory: string) {
	const port = Number(environment.COLLAB_PORT ?? 4310);
	// Environment boundary: TypeScript cannot guarantee a usable port or unique nonempty secret values.
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("COLLAB_PORT must be 1..65535");
	const tokens = new Map<string, string>();
	for (const member of config.members) {
		const token = environment[member.tokenEnv];
		if (!token || token.length < 24 || tokens.has(token))
			throw new Error(`Set a unique 24+ character ${member.tokenEnv}`);
		tokens.set(token, member.id);
	}
	const models = createModels();
	for (const provider of [openaiProvider(), anthropicProvider(), googleProvider(), deepseekProvider()])
		models.setProvider(provider);
	const localModelIds = [
		...new Set(
			config.agents.flatMap((agent) =>
				agent.kind === "native" && agent.model.provider === "ollama" ? [agent.model.modelId] : [],
			),
		),
	];
	if (localModelIds.length)
		models.setProvider(ollamaProvider(localModelIds, environment.COLLAB_OLLAMA_URL ?? "http://127.0.0.1:11434/v1"));
	const requiredKeys = new Set<string>();
	for (const agent of config.agents) {
		if (agent.kind !== "native") continue;
		if (!models.getModel(agent.model.provider, agent.model.modelId)) throw new Error(`Unknown model for ${agent.id}`);
		if (agent.model.provider !== "ollama") requiredKeys.add(providerKeys[agent.model.provider]);
	}
	const data = resolve(workingDirectory, environment.COLLAB_DATA ?? "data");
	return { port, tokens, models, data, workspace: resolve(data, "workspace"), requiredKeys: [...requiredKeys] };
}
