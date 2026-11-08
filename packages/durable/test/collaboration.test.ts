// Package-only collaboration coverage: no HTTP server, real providers, or paid tokens.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CollaborativeThreadConfig,
	createCollaboration,
	type ExternalAgentDriver,
} from "../src/collaboration/index.ts";
import { ThreadDoc } from "../src/collaboration/state.ts";
import { createRegistry, Harness, MemoryStorage } from "../src/index.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";

const context = BACKGROUND_CONTEXT;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function configuration(): CollaborativeThreadConfig {
	return {
		id: "room",
		workspace: process.cwd(),
		members: ["alice", "bob"],
		agents: [
			{ id: "pi", kind: "native", model: { provider: "faux", modelId: "faux-1" } },
			{ id: "external", kind: "external", driver: "controlled" },
		],
	};
}

async function fixture(driver?: ExternalAgentDriver, config = configuration()) {
	const collaboration = createCollaboration(driver ? [driver] : []);
	const registry = createRegistry();
	registry.install(collaboration.extension);
	const models = createModels();
	const faux = fauxProvider();
	models.setProvider(faux.provider);
	const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
	cleanups.push(() => harness.close(context));
	const thread = await collaboration.open(harness, config, context);
	return { harness, thread, faux, collaboration };
}

describe("collaborative Durable threads", () => {
	it("deduplicates concurrent commands and records authenticated author metadata", async () => {
		const { thread, harness, faux } = await fixture();
		faux.setResponses([fauxAssistantMessage("answer")]);
		const command = { id: "c1", agentId: "pi", text: "hello" };
		const receipts = await Promise.all([
			thread.submit("alice", command, context),
			thread.submit("alice", command, context),
		]);
		expect(receipts[0]).toEqual(receipts[1]);
		await harness.waitForIdle(context);
		expect(await thread.command("alice", "pi", "c1", context)).toMatchObject({
			status: "completed",
			answer: "answer",
		});
		const history = await thread.history("bob", "pi", 10, undefined, context);
		expect(history.items.filter((item) => item.kind === "collab.input")).toMatchObject([
			{ data: { actorId: "alice", id: "c1", agentId: "pi" } },
		]);
		await expect(thread.submit("alice", { ...command, text: "changed" }, context)).rejects.toMatchObject({
			code: "conflict",
		});
	});

	it("refuses nonmembers, unknown agents, and invalid declarations without admitting work", async () => {
		const { thread, harness, collaboration } = await fixture();
		await expect(
			thread.submit("mallory", { id: "c1", agentId: "pi", text: "secret" }, context),
		).rejects.toMatchObject({ code: "forbidden" });
		await expect(thread.history("mallory", "pi", 10, undefined, context)).rejects.toMatchObject({
			code: "forbidden",
		});
		await expect(
			thread.submit("alice", { id: "c1", agentId: "unknown", text: "hello" }, context),
		).rejects.toMatchObject({ code: "not_found" });
		await expect(
			collaboration.open(harness, { ...configuration(), members: ["alice", "alice"] }, context),
		).rejects.toMatchObject({ code: "invalid_config" });
		expect((await harness.snapshot(ThreadDoc, context))!.commands).toHaveLength(0);
	});

	it("returns existing receipts at capacity and scopes command IDs by user", async () => {
		const { thread, harness, faux } = await fixture(undefined, { ...configuration(), maxCommands: 2 });
		faux.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
		const command = { id: "same", agentId: "pi", text: "hello" };
		await thread.submit("alice", command, context);
		await thread.submit("bob", command, context);
		await harness.waitForIdle(context);
		await expect(thread.submit("alice", command, context)).resolves.toEqual({
			id: "same",
			agentId: "pi",
			actorId: "alice",
		});
		await expect(thread.submit("alice", { ...command, id: "new" }, context)).rejects.toMatchObject({
			code: "capacity",
		});
	});

	it("runs native and external agents concurrently while serializing external follow-ups", async () => {
		const nativeStarted = Promise.withResolvers<void>();
		const externalStarted = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const calls: string[] = [];
		const driver: ExternalAgentDriver = {
			name: "controlled",
			open: async () => ({
				run: async (turn) => {
					calls.push(turn.text);
					externalStarted.resolve();
					await release.promise;
					await turn.progress(`working on ${turn.text}`);
					return { status: "completed", text: `result ${turn.text}`, continuation: "thread-1" };
				},
				close: async () => {},
			}),
		};
		const { thread, harness, faux } = await fixture(driver);
		faux.setResponses([
			async () => {
				nativeStarted.resolve();
				await release.promise;
				return fauxAssistantMessage("native answer");
			},
		]);
		await thread.submit("alice", { id: "a", agentId: "pi", text: "native" }, context);
		await thread.submit("bob", { id: "b", agentId: "external", text: "first" }, context);
		await Promise.all([nativeStarted.promise, externalStarted.promise]);
		await thread.submit("alice", { id: "c", agentId: "external", text: "second" }, context);
		expect(calls).toEqual(["first"]);
		expect(await thread.command("alice", "external", "c", context)).toMatchObject({ status: "queued" });
		release.resolve();
		await harness.waitForIdle(context);
		expect(calls).toEqual(["first", "second"]);
		expect(await thread.command("bob", "external", "b", context)).toMatchObject({
			status: "completed",
			answer: "result first",
		});
		expect(await thread.command("alice", "external", "c", context)).toMatchObject({
			status: "completed",
			answer: "result second",
		});
	});

	it("surfaces a missing driver without executing native generation", async () => {
		const { thread, harness } = await fixture();
		await thread.submit("alice", { id: "a", agentId: "external", text: "hello" }, context);
		await harness.waitForIdle(context);
		expect(await thread.command("alice", "external", "a", context)).toMatchObject({
			status: "failed",
			reason: "External driver unavailable: controlled",
		});
	});

	it("streams bounded shared state to another member and disposes observation without cancelling work", async () => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const { thread, harness, faux } = await fixture();
		faux.setResponses([
			async () => {
				started.resolve();
				await release.promise;
				return fauxAssistantMessage("visible answer");
			},
		]);
		await expect(thread.watch("mallory", "pi", context)).rejects.toMatchObject({ code: "forbidden" });
		const watch = await thread.watch("bob", "pi", context);
		expect(watch.value.messages).toEqual([]);
		const seen = Promise.withResolvers<void>();
		watch.start(async (snapshot) => {
			if (snapshot.messages.some((message) => message.author === "alice" && message.text === "shared input"))
				seen.resolve();
		});
		await thread.submit("alice", { id: "shared", agentId: "pi", text: "shared input" }, context);
		await Promise.all([started.promise, seen.promise]);
		await watch.stop();
		await watch.closed;
		release.resolve();
		await harness.waitForIdle(context);
		expect(await thread.command("alice", "pi", "shared", context)).toMatchObject({ status: "completed" });
		const late = await thread.watch("bob", "pi", context);
		expect(late.value.messages).toContainEqual(
			expect.objectContaining({ role: "assistant", text: "visible answer" }),
		);
		await late.stop();
	});

	it("settles a cleanup failure instead of leaving a command permanently running", async () => {
		const { thread, harness } = await fixture({
			name: "controlled",
			open: async () => ({
				run: async () => ({ status: "completed", text: "answer", continuation: null }),
				close: async () => {
					throw new Error("cleanup failed");
				},
			}),
		});
		await thread.submit("alice", { id: "cleanup", agentId: "external", text: "work" }, context);
		await harness.waitForIdle(context);
		expect(await thread.command("alice", "external", "cleanup", context)).toMatchObject({
			status: "failed",
			reason: "Error: cleanup failed",
		});
	});

	it("stops an active external turn and its queued follow-ups, then admits fresh work", async () => {
		const started = Promise.withResolvers<void>();
		let calls = 0;
		let closed = 0;
		const { thread, harness } = await fixture({
			name: "controlled",
			open: async () => ({
				run: async (turn) => {
					if (++calls > 1) return { status: "completed", text: "fresh", continuation: null };
					started.resolve();
					return new Promise((_, reject) =>
						turn.signal.addEventListener("abort", () => reject(turn.signal.reason), { once: true }),
					);
				},
				close: async () => {
					closed++;
				},
			}),
		});
		await thread.submit("alice", { id: "active", agentId: "external", text: "wait" }, context);
		await started.promise;
		await thread.submit("bob", { id: "queued", agentId: "external", text: "later" }, context);
		await thread.stop("bob", "external", context);
		expect(await thread.command("alice", "external", "active", context)).toMatchObject({ status: "stopped" });
		expect(await thread.command("bob", "external", "queued", context)).toMatchObject({ status: "stopped" });
		expect(calls).toBe(1);
		expect(closed).toBe(1);
		await thread.submit("alice", { id: "fresh", agentId: "external", text: "again" }, context);
		await harness.waitForIdle(context);
		expect(await thread.command("alice", "external", "fresh", context)).toMatchObject({
			status: "completed",
			answer: "fresh",
		});
	});

	it("enforces external deadlines and closes the timed-out session", async () => {
		let closed = false;
		const { thread, harness } = await fixture(
			{
				name: "controlled",
				open: async () => ({
					run: (turn) =>
						new Promise((_, reject) =>
							turn.signal.addEventListener("abort", () => reject(turn.signal.reason), { once: true }),
						),
					close: async () => {
						closed = true;
					},
				}),
			},
			{ ...configuration(), externalTimeoutMs: 30 },
		);
		await thread.submit("alice", { id: "timeout", agentId: "external", text: "wait" }, context);
		await harness.waitForIdle(context);
		expect(await thread.command("alice", "external", "timeout", context)).toMatchObject({
			status: "failed",
			reason: "External turn deadline exceeded",
		});
		expect(closed).toBe(true);
	});

	it("does not dispatch an uncertain external turn again after interruption and reopen", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-collaboration-interrupt-"));
		cleanups.push(() => rm(directory, { recursive: true, force: true }));
		const started = Promise.withResolvers<void>();
		let calls = 0;
		const collaboration = createCollaboration([
			{
				name: "controlled",
				open: async () => ({
					run: (turn) => {
						calls++;
						started.resolve();
						return new Promise((_, reject) =>
							turn.signal.addEventListener("abort", () => reject(turn.signal.reason), { once: true }),
						);
					},
					close: async () => {},
				}),
			},
		]);
		const registry = createRegistry();
		registry.install(collaboration.extension);
		const database = join(directory, "thread.sqlite");
		const open = async () =>
			Harness.open(await openNodeSqliteStorage(database), { models: createModels(), registry }, context);
		const first = await open();
		const thread = await collaboration.open(first, configuration(), context);
		await thread.submit("alice", { id: "uncertain", agentId: "external", text: "side effect" }, context);
		await started.promise;
		await first.close(context);
		const second = await open();
		cleanups.push(() => second.close(context));
		const recovered = await collaboration.open(second, configuration(), context);
		second.resume();
		await second.waitForIdle(context);
		expect(calls).toBe(1);
		expect(await recovered.command("alice", "external", "uncertain", context)).toMatchObject({
			status: "interrupted",
		});
	});

	it("preserves configuration and deduplication across SQLite reopen", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-collaboration-"));
		cleanups.push(() => rm(directory, { recursive: true, force: true }));
		const database = join(directory, "thread.sqlite");
		const collaboration = createCollaboration();
		const registry = createRegistry();
		registry.install(collaboration.extension);
		const models = createModels();
		const faux = fauxProvider();
		models.setProvider(faux.provider);
		faux.setResponses([fauxAssistantMessage("persisted")]);
		const first = await Harness.open(await openNodeSqliteStorage(database), { models, registry }, context);
		const config = configuration();
		const thread = await collaboration.open(first, config, context);
		const command = { id: "saved", agentId: "pi", text: "hello" };
		await thread.submit("alice", command, context);
		await first.waitForIdle(context);
		const before = (await first.snapshot(ThreadDoc, context))!.thread!.agents;
		await first.close(context);
		const second = await Harness.open(await openNodeSqliteStorage(database), { models, registry }, context);
		cleanups.push(() => second.close(context));
		const reopened = await collaboration.open(second, config, context);
		await reopened.submit("alice", command, context);
		expect((await second.snapshot(ThreadDoc, context))!.thread!.agents).toEqual(before);
		expect((await second.snapshot(ThreadDoc, context))!.commands).toHaveLength(1);
		expect(await reopened.command("alice", "pi", "saved", context)).toMatchObject({
			status: "completed",
			answer: "persisted",
		});
		await expect(collaboration.open(second, { ...config, workspace: "different" }, context)).rejects.toMatchObject({
			code: "conflict",
		});
	});
});
