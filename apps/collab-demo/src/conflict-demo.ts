// Isolated, resettable proposal rounds: models generate text; ManagedFile alone publishes it.
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { createRegistry, defineDoc, Harness } from "@earendil-works/pi-durable";
import {
	CollaborationError,
	type CollaborativeAgent,
	type CollaborativeThread,
	createCollaboration,
	ManagedFile,
	type ManagedFileRead,
} from "@earendil-works/pi-durable/collaboration";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { type ConflictAction, type ConflictView, DEFAULT_CONFLICT_PROMPTS } from "../web/conflict-state.ts";
import { inspectWorkspace } from "./workspace-files.ts";

/** Use configured native models, or fixed preview outputs without credentials. */
export type ConflictGeneration =
	| { kind: "scripted" }
	| { kind: "live"; models: Models; agents: Extract<CollaborativeAgent, { kind: "native" }>[] };

type Preparation = { read: ManagedFileRead; prompt: string; agentId: string };
type Round = { id: string; harness: Harness; file: ManagedFile; thread: CollaborativeThread; workspace: string };

const RoundPointer = defineDoc<{ id: string; count: number }>({
	kind: "demo.conflict-round",
	version: 1,
	scope: "session",
	initial: () => ({ id: "", count: 0 }),
	checkpointWhen: () => false,
});
const Preparations = defineDoc<{ items: Preparation[] }>({
	kind: "demo.conflict-round-preparations",
	version: 1,
	scope: "session",
	initial: () => ({ items: [] }),
	checkpointWhen: () => false,
});
const BASE = "Greeting: Welcome\nTheme: neutral\n";
const SAMPLE_OUTPUTS = ["Greeting: Hello\nTheme: light\n", "Greeting: Hi from the team\nTheme: dark\n"];

/** Own bounded saved rounds independently of live agent histories, files and tools. */
export class ConflictDemo {
	readonly #controller: Harness;
	readonly #directory: string;
	readonly #members: readonly string[];
	readonly #generation: ConflictGeneration;
	readonly #agents: Extract<CollaborativeAgent, { kind: "native" }>[];
	#round: Round;
	#line: Promise<void> = Promise.resolve();

	private constructor(
		controller: Harness,
		directory: string,
		members: readonly string[],
		generation: ConflictGeneration,
		agents: Extract<CollaborativeAgent, { kind: "native" }>[],
		round: Round,
	) {
		this.#controller = controller;
		this.#directory = directory;
		this.#members = members;
		this.#generation = generation;
		this.#agents = agents;
		this.#round = round;
	}

	/** Reopen the active round; live generation uses configured native models without file tools. */
	static async open(
		directory: string,
		members: readonly string[],
		generation: ConflictGeneration,
		context: Context,
	): Promise<ConflictDemo> {
		if (members.length < 2 || (generation.kind === "live" && generation.agents.length === 0))
			throw new CollaborationError("invalid_config", "The walkthrough needs two members and a native model");
		await mkdir(directory, { recursive: true });
		const controller = await Harness.open(
			await openNodeSqliteStorage(join(directory, "rounds.sqlite")),
			{ registry: createRegistry(), models: createModels() },
			context,
		);
		try {
			const id = await controller.commit(async (tx) => {
				const pointer = await tx.doc(RoundPointer);
				if (!pointer.id) {
					pointer.id = randomUUID();
					pointer.count = 1;
				}
				return pointer.id;
			}, context);
			const agents =
				generation.kind === "live"
					? generation.agents
					: ["proposal-a", "proposal-b"].map((agentId) => ({
							id: agentId,
							kind: "native" as const,
							model: { provider: "scripted-not-invoked", modelId: "none" },
						}));
			const round = await openRound(directory, id, members, generation, agents, context);
			return new ConflictDemo(controller, directory, members, generation, agents, round);
		} catch (error) {
			await controller.close(context);
			throw error;
		}
	}

	/** Return current bytes, retained bases, generated text and publication evidence to a member. */
	view(actor: string, context: Context): Promise<ConflictView> {
		return this.#serialize(() => this.#view(actor, context));
	}

	/** Reject stale-round actions; preparation admits generation, publication checks the retained base. */
	perform(actor: string, action: ConflictAction, context: Context): Promise<ConflictView> {
		return this.#serialize(async () => {
			this.#authorize(actor);
			const index = this.#members.slice(0, 2).indexOf(actor);
			if (index === -1) throw new CollaborationError("forbidden", "Other members can observe this walkthrough");
			if (action.round !== this.#round.id)
				throw new CollaborationError("conflict", "This round was reset. Refresh shared evidence before acting.");
			if (action.kind === "reset") {
				await this.#reset(actor, context);
			} else if (action.kind === "prepare") {
				await this.#prepare(actor, action, context);
			} else {
				const view = await this.#view(actor, context);
				if (!view.participants.every((item) => item.prepared))
					throw new CollaborationError("conflict", "Both members must prepare before publication");
				const participant = view.participants[index];
				const preparation = (await this.#round.harness.snapshot(Preparations, context))!.items.find(
					(item) => item.read.actorId === actor,
				)!;
				const agentId = preparation.read.agentId;
				if (action.kind === "publish") {
					if (participant.generation !== "completed" || participant.output === null)
						throw new CollaborationError("conflict", "Wait for a successful generated proposal before publishing");
					await this.#round.file.propose(
						actor,
						{ id: "edit", agentId, baseId: "base", content: participant.output },
						context,
					);
				} else {
					if (
						!view.proposals.some((item) => item.actorId === actor && item.id === "edit" && item.status === "conflict")
					)
						throw new CollaborationError("conflict", "Only the member with the stale proposal can resolve it");
					const read = await this.#round.file.read(actor, agentId, "resolution-base", context);
					await this.#round.file.propose(
						actor,
						{ id: "resolution", agentId, baseId: read.id, content: action.content },
						context,
					);
				}
			}
			return this.#view(actor, context);
		});
	}

	/** Drain actions and stop isolated generation before closing its controller. */
	async close(context: Context): Promise<void> {
		await this.#line;
		try {
			await this.#round.harness.close(context);
		} finally {
			await this.#controller.close(context);
		}
	}

	async #prepare(actor: string, action: Extract<ConflictAction, { kind: "prepare" }>, context: Context): Promise<void> {
		// Input policy: typed text still needs nonempty, encoding and size bounds.
		if (
			!action.prompt.trim() ||
			action.prompt.length > 4096 ||
			action.prompt.includes("\0") ||
			!action.prompt.isWellFormed()
		)
			throw new CollaborationError("invalid_command", "Use a nonempty prompt of at most 4096 characters");
		if (!this.#agents.some((agent) => agent.id === action.agentId))
			throw new CollaborationError("invalid_command", "Select a configured native model");
		const state = (await this.#round.harness.snapshot(Preparations, context))!;
		const existing = state.items.find((item) => item.read.actorId === actor);
		if (existing && (existing.prompt !== action.prompt || existing.agentId !== action.agentId))
			throw new CollaborationError("conflict", "Preparation already has another prompt/model. Reset for new edits.");
		const runtimeId = `generation-${this.#members.indexOf(actor)}-${this.#agents.findIndex((agent) => agent.id === action.agentId)}`;
		const read = await this.#round.file.read(actor, runtimeId, "base", context);
		if (this.#generation.kind === "live") {
			await this.#round.thread.submit(
				actor,
				{
					id: "generate",
					agentId: runtimeId,
					text: `Generate a full replacement for shared.txt from this retained base and user instruction. Return only file text. Do not write files.\n${JSON.stringify({ base: read.content, instruction: action.prompt })}`,
				},
				context,
			);
		}
		await this.#round.harness.commit(async (tx) => {
			const preparations = await tx.doc(Preparations);
			if (!existing) preparations.items.push({ read, prompt: action.prompt, agentId: action.agentId });
		}, context);
	}

	async #reset(actor: string, context: Context): Promise<void> {
		const proposals = await this.#round.file.proposals(actor, context);
		if (proposals.some((item) => item.status === "prepared" || item.status === "uncertain"))
			throw new CollaborationError("conflict", "Inspect the uncertain publication before resetting");
		const pointer = (await this.#controller.snapshot(RoundPointer, context))!;
		if (pointer.count >= 64)
			throw new CollaborationError("capacity", "64 saved rounds reached; use another isolated demo data directory");
		const next = await openRound(this.#directory, randomUUID(), this.#members, this.#generation, this.#agents, context);
		try {
			await this.#controller.commit(async (tx) => {
				const saved = await tx.doc(RoundPointer);
				saved.id = next.id;
				saved.count++;
			}, context);
		} catch (error) {
			await next.harness.close(context);
			throw error;
		}
		const previous = this.#round;
		this.#round = next;
		// Old generation has no file tools and a separate store; it cannot publish into the new round.
		await previous.harness.close(context);
	}

	async #view(actor: string, context: Context): Promise<ConflictView> {
		this.#authorize(actor);
		const state = (await this.#round.harness.snapshot(Preparations, context))!;
		const inspected = await inspectWorkspace(this.#round.workspace, "shared.txt");
		if (inspected.kind !== "file") throw new CollaborationError("conflict", "Walkthrough file is unavailable");
		const participants = await Promise.all(
			this.#members.slice(0, 2).map(async (actorId, index) => {
				const saved = state.items.find((item) => item.read.actorId === actorId);
				const agentId = saved?.agentId ?? this.#agents[index % this.#agents.length].id;
				const command =
					saved && this.#generation.kind === "live"
						? await this.#round.thread.command(actorId, saved.read.agentId, "generate", context)
						: null;
				return {
					actorId,
					agentId,
					base: saved?.read.content ?? null,
					prepared: saved !== undefined,
					prompt: saved?.prompt ?? DEFAULT_CONFLICT_PROMPTS[index],
					generation: command?.status ?? (saved ? ("completed" as const) : ("unprepared" as const)),
					output:
						command?.status === "completed"
							? command.answer
							: saved && this.#generation.kind === "scripted"
								? SAMPLE_OUTPUTS[index]
								: null,
					reason:
						command && (command.status === "failed" || command.status === "interrupted" || command.status === "stopped")
							? command.reason
							: "",
				};
			}),
		);
		return {
			round: this.#round.id,
			mode: this.#generation.kind,
			agents: this.#agents.map((agent) => ({
				id: agent.id,
				label: `${agent.id} · ${agent.model.provider}/${agent.model.modelId}`,
			})),
			file: "shared.txt",
			current: inspected.content,
			participants,
			proposals: (await this.#round.file.proposals(actor, context)).filter((item) => item.id !== "seed"),
		};
	}

	#authorize(actor: string): void {
		if (!this.#members.includes(actor)) throw new CollaborationError("forbidden", "Not a walkthrough member");
	}

	#serialize<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#line.then(operation);
		this.#line = result.then(
			() => {},
			() => {},
		);
		return result;
	}
}

async function openRound(
	directory: string,
	id: string,
	members: readonly string[],
	generation: ConflictGeneration,
	agents: Extract<CollaborativeAgent, { kind: "native" }>[],
	context: Context,
): Promise<Round> {
	const workspace = join(directory, "rounds", id, "workspace");
	await mkdir(workspace, { recursive: true });
	const collaboration = createCollaboration();
	const registry = createRegistry();
	registry.install(collaboration.extension);
	// Each participant gets a separate conversation even when both select the same configured model.
	const proposalAgents = members.slice(0, 2).flatMap((_member, memberIndex) =>
		agents.map((agent, agentIndex) => ({
			id: `generation-${memberIndex}-${agentIndex}`,
			kind: "native" as const,
			model: agent.model,
			instructions:
				"Generate a proposed replacement for one text file. Return only replacement text, without Markdown fences or explanations. No filesystem or shell tools are available. Do not claim the file was written.",
		})),
	);
	const harness = await Harness.open(
		await openNodeSqliteStorage(join(directory, "rounds", id, "walkthrough.sqlite")),
		{
			registry,
			models: generation.kind === "live" ? generation.models : createModels(),
			settings: { afterFailedRun: "withdraw" },
		},
		context,
	);
	try {
		const thread = await collaboration.open(
			harness,
			{
				id: "conflict-walkthrough",
				workspace,
				members: [...members],
				agents: proposalAgents,
				maxCommands: 4,
				maxPendingPerAgent: 2,
				maxInputChars: 32768,
				maxOutputChars: 16384,
			},
			context,
		);
		const file = await ManagedFile.open(harness, new NodeExecutionEnv({ cwd: workspace }), "shared.txt", context);
		const seed = await file.read(members[0], proposalAgents[0].id, "seed-read", context);
		if (seed.content !== null)
			throw new CollaborationError("conflict", "Walkthrough file existed before initialization");
		const initialized = await file.propose(
			members[0],
			{ id: "seed", agentId: proposalAgents[0].id, baseId: seed.id, content: BASE },
			context,
		);
		if (initialized.status !== "applied")
			throw new CollaborationError("conflict", "Inspect uncertain walkthrough initialization");
		await harness.commit(async (tx) => {
			await tx.doc(Preparations);
		}, context);
		harness.resume();
		return { id, harness, thread, file, workspace };
	} catch (error) {
		await harness.close(context);
		throw error;
	}
}
