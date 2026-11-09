// Real owner kills and SQLite fault injection distinguish command identity from replayed model/tool effects.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadDoc } from "../src/collaboration/state.ts";
import { Harness } from "../src/index.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { boundaryRuntime } from "./fixtures/collaboration-boundary-support.ts";

const context = BACKGROUND_CONTEXT;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0).reverse()) await close();
});

async function directory() {
	const workspace = await mkdtemp(join(tmpdir(), "pi-boundary-"));
	cleanups.push(() => rm(workspace, { recursive: true, force: true }));
	return workspace;
}

async function killAt(workspace: string, boundary: string, agentId: string) {
	const ready = Promise.withResolvers<void>();
	const closed = Promise.withResolvers<void>();
	const child = spawn(
		process.execPath,
		[
			"--conditions=source",
			"--experimental-strip-types",
			fileURLToPath(new URL("./fixtures/collaboration-boundary-host.ts", import.meta.url)),
			workspace,
			boundary,
			agentId,
		],
		{ stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true },
	);
	let stderr = "";
	child.stdout!.resume();
	child.stderr!.on("data", (chunk: Buffer) => {
		stderr = (stderr + chunk.toString()).slice(-4000);
	});
	child.once("error", (error) => {
		ready.reject(error);
		closed.resolve();
	});
	child.on("message", (message: unknown) => {
		// IPC trust boundary: only the exact requested barrier permits the parent to kill its child.
		if (
			message !== null &&
			typeof message === "object" &&
			"type" in message &&
			message.type === "ready" &&
			"boundary" in message &&
			message.boundary === boundary &&
			"agentId" in message &&
			message.agentId === agentId
		)
			ready.resolve();
	});
	child.once("close", () => {
		ready.reject(new Error(`Owner exited before barrier: ${stderr}`));
		closed.resolve();
	});
	const stop = async () => {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await closed.promise;
	};
	cleanups.push(stop);
	await ready.promise;
	await stop();
}

describe("collaboration persistence boundaries", () => {
	for (const agentId of ["native", "external"]) {
		it.each(["before-admission", "after-admission"])(
			`retries ${agentId} identity after owner death at %s`,
			async (boundary) => {
				const workspace = await directory();
				await killAt(workspace, boundary, agentId);
				const runtime = boundaryRuntime(workspace, async () => {});
				const harness = await Harness.open(
					await openNodeSqliteStorage(join(workspace, "thread.sqlite")),
					runtime,
					context,
				);
				cleanups.push(() => harness.close(context));
				const thread = await runtime.collaboration.open(harness, runtime.config, context);
				expect((await harness.snapshot(ThreadDoc, context))!.commands).toHaveLength(
					boundary === "before-admission" ? 0 : 1,
				);
				const command = { id: "first", agentId, text: "work" };
				await thread.submit("alice", command, context);
				await harness.waitForIdle(context);
				await thread.submit("alice", command, context);
				expect((await harness.snapshot(ThreadDoc, context))!.commands).toHaveLength(1);
				expect(await thread.command("alice", agentId, "first", context)).toMatchObject({ status: "completed" });
				expect(await readFile(join(workspace, agentId === "native" ? "model.txt" : "external.txt"), "utf8")).toBe(
					agentId === "native" ? "request\n" : "effect\n",
				);
			},
		);
	}

	it.each(["native-request", "native-tool"])(
		"retains one receipt while recovering interrupted %s",
		async (boundary) => {
			const workspace = await directory();
			await killAt(workspace, boundary, "native");
			const runtime = boundaryRuntime(workspace, async () => {});
			const harness = await Harness.open(
				await openNodeSqliteStorage(join(workspace, "thread.sqlite")),
				runtime,
				context,
			);
			cleanups.push(() => harness.close(context));
			const thread = await runtime.collaboration.open(harness, runtime.config, context);
			await thread.submit("alice", { id: "first", agentId: "native", text: "work" }, context);
			await harness.waitForIdle(context);
			expect((await harness.snapshot(ThreadDoc, context))!.commands).toHaveLength(1);
			expect(await thread.command("alice", "native", "first", context)).toMatchObject({
				status: "completed",
				answer: "native answer",
			});
			if (boundary === "native-request") {
				// Native generation can resend a model request while command admission stays deduplicated.
				expect(await readFile(join(workspace, "model.txt"), "utf8")).toBe("request\nrequest\n");
			} else {
				expect(await readFile(join(workspace, "tool.txt"), "utf8")).toBe("effect\n");
				const history = await thread.history("bob", "native", 50, undefined, context);
				expect(JSON.stringify(history.items)).toContain("may have partially run");
			}
		},
	);

	for (const agentId of ["native", "external"]) {
		it.each(["before", "after"])(
			`fails ${agentId} admission on a storage error %s persistence and safely reopens`,
			async (when) => {
				const workspace = await directory();
				const runtime = boundaryRuntime(workspace, async () => {});
				const path = join(workspace, "thread.sqlite");
				const storage = await openNodeSqliteStorage(path);
				const first = await Harness.open(storage, runtime, context);
				cleanups.push(() => first.close(context));
				const thread = await runtime.collaboration.open(first, runtime.config, context);
				const watch = await thread.watch("bob", agentId, context);
				const commit = storage.commit.bind(storage);
				const failure = new Error("injected admission I/O failure");
				storage.commit = async (batches, receive, ctx) => {
					if (when === "after") await commit(batches, receive, ctx);
					throw failure;
				};
				const command = { id: "first", agentId, text: "work" };
				await expect(thread.submit("alice", command, context)).rejects.toBe(failure);
				expect(await first.closed).toEqual({ kind: "failed", error: failure });
				await watch.closed;
				await expect(thread.submit("bob", { ...command, id: "peer" }, context)).rejects.toMatchObject({
					name: "SessionFailed",
				});
				await first.close(context);
				const second = await Harness.open(await openNodeSqliteStorage(path), runtime, context);
				cleanups.push(() => second.close(context));
				const recovered = await runtime.collaboration.open(second, runtime.config, context);
				expect((await second.snapshot(ThreadDoc, context))!.commands).toHaveLength(when === "before" ? 0 : 1);
				await recovered.submit("alice", command, context);
				await second.waitForIdle(context);
				expect(await recovered.command("alice", agentId, "first", context)).toMatchObject({ status: "completed" });
				expect(await readFile(join(workspace, agentId === "native" ? "model.txt" : "external.txt"), "utf8")).toBe(
					agentId === "native" ? "request\n" : "effect\n",
				);
			},
		);
	}

	it.each(["before", "after"])(
		"reconciles external effects after a result storage failure %s persistence",
		async (when) => {
			const workspace = await directory();
			const runtime = boundaryRuntime(workspace, async () => {});
			const path = join(workspace, "thread.sqlite");
			const storage = await openNodeSqliteStorage(path);
			const first = await Harness.open(storage, runtime, context);
			cleanups.push(() => first.close(context));
			const thread = await runtime.collaboration.open(first, runtime.config, context);
			const commit = storage.commit.bind(storage);
			const failure = new Error("injected result I/O failure");
			storage.commit = async (batches, receive, ctx) => {
				const result = batches.some((writes) =>
					writes.some((write) => write.type === "entry" && write.value.kind === "collab.answer"),
				);
				if (!result) return commit(batches, receive, ctx);
				if (when === "after") await commit(batches, receive, ctx);
				throw failure;
			};
			const command = { id: "first", agentId: "external", text: "work" };
			await thread.submit("alice", command, context);
			expect(await first.closed).toEqual({ kind: "failed", error: failure });
			await first.close(context);
			const second = await Harness.open(await openNodeSqliteStorage(path), runtime, context);
			cleanups.push(() => second.close(context));
			const recovered = await runtime.collaboration.open(second, runtime.config, context);
			await recovered.submit("alice", command, context);
			await second.waitForIdle(context);
			expect(await recovered.command("alice", "external", "first", context)).toMatchObject({
				status: when === "before" ? "interrupted" : "completed",
			});
			expect(await readFile(join(workspace, "external.txt"), "utf8")).toBe("effect\n");
		},
	);
});
