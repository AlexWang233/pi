// Local chat models use Pi's existing compatible API; the collaboration runtime stays provider-independent.
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createProvider } from "@earendil-works/pi-ai/models";

/** Register explicitly selected local models against a loopback-only Ollama endpoint without real credentials. */
export function ollamaProvider(modelIds: readonly string[], endpoint: string) {
	// Environment boundary: never redirect the local-only composition to a remote provider.
	const url = new URL(endpoint);
	if (
		url.protocol !== "http:" ||
		!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname.replace(/\/$/, "") !== "/v1"
	) {
		throw new Error("COLLAB_OLLAMA_URL must be a loopback http://host:port/v1 endpoint");
	}
	return createProvider({
		id: "ollama",
		name: "Ollama (local)",
		baseUrl: url.href,
		auth: {
			apiKey: {
				name: "Local Ollama (keyless)",
				resolve: async () => ({ auth: { apiKey: "ollama-local" }, source: "local endpoint" }),
			},
		},
		models: modelIds.map((id) => ({
			id,
			name: id,
			provider: "ollama",
			api: "openai-completions" as const,
			baseUrl: url.href,
			input: ["text" as const],
			reasoning: false,
			contextWindow: 8192,
			maxTokens: 1024,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" as const },
		})),
		api: openAICompletionsApi(),
	});
}
