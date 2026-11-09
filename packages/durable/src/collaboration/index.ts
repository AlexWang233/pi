// Collaborative threads are an additive API on the existing Durable package.
export { createCollaboration } from "./external.ts";
export { ManagedFile, type ManagedFileEdit, type ManagedFileProposal, type ManagedFileRead } from "./managed-file.ts";
export { CollaborativeThread } from "./thread.ts";
export {
	type AgentSnapshot,
	type AgentWatch,
	CollaborationError,
	type CollaborativeAgent,
	type CollaborativeCommand,
	type CollaborativeThreadConfig,
	type CommandReceipt,
	type CommandStatus,
	type ExternalAgentDriver,
	type ExternalSession,
	type ExternalTurn,
	type ExternalTurnResult,
} from "./types.ts";
