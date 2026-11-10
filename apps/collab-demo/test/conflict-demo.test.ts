// Real SQLite, HTTP and faux model requests verify repeatable rounds without paid provider calls.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentTools } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictDemo, type ConflictGeneration } from "../src/conflict-demo.ts";
import { parseConflictView } from "../web/conflict.ts";
import { type ConflictAction, DEFAULT_CONFLICT_PROMPTS } from "../web/conflict-state.ts";
import { aliceToken, bobToken, context, fixture, outsiderToken } from "./fixture.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0).reverse()) await close();
});

async function open(generation: ConflictGeneration = { kind: "scripted" }) {
	const directory = await mkdtemp(join(tmpdir(), "pi-conflict-round-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	let demo = await ConflictDemo.open(directory, ["alice", "bob", "carol"], generation, context);
	cleanups.push(() => demo.close(context));
	return {
		directory,
		get demo() {
			return demo;
		},
		async reopen() {
			await demo.close(context);
			demo = await ConflictDemo.open(directory, ["alice", "bob", "carol"], generation, context);
		},
	};
}

describe("controlled managed-file rounds", () => {
	it("publishes/refuses/resolves actual files, resets repeatedly and rejects stale requests after SQLite reopen", async () => {
		const app = await open();
		const host = await fixture(undefined, app.directory, app.demo);
		cleanups.push(host.close);
		const path = "/api/threads/room/conflict-demo";
		const initial = parseConflictView(await (await host.request(path)).json());
		const post = (token: string, action: ConflictAction) =>
			host.request(path, token, { method: "POST", body: JSON.stringify(action) });
		const round = initial.round;
		expect((await post(aliceToken, { kind: "publish", round })).status).toBe(409);
		await Promise.all(
			initial.participants.map((participant, index) =>
				post(index === 0 ? aliceToken : bobToken, {
					kind: "prepare",
					round,
					agentId: participant.agentId,
					prompt: participant.prompt,
				}),
			),
		);
		expect((await post(aliceToken, { kind: "publish", round })).status).toBe(200);
		const conflict = parseConflictView(await (await post(bobToken, { kind: "publish", round })).json());
		expect(conflict.current).toBe("Greeting: Hello\nTheme: light\n");
		expect(conflict.proposals).toMatchObject([
			{ actorId: "alice", status: "applied" },
			{ actorId: "bob", status: "conflict" },
		]);
		expect(conflict.proposals[1]).toMatchObject({
			current: conflict.current,
			content: "Greeting: Hi from the team\nTheme: dark\n",
		});
		const file = join(app.directory, "rounds", round, "workspace/shared.txt");
		expect(await readFile(file, "utf8")).toBe(conflict.current);
		expect((await post(aliceToken, { kind: "resolve", round, content: "not my conflict" })).status).toBe(409);
		const resolution = { kind: "resolve", round, content: "Reviewed combined content\n" } as const;
		expect((await post(bobToken, { ...resolution, content: "x".repeat(16_385) })).status).toBe(400);
		expect(await readFile(file, "utf8")).toBe(conflict.current);
		expect((await post(bobToken, resolution)).status).toBe(200);
		expect((await post(bobToken, resolution)).status).toBe(200);
		expect((await post(bobToken, { ...resolution, content: "changed retry" })).status).toBe(409);
		expect(await readFile(file, "utf8")).toBe(resolution.content);
		const reset = parseConflictView(await (await post(aliceToken, { kind: "reset", round })).json());
		expect(reset.round).not.toBe(round);
		expect(reset.current).toBe(initial.current);
		expect(reset.proposals).toEqual([]);
		expect(reset.participants.every((participant) => !participant.prepared && participant.output === null)).toBe(true);
		expect((await post(bobToken, { kind: "publish", round })).status).toBe(409);
		expect((await post(bobToken, { kind: "reset", round })).status).toBe(409);
		expect(await readFile(file, "utf8")).toBe(resolution.content);
		await host.close();
		await app.reopen();
		expect(await app.demo.view("bob", context)).toEqual(reset);
		const again = await app.demo.perform("bob", { kind: "reset", round: reset.round }, context);
		expect(again.round).not.toBe(reset.round);
		await app.demo.perform(
			"alice",
			{ kind: "prepare", round: again.round, agentId: again.agents[0].id, prompt: DEFAULT_CONFLICT_PROMPTS[0] },
			context,
		);
		await app.reopen();
		expect((await app.demo.view("alice", context)).participants[0].prepared).toBe(true);
		expect(host.faux.state.callCount).toBe(0);
	});

	it("uses custom live-model prompts in separate conversations, retains bases and never writes during generation", async () => {
		const models = createModels();
		const faux = fauxProvider();
		models.setProvider(faux.provider);
		const inputs: string[] = [];
		faux.setResponses(
			Array.from({ length: 2 }, () => (request) => {
				expect(getCurrentTools(request.messages)).toEqual([]);
				const text = JSON.stringify(request.messages.filter((message) => message.role === "user"));
				inputs.push(text);
				expect(text).toContain("Greeting: Welcome");
				return fauxAssistantMessage(text.includes("ALICE-CUSTOM") ? "Alice custom output\n" : "Bob custom output\n");
			}),
		);
		const app = await open({
			kind: "live",
			models,
			agents: [{ id: "same-model", kind: "native", model: { provider: "faux", modelId: "faux-1" } }],
		});
		const initial = await app.demo.view("alice", context);
		await Promise.all(
			["alice", "bob"].map((actor) =>
				app.demo.perform(
					actor,
					{
						kind: "prepare",
						round: initial.round,
						agentId: "same-model",
						prompt: `${actor.toUpperCase()}-CUSTOM: rewrite the greeting`,
					},
					context,
				),
			),
		);
		await vi.waitFor(async () => {
			const view = await app.demo.view("alice", context);
			expect(view.participants.map((item) => item.generation)).toEqual(["completed", "completed"]);
		});
		const generated = await app.demo.view("bob", context);
		expect(generated.current).toBe(initial.current);
		expect(generated.proposals).toEqual([]);
		expect(generated.participants.map((item) => item.output)).toEqual(["Alice custom output\n", "Bob custom output\n"]);
		expect(inputs).toHaveLength(2);
		expect(inputs.every((text) => text.includes("ALICE-CUSTOM") !== text.includes("BOB-CUSTOM"))).toBe(true);
		await app.demo.perform(
			"alice",
			{ kind: "prepare", round: initial.round, agentId: "same-model", prompt: "ALICE-CUSTOM: rewrite the greeting" },
			context,
		);
		expect(faux.state.callCount).toBe(2);
		await expect(
			app.demo.perform(
				"alice",
				{ kind: "prepare", round: initial.round, agentId: "same-model", prompt: "different retry" },
				context,
			),
		).rejects.toMatchObject({ code: "conflict" });
		await app.demo.perform("alice", { kind: "publish", round: initial.round }, context);
		const refused = await app.demo.perform("bob", { kind: "publish", round: initial.round }, context);
		expect(refused.current).toBe("Alice custom output\n");
		expect(refused.proposals[1]).toMatchObject({ status: "conflict", content: "Bob custom output\n" });
		await app.reopen();
		expect((await app.demo.view("bob", context)).participants[1].output).toBe("Bob custom output\n");
		expect(faux.state.callCount).toBe(2);
	});

	it("resets while generation is in flight and prevents late results from changing the new round", async () => {
		const models = createModels();
		const faux = fauxProvider();
		models.setProvider(faux.provider);
		let started = false;
		let cancelled = false;
		faux.setResponses([
			async (_request, options) => {
				started = true;
				await new Promise<void>((_resolve, reject) => {
					options!.signal!.addEventListener(
						"abort",
						() => {
							cancelled = true;
							reject(options!.signal!.reason);
						},
						{ once: true },
					);
				});
				return fauxAssistantMessage("late output");
			},
		]);
		const app = await open({
			kind: "live",
			models,
			agents: [{ id: "model", kind: "native", model: { provider: "faux", modelId: "faux-1" } }],
		});
		const initial = await app.demo.view("alice", context);
		await app.demo.perform(
			"alice",
			{ kind: "prepare", round: initial.round, agentId: "model", prompt: "Wait for reset" },
			context,
		);
		await vi.waitFor(() => expect(started).toBe(true));
		const reset = await app.demo.perform("bob", { kind: "reset", round: initial.round }, context);
		expect(cancelled).toBe(true);
		expect(reset.current).toBe(initial.current);
		expect(reset.participants.every((item) => !item.prepared)).toBe(true);
		expect(reset.proposals).toEqual([]);
		await expect(app.demo.perform("alice", { kind: "publish", round: initial.round }, context)).rejects.toMatchObject({
			code: "conflict",
		});
	});

	it("shows model failures without publishing and accepts a fresh generation after reset", async () => {
		const models = createModels();
		const faux = fauxProvider();
		models.setProvider(faux.provider);
		faux.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "fixture failure" }),
			fauxAssistantMessage("Recovered proposal\n"),
		]);
		const app = await open({
			kind: "live",
			models,
			agents: [{ id: "model", kind: "native", model: { provider: "faux", modelId: "faux-1" } }],
		});
		const initial = await app.demo.view("alice", context);
		await app.demo.perform(
			"alice",
			{ kind: "prepare", round: initial.round, agentId: "model", prompt: "first attempt" },
			context,
		);
		await vi.waitFor(async () =>
			expect((await app.demo.view("alice", context)).participants[0].generation).toBe("failed"),
		);
		expect((await app.demo.view("alice", context)).current).toBe(initial.current);
		await expect(app.demo.perform("alice", { kind: "publish", round: initial.round }, context)).rejects.toMatchObject({
			code: "conflict",
		});
		const reset = await app.demo.perform("alice", { kind: "reset", round: initial.round }, context);
		await app.demo.perform(
			"alice",
			{ kind: "prepare", round: reset.round, agentId: "model", prompt: "second attempt" },
			context,
		);
		await vi.waitFor(async () =>
			expect((await app.demo.view("alice", context)).participants[0].output).toBe("Recovered proposal\n"),
		);
	});

	it("authorizes reset and rejects forged actors, paths, models, stale rounds and malformed prompts", async () => {
		const app = await open();
		const host = await fixture(undefined, app.directory, app.demo);
		cleanups.push(host.close);
		const path = "/api/threads/room/conflict-demo";
		const initial = await app.demo.view("alice", context);
		expect((await host.request(path, outsiderToken)).status).toBe(403);
		expect((await host.request(path, "invalid")).status).toBe(401);
		const prepare = { kind: "prepare", round: initial.round, agentId: initial.agents[0].id, prompt: "custom" } as const;
		for (const body of [
			null,
			{ ...prepare, actorId: "bob" },
			{ ...prepare, path: "/etc/passwd" },
			{ kind: "reset" },
			{ ...prepare, agentId: "unconfigured" },
			{ ...prepare, prompt: "x".repeat(4097) },
			{ ...prepare, prompt: "" },
			{ ...prepare, prompt: "\0" },
		]) {
			expect((await host.request(path, aliceToken, { method: "POST", body: JSON.stringify(body) })).status).toBe(400);
		}
		await expect(app.demo.perform("carol", { kind: "reset", round: initial.round }, context)).rejects.toMatchObject({
			code: "forbidden",
		});
		expect(
			(
				await host.request(path, outsiderToken, {
					method: "POST",
					body: JSON.stringify({ kind: "reset", round: initial.round }),
				})
			).status,
		).toBe(403);
		expect((await app.demo.view("alice", context)).round).toBe(initial.round);
	});
});
