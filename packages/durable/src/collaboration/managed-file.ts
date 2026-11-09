// Opt-in, single-file conditional edits with retained bases and conservative effect recovery.
import type { Context } from "@earendil-works/chord/context";
import { defineDoc } from "../documents.ts";
import { type ExecutionEnv, getOrThrow } from "../env/index.ts";
import type { Harness } from "../harness/types.ts";
import { withFileMutationQueue } from "../tools/file-mutation-queue.ts";
import { authorize, ThreadDoc } from "./state.ts";
import { CollaborationError } from "./types.ts";

/** A retained read; null means the file did not exist, unlike an empty file. */
export type ManagedFileRead = { id: string; actorId: string; agentId: string; content: string | null };

/** A stable caller-scoped proposal against a previously issued read ID. */
export type ManagedFileEdit = { id: string; agentId: string; baseId: string; content: string };

/** Persisted publication state, separate from whether an agent turn completed. */
export type ManagedFileProposal = ManagedFileEdit & {
	actorId: string;
	base: string | null;
} & (
		| { status: "prepared" | "applied" }
		| { status: "conflict"; current: string | null }
		| { status: "uncertain"; reason: string }
	);

type ManagedFileState = {
	configuration: { path: string; filesystemId: string } | null;
	reads: ManagedFileRead[];
	proposals: ManagedFileProposal[];
};

const ManagedFileDoc = defineDoc<ManagedFileState>({
	kind: "pi.collaboration.managed-file",
	version: 1,
	scope: "session",
	initial: () => ({ configuration: null, reads: [], proposals: [] }),
	checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 16,
});

/** Coordinates one root-level text file per thread/store; all writers must participate. */
export class ManagedFile {
	readonly #harness: Harness;
	readonly #env: ExecutionEnv;
	readonly #path: string;

	private constructor(harness: Harness, env: ExecutionEnv, path: string) {
		this.#harness = harness;
		this.#env = env;
		this.#path = path;
	}

	/** Bind one root-level filename to this thread; reopening cannot change the binding. */
	static async open(harness: Harness, env: ExecutionEnv, filename: string, context: Context): Promise<ManagedFile> {
		// Declaration policy: this slice supports one portable root-level name, not arbitrary paths.
		if (
			!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(filename) ||
			filename.endsWith(".") ||
			/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(filename)
		) {
			throw new CollaborationError("invalid_config", "Managed files require a portable root-level filename");
		}
		const thread = await harness.snapshot(ThreadDoc, context);
		if (!thread?.thread) throw new CollaborationError("invalid_config", "Open the collaborative thread first");
		const workspace = getOrThrow(await env.canonicalPath(thread.thread.configuration.workspace, context));
		const path = getOrThrow(await env.joinPath([workspace, filename], context));
		await harness.commit(async (tx) => {
			const state = await tx.doc(ManagedFileDoc);
			if (
				state.configuration &&
				(state.configuration.path !== path || state.configuration.filesystemId !== env.id)
			) {
				throw new CollaborationError("conflict", "The store already manages a different file or filesystem");
			}
			state.configuration = { path, filesystemId: env.id };
		}, context);
		return new ManagedFile(harness, env, path);
	}

	/** Retain a bounded base, retrying the same read identity without refreshing its content. */
	async read(actorId: string, agentId: string, id: string, context: Context): Promise<ManagedFileRead> {
		validateId(id);
		await this.#authorize(actorId, agentId, context);
		return withFileMutationQueue(
			this.#env,
			this.#path,
			async () => {
				const state = (await this.#harness.snapshot(ManagedFileDoc, context))!;
				const existing = state.reads.find(
					(read) => read.actorId === actorId && read.agentId === agentId && read.id === id,
				);
				if (existing) return existing;
				assertSettled(state);
				if (state.reads.length >= 64) throw new CollaborationError("capacity", "Managed read capacity reached");
				const read = { id, actorId, agentId, content: await this.#content(context) };
				await this.#harness.commit(async (tx) => {
					(await tx.doc(ManagedFileDoc)).reads.push(read);
				}, context);
				return read;
			},
			context,
		);
	}

	/** Compare and publish under one gate; stale edits retain base/current/proposed without writing. */
	async propose(actorId: string, edit: ManagedFileEdit, context: Context): Promise<ManagedFileProposal> {
		validateId(edit.id);
		await this.#authorize(actorId, edit.agentId, context);
		// Admission policy: typed strings do not guarantee bounded UTF-8 text.
		const bytes = new TextEncoder().encode(edit.content);
		if (bytes.length > 16_384 || edit.content.includes("\0") || !edit.content.isWellFormed()) {
			throw new CollaborationError("invalid_command", "Managed content must be text of at most 16384 UTF-8 bytes");
		}
		return withFileMutationQueue(
			this.#env,
			this.#path,
			async () => {
				const state = (await this.#harness.snapshot(ManagedFileDoc, context))!;
				const existing = state.proposals.find(
					(item) => item.actorId === actorId && item.agentId === edit.agentId && item.id === edit.id,
				);
				if (existing) {
					if (existing.baseId !== edit.baseId || existing.content !== edit.content) {
						throw new CollaborationError("conflict", "Proposal ID has another payload");
					}
					return existing;
				}
				assertSettled(state);
				if (state.proposals.length >= 32)
					throw new CollaborationError("capacity", "Managed proposal capacity reached");
				const base = state.reads.find(
					(read) => read.actorId === actorId && read.agentId === edit.agentId && read.id === edit.baseId,
				);
				if (!base) throw new CollaborationError("not_found", "Read this file with the same actor and agent first");
				context.abortSignal?.throwIfAborted();
				const current = await this.#content(context);
				const common = { ...edit, actorId, base: base.content };
				const proposal: ManagedFileProposal =
					current === base.content
						? { ...common, status: "prepared" }
						: { ...common, status: "conflict", current };
				await this.#harness.commit(async (tx) => {
					(await tx.doc(ManagedFileDoc)).proposals.push(proposal);
				}, context);
				if (proposal.status === "conflict") return proposal;
				// Commit intent before I/O. Re-entry returns the record and never blindly repeats a write.
				try {
					context.abortSignal?.throwIfAborted();
					getOrThrow(await this.#env.writeFile(this.#path, edit.content, context));
					return await this.#settle({ ...common, status: "applied" }, context);
				} catch (error) {
					// If reporting also fails (including cancellation), prepared intent remains and blocks new access.
					return this.#settle({ ...common, status: "uncertain", reason: String(error).slice(0, 1000) }, context);
				}
			},
			context,
		);
	}

	/** Return retained publication evidence to a member, even when an uncertain write blocks new edits. */
	async proposals(actorId: string, context: Context): Promise<ManagedFileProposal[]> {
		const thread = (await this.#harness.snapshot(ThreadDoc, context))!;
		authorize(thread, actorId);
		return (await this.#harness.snapshot(ManagedFileDoc, context))!.proposals;
	}

	async #authorize(actorId: string, agentId: string, context: Context): Promise<void> {
		const thread = (await this.#harness.snapshot(ThreadDoc, context))!;
		authorize(thread, actorId);
		if (!thread.thread!.agents.some((agent) => agent.id === agentId)) {
			throw new CollaborationError("not_found", "Unknown agent");
		}
	}

	async #content(context: Context): Promise<string | null> {
		const opened = await this.#env.openBinaryReader(this.#path, { noFollow: true }, context);
		if (!opened.ok) {
			if (opened.error.code === "not_found") return null;
			throw opened.error;
		}
		const reader = opened.value;
		try {
			const bytes = getOrThrow(await reader.read(0, 16_385, context));
			if (bytes.length > 16_384) throw new CollaborationError("capacity", "Managed file exceeds 16384 bytes");
			// Filesystem trust boundary: reject invalid UTF-8 instead of comparing lossy decoded replacements.
			const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
			if (text.includes("\0"))
				throw new CollaborationError("invalid_command", "Managed file contains binary content");
			return text;
		} finally {
			await reader.close(context);
		}
	}

	async #settle(proposal: ManagedFileProposal, context: Context): Promise<ManagedFileProposal> {
		await this.#harness.commit(async (tx) => {
			const state = await tx.doc(ManagedFileDoc);
			const index = state.proposals.findIndex(
				(item) => item.actorId === proposal.actorId && item.agentId === proposal.agentId && item.id === proposal.id,
			);
			state.proposals[index] = proposal;
		}, context);
		return proposal;
	}
}

function validateId(id: string): void {
	// Admission policy: identity strings must be nonempty and bounded.
	if (!id || id.length > 128)
		throw new CollaborationError("invalid_command", "Managed IDs must contain 1 to 128 characters");
}

function assertSettled(state: Readonly<ManagedFileState>): void {
	if (state.proposals.some((proposal) => proposal.status === "prepared" || proposal.status === "uncertain")) {
		throw new CollaborationError(
			"conflict",
			"Managed file blocked by an uncertain publication; inspect retained evidence",
		);
	}
}
