// Wire contracts for the isolated, scripted managed-file walkthrough.

export type ConflictAction = { kind: "prepare" } | { kind: "publish" } | { kind: "resolve"; content: string };

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
	file: string;
	current: string;
	participants: { actorId: string; agentId: string; base: string | null; prepared: boolean }[];
	proposals: ConflictProposal[];
};
