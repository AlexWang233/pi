// Public contracts for collaborative threads and externally managed agent turns.
import type { ModelRef } from "../harness/types.ts";

/** A named agent using native generation or a registered external driver. */
export type CollaborativeAgent = { id: string; instructions?: string } & (
	| { kind: "native"; model: ModelRef }
	| { kind: "external"; driver: string; model?: string }
);

/** Fixed membership, workspace, and execution bounds of one thread/store. */
export type CollaborativeThreadConfig = {
	id: string;
	workspace: string;
	members: string[];
	agents: CollaborativeAgent[];
	maxCommands?: number;
	maxPendingPerAgent?: number;
	maxInputChars?: number;
	maxOutputChars?: number;
	externalTimeoutMs?: number;
};

/** A caller-scoped idempotent command targeting exactly one named agent. */
export type CollaborativeCommand = { id: string; agentId: string; text: string };

/** An admitted command's stable application identity. */
export type CommandReceipt = { id: string; actorId: string; agentId: string };

/** Current command state; uncertain external work requires explicit retry. */
export type CommandStatus = CommandReceipt &
	(
		| { status: "queued" | "running" }
		| { status: "completed"; answer: string }
		| { status: "failed" | "interrupted" | "stopped"; reason: string }
	);

/** A bounded presentation snapshot shared by all authorized thread viewers. */
export type AgentSnapshot = {
	agentId: string;
	kind: "native" | "external";
	busy: boolean;
	progress: string;
	commands: CommandStatus[];
	messages: { id: string; role: "user" | "assistant"; author: string; text: string }[];
};

/** A serialized state subscription; observation disposal never cancels execution. */
export interface AgentWatch {
	readonly value: AgentSnapshot;
	start(listener: (snapshot: AgentSnapshot) => Promise<void>): void;
	stop(): Promise<void>;
	readonly closed: Promise<void>;
}

/** Serialized continuation reference belongs to the driver, not to clients. */
export type ExternalTurnResult =
	| { status: "completed"; text: string; continuation: string | null }
	| { status: "failed"; reason: string };

/** One external turn, cancelled independently of observation or HTTP requests. */
export type ExternalTurn = {
	text: string;
	signal: AbortSignal;
	progress: (text: string) => Promise<void>;
};

/** An adapter-owned session; the runtime always closes it after the turn. */
export interface ExternalSession {
	run(turn: ExternalTurn): Promise<ExternalTurnResult>;
	close(): Promise<void>;
}

/** A driver implementation installed before opening/recovering a Harness. */
export interface ExternalAgentDriver {
	name: string;
	open(input: {
		workspace: string;
		agentId: string;
		model: string | null;
		instructions: string;
		continuation: string | null;
		signal: AbortSignal;
	}): Promise<ExternalSession>;
}

/** Package-level refusal suitable for mapping to a transport error. */
export class CollaborationError extends Error {
	readonly code: "forbidden" | "not_found" | "conflict" | "capacity" | "invalid_config" | "invalid_command";

	constructor(code: CollaborationError["code"], message: string) {
		super(message);
		this.name = "CollaborationError";
		this.code = code;
	}
}
