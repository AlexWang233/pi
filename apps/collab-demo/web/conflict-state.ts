// Wire contracts for round-scoped proposal generation and managed publication.

export type ConflictAction = { round: string } & (
	| { kind: "prepare"; agentId: string; prompt: string }
	| { kind: "publish" }
	| { kind: "reset" }
	| { kind: "resolve"; content: string }
);

/** Default instructions both change the neutral initial file. */
export const DEFAULT_CONFLICT_PROMPTS = [
	"Replace the entire file with exactly:\nGreeting: Hello\nTheme: light\n",
	"Replace the entire file with exactly:\nGreeting: Hi from the team\nTheme: dark\n",
] as const;

export type ConflictProposal = {
	id: string;
	actorId: string;
	agentId: string;
	baseId: string;
	base: string | null;
	content: string;
} & (
	| { status: "prepared" | "applied" }
	| { status: "conflict"; current: string | null }
	| { status: "uncertain"; reason: string }
);

export type ConflictView = {
	round: string;
	mode: "live" | "scripted";
	agents: { id: string; label: string }[];
	file: string;
	current: string;
	participants: {
		actorId: string;
		agentId: string;
		base: string | null;
		prepared: boolean;
		prompt: string;
		generation: "unprepared" | "queued" | "running" | "completed" | "failed" | "interrupted" | "stopped";
		output: string | null;
		reason: string;
	}[];
	proposals: ConflictProposal[];
};
