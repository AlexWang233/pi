// Select a native provider for a collaborative turn; no network calls without --run.
// Run from packages/durable:
//   node --conditions=source --experimental-strip-types test/examples/40-native-providers.ts
// Add openai|anthropic|google|deepseek --list-models to inspect the local catalog.
// Add the provider and --run after setting its API key and PI_LIVE_MODEL.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { createCollaboration } from "../../src/collaboration/index.ts";
import { createRegistry, Harness, MemoryStorage } from "../../src/index.ts";

const context = BACKGROUND_CONTEXT;
const models = createModels();
for (const provider of [openaiProvider(), anthropicProvider(), googleProvider(), deepseekProvider()]) {
	models.setProvider(provider);
}

// CLI/environment values are the configuration trust boundary. Select exactly one
// provider so an OpenAI-only setup never needs or calls the other providers.
const providerId = process.argv[2] ?? "openai";
if (!models.getProvider(providerId)) {
	throw new Error("Choose openai, anthropic, google, or deepseek");
}
if (process.argv.includes("--list-models")) {
	console.log(
		models
			.getModels(providerId)
			.map((model) => model.id)
			.join("\n"),
	);
} else if (!process.argv.includes("--run")) {
	console.log(
		"Registered providers:",
		models
			.getProviders()
			.map((provider) => provider.id)
			.join(", "),
	);
	console.log("Skipped live turn: add a provider and --run, with its API key and PI_LIVE_MODEL set.");
} else {
	const modelId = process.env.PI_LIVE_MODEL;
	if (!modelId || !models.getModel(providerId, modelId)) {
		throw new Error("Set PI_LIVE_MODEL to a model ID from this provider's --list-models output");
	}
	if (!(await models.getAuth(providerId))) {
		throw new Error(`Configure credentials for ${providerId} before starting a live turn`);
	}
	const collaboration = createCollaboration();
	const registry = createRegistry();
	registry.install(collaboration.extension);
	const harness = await Harness.open(
		new MemoryStorage(),
		{ models, registry, settings: { afterFailedRun: "withdraw" } },
		context,
	);
	try {
		const thread = await collaboration.open(
			harness,
			{
				id: "provider-smoke",
				workspace: process.cwd(),
				members: ["alice", "bob"],
				agents: [{ id: "pi", kind: "native", model: { provider: providerId, modelId } }],
			},
			context,
		);
		await thread.submit("alice", { id: "hello", agentId: "pi", text: "Reply with one short greeting." }, context);
		await harness.waitForIdle(context);
		const result = await thread.command("alice", "pi", "hello", context);
		console.log(result);
		const view = await thread.watch("bob", "pi", context);
		console.log("Bob sees:", view.value.messages);
		await view.stop();
		if (result.status !== "completed") throw new Error(`Live turn ended as ${result.status}`);
	} finally {
		await harness.close(context);
	}
}
