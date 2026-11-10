// A bounded, scripted ManagedFile walkthrough, isolated from live agent work and credentials.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, defineDoc, Harness } from "@earendil-works/pi-durable";
import {
	CollaborationError,
	createCollaboration,
	ManagedFile,
	type ManagedFileRead,
} from "@earendil-works/pi-durable/collaboration";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { ConflictAction, ConflictView } from "../web/conflict-state.ts";
import { inspectWorkspace } from "./workspace-files.ts";

const Preparation = defineDoc<{ reads: ManagedFileRead[] }>({
	kind: "demo.conflict-preparation",
	version: 1,
	scope: "session",
	initial: () => ({ reads: [] }),
	checkpointWhen: () => false,
});

const BASE = "Greeting: Hello\nTheme: light\n";

/** Own one persisted, repeat-safe walkthrough; no model, shell or external driver runs here. */
export class ConflictDemo {
	readonly #harness: Harness;
	readonly #file: ManagedFile;
	readonly #members: readonly string[];
	readonly #workspace: string;
	#line: Promise<void> = Promise.resolve();

	private constructor(harness: Harness, file: ManagedFile, members: readonly string[], workspace: string) {
		this.#harness = harness;
		this.#file = file;
		this.#members = members;
		this.#workspace = workspace;
	}

	/** Open a dedicated SQLite store and workspace under the supplied demo directory. */
	static async open(directory: string, members: readonly string[], context: Context): Promise<ConflictDemo> {
		if (members.length < 2) throw new CollaborationError("invalid_config", "The walkthrough needs two members");
		const workspace = join(directory, "workspace");
		await mkdir(workspace, { recursive: true });
		const collaboration = createCollaboration();
		const registry = createRegistry();
		registry.install(collaboration.extension);
		const harness = await Harness.open(
			await openNodeSqliteStorage(join(directory, "walkthrough.sqlite")),
			{ registry, models: createModels() },
			context,
		);
		try {
			await collaboration.open(
				harness,
				{
					id: "conflict-walkthrough",
					workspace,
					members: [...members],
					agents: ["proposal-a", "proposal-b"].map((id) => ({
						id,
						kind: "native",
						model: { provider: "scripted-not-invoked", modelId: "none" },
					})),
				},
				context,
			);
			const file = await ManagedFile.open(harness, new NodeExecutionEnv({ cwd: workspace }), "shared.txt", context);
			const seed = await file.read(members[0], "proposal-a", "seed-read", context);
			if (seed.content !== null)
				throw new CollaborationError("conflict", "Walkthrough file existed before initialization");
			const initialized = await file.propose(
				members[0],
				{
					id: "seed",
					agentId: "proposal-a",
					baseId: seed.id,
					content: BASE,
				},
				context,
			);
			if (initialized.status !== "applied")
				throw new CollaborationError("conflict", "Inspect uncertain walkthrough initialization");
			await harness.commit(async (tx) => {
				await tx.doc(Preparation);
			}, context);
			return new ConflictDemo(harness, file, members, workspace);
		} catch (error) {
			await harness.close(context);
			throw error;
		}
	}

	/** Return current bytes, retained bases and publication evidence to a thread member. */
	view(actor: string, context: Context): Promise<ConflictView> {
		return this.#serialize(() => this.#view(actor, context));
	}

	/** Perform only the signed-in member's scripted step; retries retain the same proposal identity. */
	perform(actor: string, action: ConflictAction, context: Context): Promise<ConflictView> {
		return this.#serialize(async () => {
			this.#authorize(actor);
			const index = this.#members.slice(0, 2).indexOf(actor);
			if (index === -1) throw new CollaborationError("forbidden", "Other members can observe this walkthrough");
			const agentId = index === 0 ? "proposal-a" : "proposal-b";
			if (action.kind === "prepare") {
				const read = await this.#file.read(actor, agentId, "base", context);
				await this.#harness.commit(async (tx) => {
					const state = await tx.doc(Preparation);
					if (!state.reads.some((item) => item.actorId === actor)) state.reads.push(read);
				}, context);
			} else {
				const state = (await this.#harness.snapshot(Preparation, context))!;
				if (state.reads.length !== 2)
					throw new CollaborationError("conflict", "Both members must prepare before publication");
				const base = state.reads.find((item) => item.actorId === actor)!;
				if (action.kind === "publish") {
					await this.#file.propose(
						actor,
						{
							id: "edit",
							agentId,
							baseId: base.id,
							content: index === 0 ? BASE.replace("Hello", "Hi from the team") : BASE.replace("light", "dark"),
						},
						context,
					);
				} else {
					const proposals = await this.#file.proposals(actor, context);
					if (!proposals.some((item) => item.actorId === actor && item.id === "edit" && item.status === "conflict"))
						throw new CollaborationError("conflict", "Only the member with the stale proposal can resolve it");
					const read = await this.#file.read(actor, agentId, "resolution-base", context);
					await this.#file.propose(
						actor,
						{ id: "resolution", agentId, baseId: read.id, content: action.content },
						context,
					);
				}
			}
			return this.#view(actor, context);
		});
	}

	/** Drain presentation actions before closing the dedicated runtime. */
	async close(context: Context): Promise<void> {
		await this.#line;
		await this.#harness.close(context);
	}

	async #view(actor: string, context: Context): Promise<ConflictView> {
		this.#authorize(actor);
		const reads = (await this.#harness.snapshot(Preparation, context))!.reads;
		const file = await inspectWorkspace(this.#workspace, "shared.txt");
		if (file.kind !== "file") throw new CollaborationError("conflict", "Walkthrough file is unavailable");
		return {
			file: "shared.txt",
			current: file.content,
			participants: this.#members.slice(0, 2).map((actorId, index) => ({
				actorId,
				agentId: index === 0 ? "proposal-a" : "proposal-b",
				base: reads.find((item) => item.actorId === actorId)?.content ?? null,
				prepared: reads.some((item) => item.actorId === actorId),
			})),
			proposals: (await this.#file.proposals(actor, context)).filter((item) => item.id !== "seed"),
		};
	}

	#authorize(actor: string): void {
		if (!this.#members.includes(actor)) throw new CollaborationError("forbidden", "Not a walkthrough member");
	}

	#serialize<T>(operation: () => Promise<T>): Promise<T> {
		// Group each multi-call presentation step; filesystem effects and metadata are still not one transaction.
		const result = this.#line.then(operation);
		this.#line = result.then(
			() => {},
			() => {},
		);
		return result;
	}
}
