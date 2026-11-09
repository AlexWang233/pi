// Shared startup policy rejects invalid environment without exposing credentials or opening a store.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseConfiguration } from "../src/configuration.ts";
import { prepareHost } from "../src/startup.ts";

const config = {
	members: [
		{ id: "alice", tokenEnv: "COLLAB_TOKEN_ALICE" },
		{ id: "bob", tokenEnv: "COLLAB_TOKEN_BOB" },
	],
	agents: [{ id: "codex", kind: "external" as const, driver: "codex" }],
};
const environment = { COLLAB_TOKEN_ALICE: "a".repeat(24), COLLAB_TOKEN_BOB: "b".repeat(24) };

describe("live host startup policy", () => {
	it("loads the mixed-provider default with only an OpenAI key requirement and keeps Codex optional", async () => {
		const mixed = parseConfiguration(
			JSON.parse(await readFile(new URL("../config.example.json", import.meta.url), "utf8")),
		);
		const host = prepareHost(mixed, environment, process.cwd());
		expect(mixed.agents.map((agent) => agent.kind)).toEqual(["native", "native"]);
		expect(host.requiredKeys).toEqual(["OPENAI_API_KEY"]);
		expect(host.models.getModels("ollama")).toHaveLength(1);
		expect(await host.models.getAuth("ollama")).toMatchObject({ auth: { apiKey: "ollama-local" } });
		const external = parseConfiguration(
			JSON.parse(await readFile(new URL("../config.codex.example.json", import.meta.url), "utf8")),
		);
		expect(external.agents.map((agent) => agent.kind)).toEqual(["native", "external"]);
		expect(prepareHost(external, environment, process.cwd()).requiredKeys).toEqual(["OPENAI_API_KEY"]);
	});
	it("registers selected local models once without hosted keys", async () => {
		const host = prepareHost(
			{
				...config,
				agents: ["one", "two"].map((id) => ({
					id,
					kind: "native" as const,
					model: { provider: "ollama", modelId: "local-model" },
				})),
			},
			environment,
			process.cwd(),
		);
		expect(host.requiredKeys).toEqual([]);
		expect(host.models.getModels("ollama")).toHaveLength(1);
		expect(await host.models.getAuth("ollama")).toMatchObject({ auth: { apiKey: "ollama-local" } });
	});
	it("resolves the existing layout and supports an external lane without native API keys", () => {
		const host = prepareHost(config, environment, process.cwd());
		expect(host.requiredKeys).toEqual([]);
		expect(host.tokens.get(environment.COLLAB_TOKEN_ALICE)).toBe("alice");
		expect(host.workspace).toBe(`${host.data}${process.platform === "win32" ? "\\" : "/"}workspace`);
		expect(host.port).toBe(4310);
	});
	it("rejects invalid ports, missing/short and duplicate tokens without returning their values", () => {
		for (const extra of [
			{ COLLAB_PORT: "0" },
			{ COLLAB_PORT: "NaN" },
			{ COLLAB_TOKEN_ALICE: "short" },
			{ COLLAB_TOKEN_BOB: environment.COLLAB_TOKEN_ALICE },
		]) {
			expect(() => prepareHost(config, { ...environment, ...extra }, process.cwd())).toThrow();
		}
		expect(() => prepareHost(config, {}, process.cwd())).toThrow("COLLAB_TOKEN_ALICE");
	});
	it("requires only selected provider keys and validates models against the actual local catalog", () => {
		const catalogs = prepareHost(config, environment, process.cwd()).models;
		const agents = ["openai", "anthropic", "google", "deepseek"].map((provider) => ({
			id: provider,
			kind: "native" as const,
			model: { provider, modelId: catalogs.getModels(provider)[0]!.id },
		}));
		expect(prepareHost({ ...config, agents: agents.slice(0, 1) }, environment, process.cwd()).requiredKeys).toEqual([
			"OPENAI_API_KEY",
		]);
		expect(prepareHost({ ...config, agents }, environment, process.cwd()).requiredKeys).toHaveLength(4);
		expect(() =>
			prepareHost(
				{ ...config, agents: [{ ...agents[0], model: { provider: "openai", modelId: "not-a-model" } }] },
				environment,
				process.cwd(),
			),
		).toThrow("Unknown model");
	});
});
