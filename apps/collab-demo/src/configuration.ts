// Validate private host configuration before starting storage, agents, or sockets.
import type { CollaborativeAgent } from "@earendil-works/pi-durable/collaboration";

export type DemoConfiguration = {
	members: { id: string; tokenEnv: string }[];
	agents: CollaborativeAgent[];
};

/** Parse configuration JSON without accepting credentials or code from browser requests. */
export function parseConfiguration(value: unknown): DemoConfiguration {
	if (!record(value) || !Array.isArray(value.members) || !Array.isArray(value.agents)) {
		throw new Error("Configuration needs members and agents arrays");
	}
	const members = value.members.map((member: unknown) => {
		if (
			!record(member) ||
			!identifier(member.id) ||
			typeof member.tokenEnv !== "string" ||
			!/^COLLAB_TOKEN_[A-Z0-9_]+$/.test(member.tokenEnv)
		)
			throw new Error("Invalid member id/tokenEnv");
		return { id: member.id, tokenEnv: member.tokenEnv };
	});
	const agents: CollaborativeAgent[] = value.agents.map((agent: unknown): CollaborativeAgent => {
		if (
			!record(agent) ||
			!identifier(agent.id) ||
			(agent.instructions !== undefined && typeof agent.instructions !== "string")
		)
			throw new Error("Invalid agent");
		const common = { id: agent.id, instructions: agent.instructions };
		if (
			agent.kind === "native" &&
			record(agent.model) &&
			["openai", "anthropic", "google", "deepseek"].includes(String(agent.model.provider)) &&
			typeof agent.model.provider === "string" &&
			typeof agent.model.modelId === "string" &&
			agent.model.modelId
		) {
			return { ...common, kind: "native", model: { provider: agent.model.provider, modelId: agent.model.modelId } };
		}
		if (
			agent.kind === "external" &&
			agent.driver === "codex" &&
			(agent.model === undefined || typeof agent.model === "string")
		) {
			return { ...common, kind: "external", driver: "codex", model: agent.model };
		}
		throw new Error("Choose native openai/anthropic/google/deepseek with a model, or external codex");
	});
	for (const [name, items] of [
		["members", members],
		["agents", agents],
	] as const) {
		if (items.length === 0 || items.length > 8 || new Set(items.map((item) => item.id)).size !== items.length) {
			throw new Error(`${name} must contain 1..8 unique IDs`);
		}
	}
	return { members, agents };
}

// These checks apply only to untyped JSON configuration values.
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
	return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}
