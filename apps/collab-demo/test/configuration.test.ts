// Private host configuration is validated separately from public command payloads.
import { describe, expect, it } from "vitest";
import { parseConfiguration } from "../src/configuration.ts";

describe("demo host configuration", () => {
	it("accepts all four native providers without requiring keys for unused providers", () => {
		const config = parseConfiguration({
			members: [{ id: "alice", tokenEnv: "COLLAB_TOKEN_ALICE" }],
			agents: ["openai", "anthropic", "google", "deepseek"].map((provider) => ({
				id: provider,
				kind: "native",
				model: { provider, modelId: "configured-id" },
			})),
		});
		expect(config.agents).toHaveLength(4);
	});
	it("rejects unsupported drivers, duplicate IDs, empty lanes and malformed models", () => {
		const member = { id: "alice", tokenEnv: "COLLAB_TOKEN_ALICE" };
		for (const agents of [
			[],
			[{ id: "bad", kind: "external", driver: "unknown" }],
			[{ id: "bad", kind: "native", model: "wrong" }],
			[
				{ id: "same", kind: "external", driver: "codex" },
				{ id: "same", kind: "external", driver: "codex" },
			],
		]) {
			expect(() => parseConfiguration({ members: [member], agents })).toThrow();
		}
	});
});
