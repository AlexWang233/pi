// Conditional-edit coverage on real temporary files, with no models or paid calls.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCollaboration, ManagedFile } from "../src/collaboration/index.ts";
import { err, FileError } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { createRegistry, Harness, MemoryStorage } from "../src/index.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";

const context = BACKGROUND_CONTEXT;
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
	const workspace = await mkdtemp(join(tmpdir(), "pi-managed-file-"));
	cleanups.push(() => rm(workspace, { recursive: true, force: true }));
	const collaboration = createCollaboration();
	const registry = createRegistry();
	registry.install(collaboration.extension);
	const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry }, context);
	cleanups.push(() => harness.close(context));
	await collaboration.open(harness, configuration(workspace), context);
	const env = new NodeExecutionEnv({ cwd: workspace });
	const file = await ManagedFile.open(harness, env, "App.tsx", context);
	return { workspace, harness, env, file, path: join(workspace, "App.tsx") };
}

function configuration(workspace: string) {
	return {
		id: "managed",
		workspace,
		members: ["alice", "bob"],
		agents: [
			{ id: "a", kind: "native" as const, model: { provider: "faux", modelId: "faux-1" } },
			{ id: "b", kind: "external" as const, driver: "unused" },
		],
	};
}

describe("managed single-file publication", () => {
	it("serializes comparison and write across handles: one applies and one retains a stale proposal", async () => {
		const { workspace, harness, file, path } = await fixture();
		await writeFile(path, "base");
		const peer = await ManagedFile.open(harness, new NodeExecutionEnv({ cwd: workspace }), "App.tsx", context);
		await Promise.all([file.read("alice", "a", "base", context), peer.read("bob", "b", "base", context)]);
		const outcomes = await Promise.all([
			file.propose("alice", { id: "edit", agentId: "a", baseId: "base", content: "alice" }, context),
			peer.propose("bob", { id: "edit", agentId: "b", baseId: "base", content: "bob" }, context),
		]);
		expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["applied", "conflict"]);
		const applied = outcomes.find((outcome) => outcome.status === "applied")!;
		const conflict = outcomes.find((outcome) => outcome.status === "conflict")!;
		expect(await readFile(path, "utf8")).toBe(applied.content);
		expect(conflict).toMatchObject({ base: "base", current: applied.content });
		expect(conflict.content).not.toBe(applied.content);
		expect(await file.proposals("bob", context)).toHaveLength(2);
	});

	it("returns stable reads and proposal receipts without overwriting later content on retry", async () => {
		const { file, path } = await fixture();
		await writeFile(path, "base");
		const base = await file.read("alice", "a", "r1", context);
		const edit = { id: "p1", agentId: "a", baseId: "r1", content: "alice" };
		const receipt = await file.propose("alice", edit, context);
		await writeFile(path, "later external change");
		expect(await file.read("alice", "a", "r1", context)).toEqual(base);
		expect(await file.propose("alice", edit, context)).toEqual(receipt);
		expect(await readFile(path, "utf8")).toBe("later external change");
		await expect(file.propose("alice", { ...edit, content: "changed payload" }, context)).rejects.toMatchObject({
			code: "conflict",
		});
	});

	it("distinguishes missing from empty for create/create and edit/delete conflicts", async () => {
		const { file, path } = await fixture();
		expect((await file.read("alice", "a", "missing", context)).content).toBeNull();
		await file.read("bob", "b", "missing", context);
		await file.propose("alice", { id: "create", agentId: "a", baseId: "missing", content: "" }, context);
		expect(
			await file.propose("bob", { id: "create", agentId: "b", baseId: "missing", content: "bob" }, context),
		).toMatchObject({ status: "conflict", base: null, current: "" });
		await file.read("alice", "a", "empty", context);
		await rm(path);
		expect(
			await file.propose(
				"alice",
				{ id: "after-delete", agentId: "a", baseId: "empty", content: "replacement" },
				context,
			),
		).toMatchObject({ status: "conflict", base: "", current: null });
		await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("requires a new read and explicit proposal after a conflict", async () => {
		const { file, path } = await fixture();
		await writeFile(path, "base");
		await file.read("bob", "b", "old", context);
		await writeFile(path, "alice");
		await file.propose("bob", { id: "stale", agentId: "b", baseId: "old", content: "bob" }, context);
		await file.read("bob", "b", "fresh", context);
		expect(
			await file.propose("bob", { id: "resolved", agentId: "b", baseId: "fresh", content: "alice + bob" }, context),
		).toMatchObject({ status: "applied" });
		expect(await readFile(path, "utf8")).toBe("alice + bob");
		expect((await file.proposals("alice", context))[0]).toMatchObject({ status: "conflict", content: "bob" });
	});

	it("checks membership, agent identity and read ownership", async () => {
		const { file } = await fixture();
		await expect(file.read("mallory", "a", "r", context)).rejects.toMatchObject({ code: "forbidden" });
		await expect(file.proposals("mallory", context)).rejects.toMatchObject({ code: "forbidden" });
		await expect(file.read("alice", "unknown", "r", context)).rejects.toMatchObject({ code: "not_found" });
		await file.read("alice", "a", "r", context);
		await expect(
			file.propose("bob", { id: "p", agentId: "a", baseId: "r", content: "stolen base" }, context),
		).rejects.toMatchObject({ code: "not_found" });
		await expect(
			file.propose("alice", { id: "p", agentId: "b", baseId: "r", content: "other agent" }, context),
		).rejects.toMatchObject({ code: "not_found" });
	});

	it("rejects path changes and traversal instead of following a different target", async () => {
		const { harness, env } = await fixture();
		for (const path of ["../outside.txt", "sub/file.txt", "C:\\outside.txt", "NUL.txt", "x."]) {
			await expect(ManagedFile.open(harness, env, path, context)).rejects.toMatchObject({ code: "invalid_config" });
		}
		await expect(ManagedFile.open(harness, env, "other.txt", context)).rejects.toMatchObject({ code: "conflict" });
	});

	it("bounds file/proposal bytes and rejects malformed UTF-8 or binary data", async () => {
		const { file, path } = await fixture();
		await writeFile(path, "x".repeat(16_385));
		await expect(file.read("alice", "a", "large", context)).rejects.toMatchObject({ code: "capacity" });
		await writeFile(path, new Uint8Array([0xff]));
		await expect(file.read("alice", "a", "invalid", context)).rejects.toThrow();
		await writeFile(path, "binary\0");
		await expect(file.read("alice", "a", "binary", context)).rejects.toMatchObject({ code: "invalid_command" });
		await writeFile(path, "text");
		await file.read("alice", "a", "r", context);
		await expect(
			file.propose("alice", { id: "p", agentId: "a", baseId: "r", content: "é".repeat(8193) }, context),
		).rejects.toMatchObject({ code: "invalid_command" });
		await expect(file.read("alice", "a", "", context)).rejects.toMatchObject({ code: "invalid_command" });
		await expect(
			file.propose("alice", { id: "surrogate", agentId: "a", baseId: "r", content: "\uD800" }, context),
		).rejects.toMatchObject({ code: "invalid_command" });
	});

	it("preserves a UTF-8 byte-order mark during version comparison", async () => {
		const { file, path } = await fixture();
		await writeFile(path, "\uFEFFbase");
		expect((await file.read("alice", "a", "r", context)).content).toBe("\uFEFFbase");
		await writeFile(path, "base");
		expect(
			await file.propose("alice", { id: "p", agentId: "a", baseId: "r", content: "replacement" }, context),
		).toMatchObject({ status: "conflict", current: "base" });
	});

	it("retains uncertain partial writes and refuses further publication without replaying", async () => {
		const { file, env, path } = await fixture();
		await writeFile(path, "base");
		await file.read("alice", "a", "r", context);
		const writer = vi.spyOn(env, "writeFile").mockImplementation(async () => {
			await writeFile(path, "partial");
			return err(new FileError("unknown", "injected disk failure"));
		});
		const edit = { id: "p", agentId: "a", baseId: "r", content: "proposed" };
		expect(await file.propose("alice", edit, context)).toMatchObject({
			status: "uncertain",
			base: "base",
			content: "proposed",
		});
		expect(await file.propose("alice", edit, context)).toMatchObject({ status: "uncertain" });
		expect(writer).toHaveBeenCalledTimes(1);
		expect(await readFile(path, "utf8")).toBe("partial");
		await expect(file.read("bob", "b", "fresh", context)).rejects.toMatchObject({ code: "conflict" });
		await expect(file.propose("alice", { ...edit, id: "new" }, context)).rejects.toMatchObject({ code: "conflict" });
		expect(await file.proposals("bob", context)).toHaveLength(1);
	});

	it("does not write if persisting intent fails", async () => {
		const { file, env, harness, path } = await fixture();
		await writeFile(path, "base");
		await file.read("alice", "a", "r", context);
		const writer = vi.spyOn(env, "writeFile");
		vi.spyOn(harness, "commit").mockRejectedValueOnce(new Error("injected commit failure"));
		await expect(
			file.propose("alice", { id: "p", agentId: "a", baseId: "r", content: "proposed" }, context),
		).rejects.toThrow("injected commit failure");
		expect(writer).not.toHaveBeenCalled();
		expect(await readFile(path, "utf8")).toBe("base");
	});

	it("blocks on prepared intent when post-effect settlement cannot be committed", async () => {
		const { file, env, harness, path } = await fixture();
		await writeFile(path, "base");
		await file.read("alice", "a", "r", context);
		vi.spyOn(env, "writeFile").mockImplementation(async (_path, content) => {
			await writeFile(path, content);
			vi.spyOn(harness, "commit").mockRejectedValue(new Error("storage unavailable after effect"));
			return { ok: true, value: undefined };
		});
		const edit = { id: "p", agentId: "a", baseId: "r", content: "proposed" };
		await expect(file.propose("alice", edit, context)).rejects.toThrow("storage unavailable after effect");
		vi.restoreAllMocks();
		expect(await readFile(path, "utf8")).toBe("proposed");
		expect(await file.propose("alice", edit, context)).toMatchObject({ status: "prepared" });
		await expect(file.read("bob", "b", "new", context)).rejects.toMatchObject({ code: "conflict" });
	});

	it("keeps existing retries available when lifetime read/proposal capacity is full", async () => {
		const { file } = await fixture();
		for (let i = 0; i < 64; i++) await file.read("alice", "a", `r${i}`, context);
		await expect(file.read("alice", "a", "new", context)).rejects.toMatchObject({ code: "capacity" });
		expect(await file.read("alice", "a", "r0", context)).toMatchObject({ content: null });
		for (let i = 0; i < 32; i++)
			await file.propose("alice", { id: `p${i}`, agentId: "a", baseId: "r0", content: "created" }, context);
		await expect(
			file.propose("alice", { id: "new", agentId: "a", baseId: "r0", content: "created" }, context),
		).rejects.toMatchObject({ code: "capacity" });
		expect(
			await file.propose("alice", { id: "p0", agentId: "a", baseId: "r0", content: "created" }, context),
		).toMatchObject({ status: "applied" });
	});

	it.each(["conflict", "uncertain", "prepared"] as const)(
		"preserves %s evidence and retry policy across SQLite reopen",
		async (status) => {
			const workspace = await mkdtemp(join(tmpdir(), "pi-managed-reopen-"));
			cleanups.push(() => rm(workspace, { recursive: true, force: true }));
			const collaboration = createCollaboration();
			const registry = createRegistry();
			registry.install(collaboration.extension);
			const database = join(workspace, "thread.sqlite");
			const open = async () =>
				Harness.open(await openNodeSqliteStorage(database), { models: createModels(), registry }, context);
			const first = await open();
			await collaboration.open(first, configuration(workspace), context);
			const env = new NodeExecutionEnv({ cwd: workspace });
			const file = await ManagedFile.open(first, env, "App.tsx", context);
			await writeFile(join(workspace, "App.tsx"), "base");
			await file.read("alice", "a", "r", context);
			if (status === "conflict") await writeFile(join(workspace, "App.tsx"), "current");
			else
				vi.spyOn(env, "writeFile").mockImplementation(async (_path, content) => {
					await writeFile(join(workspace, "App.tsx"), content);
					if (status === "prepared") {
						vi.spyOn(first, "commit").mockRejectedValue(new Error("settlement unavailable"));
						return { ok: true, value: undefined };
					}
					return err(new FileError("unknown", "write outcome lost"));
				});
			const edit = { id: "p", agentId: "a", baseId: "r", content: "proposed" };
			if (status === "prepared")
				await expect(file.propose("alice", edit, context)).rejects.toThrow("settlement unavailable");
			else expect(await file.propose("alice", edit, context)).toMatchObject({ status });
			vi.restoreAllMocks();
			const evidence = await file.proposals("bob", context);
			await first.close(context);
			const second = await open();
			cleanups.push(() => second.close(context));
			await collaboration.open(second, configuration(workspace), context);
			const reopened = await ManagedFile.open(second, env, "App.tsx", context);
			const writer = vi.spyOn(env, "writeFile");
			expect(await reopened.propose("alice", edit, context)).toEqual(evidence[0]);
			expect(writer).not.toHaveBeenCalled();
			expect((await reopened.read("alice", "a", "r", context)).content).toBe("base");
			expect(await reopened.proposals("bob", context)).toEqual(evidence);
			if (status !== "conflict")
				await expect(reopened.read("bob", "b", "fresh", context)).rejects.toMatchObject({ code: "conflict" });
		},
	);
});
