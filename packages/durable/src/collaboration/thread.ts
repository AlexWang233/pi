// Collaborative admission and observation over one existing Durable Harness/store.
import type { Context } from "@earendil-works/chord/context";
import { configure } from "../harness/agent.ts";
import type { Conversation, Harness } from "../harness/types.ts";
import type { Cursor, EntryRecord, Page, Task, TaskId } from "../types.ts";
import { authorize, ThreadDoc, threadConfiguration } from "./state.ts";
import {
	type AgentWatch,
	CollaborationError,
	type CollaborativeCommand,
	type CollaborativeThreadConfig,
	type CommandReceipt,
	type CommandStatus,
} from "./types.ts";
import { watchAgent } from "./view.ts";

export type ExternalCommandInput = { command: number; predecessor: TaskId | null };
export type ExternalCommandCheckpoint = { phase: "wait" } | { phase: "execute" };
export type ExternalCommandTask = Task<ExternalCommandInput, ExternalCommandCheckpoint, null, object>;

/** A package-owned collaborative thread; the host retains Harness lifetime ownership. */
export class CollaborativeThread {
	readonly #harness: Harness;
	readonly #external: ExternalCommandTask;
	readonly #conversations: ReadonlyMap<string, Conversation>;

	private constructor(
		harness: Harness,
		external: ExternalCommandTask,
		conversations: ReadonlyMap<string, Conversation>,
	) {
		this.#harness = harness;
		this.#external = external;
		this.#conversations = conversations;
	}

	/** Open or initialize one thread/store, refusing incompatible replacement configuration. */
	static async open(
		harness: Harness,
		config: CollaborativeThreadConfig,
		external: ExternalCommandTask,
		context: Context,
	): Promise<CollaborativeThread> {
		const configuration = threadConfiguration(config);
		await harness.commit(async (tx) => {
			const state = await tx.doc(ThreadDoc);
			if (state.thread !== null) {
				if (JSON.stringify(state.thread.configuration) !== JSON.stringify(configuration)) {
					throw new CollaborationError(
						"conflict",
						"Stored thread configuration differs from requested configuration",
					);
				}
				return;
			}
			const agents = [];
			for (const agent of configuration.agents) {
				const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
				await configure(tx, conversation.id, {
					cwd: configuration.workspace,
					instructions: agent.instructions,
					maxTurns: 16,
					...(agent.kind === "native" ? { model: agent.model } : {}),
				});
				agents.push({ id: agent.id, conversationId: conversation.id, tail: null, continuation: null });
			}
			state.thread = { configuration, agents };
		}, context);
		const state = (await harness.snapshot(ThreadDoc, context))!;
		const conversations = new Map<string, Conversation>();
		for (const agent of state.thread!.agents) {
			conversations.set(agent.id, (await harness.conversation(agent.conversationId, context))!);
		}
		return new CollaborativeThread(harness, external, conversations);
	}

	/** Authorize and atomically admit a targeted command, or return its original receipt. */
	async submit(actorId: string, command: CollaborativeCommand, context: Context): Promise<CommandReceipt> {
		const receipt = await this.#harness.commit(async (tx) => {
			const state = await tx.doc(ThreadDoc);
			authorize(state, actorId);
			const thread = state.thread!;
			const existing = state.commands.find(
				(item) => item.id === command.id && item.agentId === command.agentId && item.actorId === actorId,
			);
			if (existing) {
				if (existing.text !== command.text)
					throw new CollaborationError("conflict", "Command ID has another payload");
				return { id: existing.id, actorId, agentId: existing.agentId };
			}
			const agent = thread.agents.find((item) => item.id === command.agentId);
			if (!agent) throw new CollaborationError("not_found", "Unknown agent");
			const execution = thread.configuration.agents.find((item) => item.id === agent.id)!;
			// Admission policy: TypeScript strings do not guarantee nonempty or bounded input.
			if (!command.id || !command.text.trim() || command.text.length > thread.configuration.maxInputChars) {
				throw new CollaborationError(
					"invalid_command",
					"Command ID/text must be nonempty and input must fit its limit",
				);
			}
			if (state.commands.length >= thread.configuration.maxCommands) {
				throw new CollaborationError("capacity", "Thread command capacity reached");
			}
			let pending = 0;
			for (const item of state.commands) {
				if (item.agentId !== agent.id) continue;
				if (item.kind === "native") {
					const submission = await tx.submission(item.submissionId);
					if (submission?.status === "queued" || submission?.status === "placed") pending++;
				} else if (item.state.status === "queued" || item.state.status === "running") pending++;
			}
			if (pending >= thread.configuration.maxPendingPerAgent) {
				throw new CollaborationError("capacity", "Agent pending-command capacity reached");
			}
			const common = { id: command.id, actorId, agentId: command.agentId, text: command.text };
			if (execution.kind === "native") {
				const submissionId = await this.#conversations.get(agent.id)!.submit(tx, {
					type: "input",
					content: command.text,
					requestId: JSON.stringify([actorId, command.id]),
					entry: { kind: "collab.input", data: common },
				});
				state.commands.push({ ...common, kind: "native", submissionId });
			} else {
				const predecessor =
					agent.tail !== null && (await tx.task(agent.tail))!.state.status !== "terminal" ? agent.tail : null;
				const taskId = await tx.createTask(
					this.#external,
					{ command: state.commands.length, predecessor },
					{ ownership: { kind: "conversation" }, conversationId: agent.conversationId },
				);
				await tx.appendEntry(agent.conversationId, { kind: "collab.input", data: common });
				agent.tail = taskId;
				state.commands.push({ ...common, kind: "external", taskId, state: { status: "queued", progress: "" } });
			}
			return { id: command.id, actorId, agentId: command.agentId };
		}, context);
		this.#harness.resume();
		return receipt;
	}

	/** Read a caller's command without exposing provider or runtime record identities. */
	async command(actorId: string, agentId: string, id: string, context: Context): Promise<CommandStatus> {
		const state = (await this.#harness.snapshot(ThreadDoc, context))!;
		authorize(state, actorId);
		const item = state.commands.find(
			(entry) => entry.id === id && entry.actorId === actorId && entry.agentId === agentId,
		);
		if (!item) throw new CollaborationError("not_found", "Unknown command");
		const identity = { id, actorId, agentId };
		if (item.kind === "external") return { ...identity, ...item.state };
		const submission = (await this.#harness.submission(item.submissionId, context))!;
		const status = await submission.status(context);
		if (status.status === "queued") return { ...identity, status: "queued" };
		if (status.status === "placed") return { ...identity, status: "running" };
		if (status.status === "unanswered")
			return { ...identity, status: status.reason === "aborted" ? "stopped" : "failed", reason: status.reason };
		const answer =
			status.type === "input" ? await this.#harness.commit((tx) => tx.entry(status.answer), context) : undefined;
		const text =
			answer?.model
				?.flatMap((message) =>
					message.role === "assistant"
						? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
						: [],
				)
				.join("") ?? "";
		return { ...identity, status: "completed", answer: text };
	}

	/** Read authorized agent history using the existing windowed storage query. */
	async history(
		actorId: string,
		agentId: string,
		limit: number,
		cursor: Cursor | undefined,
		context: Context,
	): Promise<Page<EntryRecord, Cursor>> {
		const conversation = await this.#agent(actorId, agentId, context);
		return conversation.entries({}, limit, cursor, context);
	}

	/** Stop one agent's ordinary work and queued inputs without stopping peer agents. */
	async stop(actorId: string, agentId: string, context: Context): Promise<void> {
		await (await this.#agent(actorId, agentId, context)).abort(context);
	}

	/** Attach a bounded live projection; closing the watch leaves agent work running. */
	async watch(actorId: string, agentId: string, context: Context): Promise<AgentWatch> {
		const conversation = await this.#agent(actorId, agentId, context);
		return watchAgent(
			this.#harness,
			conversation,
			agentId,
			(command) => this.command(command.actorId, agentId, command.id, context),
			context,
		);
	}

	async #agent(actorId: string, agentId: string, context: Context) {
		const state = (await this.#harness.snapshot(ThreadDoc, context))!;
		authorize(state, actorId);
		const agent = state.thread!.agents.find((item) => item.id === agentId);
		if (!agent) throw new CollaborationError("not_found", "Unknown agent");
		return (await this.#harness.conversation(agent.conversationId, context))!;
	}
}
