// Scheduler-fault reconciliation and real owner-process kills, using SQLite and deterministic drivers.
import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { afterEach, describe, expect, it } from "vitest";
import { createCollaboration, type ExternalTurn } from "../src/collaboration/index.ts";
import { ThreadDoc } from "../src/collaboration/state.ts";
import { createRegistry, Harness, MemoryStorage } from "../src/index.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";

const context = BACKGROUND_CONTEXT;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("collaboration recovery", () => {
	it("derives interrupted status after a scheduler fault and frees capacity without a read-side repair", async () => {
		const fail = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		let calls = 0;
		const collaboration = createCollaboration([
			{
				name: "controlled",
				open: async () => ({
					run: async ({ progress }) => {
						if (++calls > 1) return { status: "completed", text: "fresh answer", continuation: null };
						await progress("before fault");
						started.resolve();
						await fail.promise;
						// Inject an exception during result settlement, beyond the driver's ordinary run-error handler.
						return {
							status: "completed",
							get text(): string {
								throw new Error("injected settlement fault");
							},
							continuation: null,
						};
					},
					close: async () => {},
				}),
			},
		]);
		const registry = createRegistry();
		registry.install(collaboration.extension);
		const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry }, context);
		cleanups.push(() => harness.close(context));
		cleanups.push(async () => fail.resolve());
		const thread = await collaboration.open(
			harness,
			{
				id: "fault",
				workspace: process.cwd(),
				members: ["alice", "bob"],
				maxPendingPerAgent: 1,
				agents: [{ id: "external", kind: "external", driver: "controlled" }],
			},
			context,
		);
		const watch = await thread.watch("bob", "external", context);
		cleanups.push(() => watch.stop());
		const observed = Promise.withResolvers<void>();
		watch.start(async (snapshot) => {
			if (!snapshot.busy && snapshot.commands.some((command) => command.status === "interrupted"))
				observed.resolve();
		});
		const first = { id: "first", agentId: "external", text: "work" };
		await thread.submit("alice", first, context);
		await started.promise;
		fail.resolve();
		await harness.waitForIdle(context);
		const metadata = (await harness.snapshot(ThreadDoc, context))!;
		const stored = metadata.commands[0]!;
		expect(stored).toMatchObject({ kind: "external", state: { status: "running" } });
		if (stored.kind !== "external") throw new Error("Expected external command");
		expect((await harness.getTask(stored.taskId, context))!.state).toMatchObject({
			status: "terminal",
			outcome: { status: "faulted" },
		});
		// Capacity uses task outcomes; observation does not repair the persisted running record.
		await thread.submit("bob", { id: "fresh", agentId: "external", text: "fresh" }, context);
		await harness.waitForIdle(context);
		await observed.promise;
		expect(await thread.command("alice", "external", "first", context)).toMatchObject({ status: "interrupted" });
		expect(await thread.command("bob", "external", "fresh", context)).toMatchObject({ status: "completed" });
		expect(watch.value.progress).toBe("");
		await thread.submit("alice", first, context);
		expect(calls).toBe(2);
	});

	it("rejects late progress after settlement instead of reviving a completed command", async () => {
		let late: ExternalTurn["progress"] | undefined;
		const collaboration = createCollaboration([
			{
				name: "controlled",
				open: async () => ({
					run: async ({ progress }) => {
						late = progress;
						return { status: "completed", text: "answer", continuation: null };
					},
					close: async () => {},
				}),
			},
		]);
		const registry = createRegistry();
		registry.install(collaboration.extension);
		const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry }, context);
		cleanups.push(() => harness.close(context));
		const thread = await collaboration.open(
			harness,
			{
				id: "late",
				workspace: process.cwd(),
				members: ["alice"],
				agents: [{ id: "external", kind: "external", driver: "controlled" }],
			},
			context,
		);
		await thread.submit("alice", { id: "first", agentId: "external", text: "work" }, context);
		await harness.waitForIdle(context);
		await expect(late!("late update")).rejects.toThrow();
		expect(await thread.command("alice", "external", "first", context)).toMatchObject({
			status: "completed",
			answer: "answer",
		});
	});

	it("keeps real running progress when queued receipts push its command outside the visible window", async () => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const collaboration = createCollaboration([
			{
				name: "controlled",
				open: async () => ({
					run: async ({ text, progress }) => {
						if (text === "active") {
							await progress("still working");
							started.resolve();
							await release.promise;
						}
						return { status: "completed", text: "answer", continuation: null };
					},
					close: async () => {},
				}),
			},
		]);
		const registry = createRegistry();
		registry.install(collaboration.extension);
		const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry }, context);
		cleanups.push(() => harness.close(context));
		cleanups.push(async () => release.resolve());
		const thread = await collaboration.open(
			harness,
			{
				id: "window",
				workspace: process.cwd(),
				members: ["alice", "bob"],
				agents: [{ id: "external", kind: "external", driver: "controlled" }],
			},
			context,
		);
		await thread.submit("alice", { id: "active", agentId: "external", text: "active" }, context);
		await started.promise;
		for (let i = 0; i < 9; i++)
			await thread.submit("bob", { id: `queued-${i}`, agentId: "external", text: "later" }, context);
		const watch = await thread.watch("bob", "external", context);
		cleanups.push(() => watch.stop());
		expect(watch.value.commands).toHaveLength(8);
		expect(watch.value.commands.every((command) => command.status === "queued")).toBe(true);
		expect(watch.value.progress).toBe("still working");
		release.resolve();
		await harness.waitForIdle(context);
	});

	it.each(["before-turn", "after-effect", "after-result", "restart-limit"] as const)(
		"preserves command identity after forced owner death at %s",
		async (boundary) => {
			const workspace = await mkdtemp(join(tmpdir(), "pi-collaboration-kill-"));
			cleanups.push(() => rm(workspace, { recursive: true, force: true }));
			const ready = Promise.withResolvers<void>();
			const exited = Promise.withResolvers<void>();
			const fixture = fileURLToPath(new URL("./fixtures/collaboration-crash-host.ts", import.meta.url));
			const child = spawn(
				process.execPath,
				["--conditions=source", "--experimental-strip-types", fixture, workspace, boundary],
				{
					stdio: ["ignore", "pipe", "pipe", "ipc"],
					windowsHide: true,
				},
			);
			let stderr = "";
			// The explicit stdio configuration above supplies both pipe streams.
			child.stderr!.on("data", (chunk: Buffer) => {
				stderr = (stderr + chunk.toString()).slice(-4000);
			});
			child.stdout!.resume();
			child.once("error", ready.reject);
			child.on("message", (message: unknown) => {
				// IPC trust boundary: the child must acknowledge the requested crash barrier.
				if (
					message !== null &&
					typeof message === "object" &&
					"type" in message &&
					message.type === "ready" &&
					"boundary" in message &&
					message.boundary === boundary
				)
					ready.resolve();
			});
			child.once("close", () => {
				ready.reject(new Error(`Child exited before crash barrier: ${stderr}`));
				exited.resolve();
			});
			const stop = async () => {
				if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
				await exited.promise;
			};
			cleanups.push(stop);
			await ready.promise;
			await stop();
			const collaboration = createCollaboration([
				{
					name: "controlled",
					open: async () => {
						await appendFile(join(workspace, "dispatches.txt"), "open\n");
						return {
							run: async ({ text }) => {
								await appendFile(join(workspace, "effects.txt"), `${text}\n`);
								return { status: "completed", text: "fresh answer", continuation: null };
							},
							close: async () => {},
						};
					},
				},
			]);
			const registry = createRegistry();
			registry.install(collaboration.extension);
			const harness = await Harness.open(
				await openNodeSqliteStorage(join(workspace, "thread.sqlite")),
				{ models: createModels(), registry, settings: { restartLimit: boundary === "restart-limit" ? 1 : 5 } },
				context,
			);
			cleanups.push(() => harness.close(context));
			const thread = await collaboration.open(
				harness,
				{
					id: "crash",
					workspace,
					members: ["alice", "bob"],
					agents: [{ id: "external", kind: "external", driver: "controlled" }],
				},
				context,
			);
			harness.resume();
			await harness.waitForIdle(context);
			const first = { id: "first", agentId: "external", text: "first-effect" };
			const expectedStatus = boundary === "after-result" ? "completed" : "interrupted";
			expect(await thread.command("alice", "external", "first", context)).toMatchObject({ status: expectedStatus });
			if (boundary !== "after-result" && boundary !== "restart-limit")
				expect(await thread.command("bob", "external", "queued", context)).toMatchObject({ status: "stopped" });
			if (boundary === "restart-limit") {
				const stored = (await harness.snapshot(ThreadDoc, context))!.commands[0]!;
				if (stored.kind !== "external") throw new Error("Expected external command");
				expect((await harness.getTask(stored.taskId, context))!.state).toMatchObject({
					status: "terminal",
					outcome: { status: "faulted", error: { detail: { reason: "restart_limit" } } },
				});
			}
			await thread.submit("alice", first, context);
			await harness.waitForIdle(context);
			expect(await readFile(join(workspace, "dispatches.txt"), "utf8")).toBe("open\n");
			if (boundary === "before-turn")
				await expect(readFile(join(workspace, "effects.txt"))).rejects.toMatchObject({ code: "ENOENT" });
			else expect(await readFile(join(workspace, "effects.txt"), "utf8")).toBe("first-effect\n");
			await thread.submit("bob", { id: "fresh", agentId: "external", text: "fresh-effect" }, context);
			await harness.waitForIdle(context);
			expect(await thread.command("bob", "external", "fresh", context)).toMatchObject({ status: "completed" });
			expect(await readFile(join(workspace, "dispatches.txt"), "utf8")).toBe("open\nopen\n");
			expect(await readFile(join(workspace, "effects.txt"), "utf8")).toBe(
				boundary === "before-turn" ? "fresh-effect\n" : "first-effect\nfresh-effect\n",
			);
		},
	);
});
