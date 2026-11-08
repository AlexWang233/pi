// Many users target shared agents through HTTP; controlled barriers expose ordering and lost updates.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { type CollaborativeThreadConfig, createCollaboration } from "@earendil-works/pi-durable/collaboration";
import { afterEach, describe, expect, it } from "vitest";
import { openPreview } from "../src/preview-host.ts";
import { createDemoServer } from "../src/server.ts";
import { aliceToken, bobToken, context, fixture, lane } from "./fixture.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("many-to-many command concurrency", () => {
	it("admits all six user/agent pairs with the same caller-scoped command ID", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "pi-mn-preview-"));
		cleanups.push(() => rm(workspace, { recursive: true, force: true }));
		const users = ["alice", "bob", "carol"];
		const preview = await openPreview(workspace, new Map(users.map((user) => [`preview-${user}`, user])), context);
		cleanups.push(() => preview.close());
		await new Promise<void>((resolve) => preview.server.listen(0, "127.0.0.1", resolve));
		const address = preview.server.address();
		if (address === null || typeof address === "string") throw new Error("Expected TCP address");
		const origin = `http://127.0.0.1:${address.port}`;
		const agents = ["native-simulated", "external-simulated"];
		await Promise.all(
			users.flatMap((user) =>
				agents.map(async (agent) => {
					const response = await fetch(`${origin}/api/threads/preview/agents/${agent}/commands`, {
						method: "POST",
						headers: { Authorization: `Bearer preview-${user}`, "Content-Type": "application/json" },
						body: JSON.stringify({ id: "same-id", text: `${user} to ${agent}` }),
					});
					expect(response.status).toBe(202);
					expect(await response.json()).toEqual({ id: "same-id", actorId: user, agentId: agent });
				}),
			),
		);
		await preview.harness.waitForIdle(context);
		for (const user of users) {
			const listing = await fetch(`${origin}/api/threads`, { headers: { Authorization: `Bearer preview-${user}` } });
			expect(await listing.json()).toMatchObject({ actor: user, threads: [{ members: users }] });
			for (const agent of agents) {
				const state = await fetch(`${origin}/api/threads/preview/agents/${agent}/state`, {
					headers: { Authorization: `Bearer preview-${user}` },
				});
				const snapshot = (await state.json()) as { commands: { actorId: string; status: string }[] };
				expect(snapshot.commands).toHaveLength(3);
				expect(new Set(snapshot.commands.map((command) => command.actorId))).toEqual(new Set(users));
				expect(snapshot.commands.every((command) => command.status === "completed")).toBe(true);
			}
		}
	});

	it("queues simultaneous users on a native agent without overlapping model execution", async () => {
		const app = await fixture();
		const release = Promise.withResolvers<void>();
		cleanups.push(async () => {
			release.resolve();
			await app.close();
		});
		const entered = Promise.withResolvers<void>();
		const inputs: string[] = [];
		app.faux.setResponses([
			async (request) => {
				const user = request.messages.findLast((message) => message.role === "user")!;
				inputs.push(String(user.content));
				entered.resolve();
				await release.promise;
				return fauxAssistantMessage("first completed");
			},
			(request) => {
				inputs.push(String(request.messages.findLast((message) => message.role === "user")!.content));
				return fauxAssistantMessage("second completed");
			},
		]);
		await Promise.all(
			[
				[aliceToken, "alice instruction"],
				[bobToken, "bob instruction"],
			].map(async ([token, text]) => {
				expect(
					(
						await app.request(`${lane()}/commands`, token, {
							method: "POST",
							body: JSON.stringify({ id: "same", text }),
						})
					).status,
				).toBe(202);
			}),
		);
		await entered.promise;
		const before = await Promise.all(["alice", "bob"].map((actor) => app.thread.command(actor, "pi", "same", context)));
		expect(before.map((command) => command.status).sort()).toEqual(["queued", "running"]);
		expect(inputs).toHaveLength(1);
		const runningUser = before.find((command) => command.status === "running")!.actorId;
		release.resolve();
		await app.harness.waitForIdle(context);
		expect(inputs).toEqual([`${runningUser} instruction`, `${runningUser === "alice" ? "bob" : "alice"} instruction`]);
		for (const actor of ["alice", "bob"])
			expect(await app.thread.command(actor, "pi", "same", context)).toMatchObject({ status: "completed" });
	});

	it("exposes a lost update when two agents read the same file and later write stale replacements", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "pi-shared-race-"));
		cleanups.push(() => rm(workspace, { recursive: true, force: true }));
		const file = join(workspace, "shared.txt");
		await writeFile(file, "base");
		const gates = { first: Promise.withResolvers<void>(), second: Promise.withResolvers<void>() };
		const bothReading = Promise.withResolvers<void>();
		const firstWritten = Promise.withResolvers<void>();
		let reads = 0;
		const collaboration = createCollaboration([
			{
				name: "stale-writer",
				open: async ({ agentId }) => ({
					run: async ({ text }) => {
						const original = await readFile(file, "utf8");
						if (++reads === 2) bothReading.resolve();
						await (agentId === "first" ? gates.first : gates.second).promise;
						await writeFile(file, `${original}|${text}`);
						if (agentId === "first") firstWritten.resolve();
						return { status: "completed", text: "write succeeded", continuation: null };
					},
					close: async () => {},
				}),
			},
		]);
		const registry = createRegistry();
		registry.install(collaboration.extension);
		const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry }, context);
		cleanups.push(async () => {
			gates.first.resolve();
			gates.second.resolve();
			await harness.close(context);
		});
		const config: CollaborativeThreadConfig = {
			id: "race",
			workspace,
			members: ["alice", "bob"],
			agents: ["first", "second"].map((id) => ({ id, kind: "external", driver: "stale-writer" })),
		};
		const thread = await collaboration.open(harness, config, context);
		const demo = await createDemoServer(
			{
				threads: new Map([["race", { thread, config }]]),
				tokens: new Map([
					[aliceToken, "alice"],
					[bobToken, "bob"],
				]),
				assets: new Map(),
			},
			context,
		);
		await new Promise<void>((resolve) => demo.server.listen(0, "127.0.0.1", resolve));
		cleanups.push(() => demo.close());
		const address = demo.server.address();
		if (address === null || typeof address === "string") throw new Error("Expected TCP address");
		await Promise.all(
			[
				[aliceToken, "first", "alice"],
				[bobToken, "second", "bob"],
			].map(async ([token, agent, text]) => {
				const response = await fetch(`http://127.0.0.1:${address.port}/api/threads/race/agents/${agent}/commands`, {
					method: "POST",
					headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
					body: JSON.stringify({ id: "edit", text }),
				});
				expect(response.status).toBe(202);
			}),
		);
		await bothReading.promise;
		// Both agents reached the same stale read before either writer was released.
		expect(await readFile(file, "utf8")).toBe("base");
		gates.first.resolve();
		await firstWritten.promise;
		expect(await readFile(file, "utf8")).toBe("base|alice");
		gates.second.resolve();
		await harness.waitForIdle(context);
		expect(await readFile(file, "utf8")).toBe("base|bob");
		for (const [actor, agent] of [
			["alice", "first"],
			["bob", "second"],
		]) {
			expect(await thread.command(actor, agent, "edit", context)).toMatchObject({ status: "completed" });
		}
	});
});
