// Package-owned metadata and command receipts stored on the existing Session line.
import { defineDoc } from "../documents.ts";
import type { ConversationId, SubmissionId, TaskId, TaskState } from "../types.ts";
import { CollaborationError, type CollaborativeThreadConfig } from "./types.ts";

export type ThreadConfiguration = {
	id: string;
	workspace: string;
	members: string[];
	agents: ({ id: string; instructions: string } & (
		| { kind: "native"; model: { provider: string; modelId: string } }
		| { kind: "external"; driver: string; model: string | null }
	))[];
	maxCommands: number;
	maxPendingPerAgent: number;
	maxInputChars: number;
	maxOutputChars: number;
	externalTimeoutMs: number;
};

export type AgentRecord = {
	id: string;
	conversationId: ConversationId;
	tail: TaskId | null;
	continuation: string | null;
};

export type StoredCommand = { id: string; actorId: string; agentId: string; text: string } & (
	| { kind: "native"; submissionId: SubmissionId }
	| {
			kind: "external";
			taskId: TaskId;
			state:
				| { status: "queued" | "running"; progress: string }
				| { status: "completed"; answer: string }
				| { status: "failed" | "interrupted" | "stopped"; reason: string };
	  }
);

export type ThreadState = {
	thread: { configuration: ThreadConfiguration; agents: AgentRecord[] } | null;
	commands: StoredCommand[];
};

export const ThreadDoc = defineDoc<ThreadState>({
	kind: "pi.collaboration",
	version: 1,
	scope: "session",
	initial: () => ({ thread: null, commands: [] }),
	checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 32,
});

/** Validate declaration policy and materialize a stable serializable configuration. */
export function threadConfiguration(config: CollaborativeThreadConfig): ThreadConfiguration {
	// Declaration policy: types cannot express nonempty, unique names or positive resource bounds.
	if (!config.id || !config.workspace || !config.members.length || !config.agents.length) {
		throw new CollaborationError("invalid_config", "Thread, workspace, members, and agents must be nonempty");
	}
	for (const ids of [config.members, config.agents.map((agent) => agent.id)]) {
		if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
			throw new CollaborationError("invalid_config", "Member and agent IDs must be nonempty and unique");
		}
	}
	const result: ThreadConfiguration = {
		id: config.id,
		workspace: config.workspace,
		members: [...config.members],
		agents: config.agents.map((agent) =>
			agent.kind === "native"
				? { id: agent.id, instructions: agent.instructions ?? "", kind: "native", model: agent.model }
				: {
						id: agent.id,
						instructions: agent.instructions ?? "",
						kind: "external",
						driver: agent.driver,
						model: agent.model ?? null,
					},
		),
		maxCommands: config.maxCommands ?? 256,
		maxPendingPerAgent: config.maxPendingPerAgent ?? 16,
		maxInputChars: config.maxInputChars ?? 16_384,
		maxOutputChars: config.maxOutputChars ?? 65_536,
		externalTimeoutMs: config.externalTimeoutMs ?? 120_000,
	};
	for (const limit of [
		result.maxCommands,
		result.maxPendingPerAgent,
		result.maxInputChars,
		result.maxOutputChars,
		result.externalTimeoutMs,
	]) {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_147_483_647) {
			throw new CollaborationError("invalid_config", "Limits must be positive 32-bit integers");
		}
	}
	return result;
}

/** Refuse access unless the host-authenticated caller is a stored thread member. */
export function authorize(state: Readonly<ThreadState>, actorId: string): void {
	if (!state.thread?.configuration.members.includes(actorId)) {
		throw new CollaborationError("forbidden", "Caller is not a member of this thread");
	}
}

/** Derive an uncertain command outcome when its task ended without settling collaboration metadata. */
export function externalCommandState(
	command: Extract<StoredCommand, { kind: "external" }>,
	task: TaskState<unknown, unknown>,
): Extract<StoredCommand, { kind: "external" }>["state"] {
	if ((command.state.status === "queued" || command.state.status === "running") && task.status === "terminal") {
		return {
			status: "interrupted",
			reason: `External task ended (${task.outcome.status}) without a command outcome; inspect workspace before retrying`,
		};
	}
	return command.state;
}
