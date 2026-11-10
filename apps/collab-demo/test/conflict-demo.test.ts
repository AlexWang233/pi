// Real SQLite/files and HTTP prove signed-in attribution, stale refusal and repeat-safe saved resolution.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConflictDemo } from "../src/conflict-demo.ts";
import { parseConflictView } from "../web/conflict.ts";
import type { ConflictAction } from "../web/conflict-state.ts";
import { aliceToken, bobToken, context, fixture, outsiderToken } from "./fixture.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0).reverse()) await close();
});

describe("controlled managed-file walkthrough", () => {
	it("shares real conflict evidence across users and preserves the explicit resolution after SQLite reopen", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-conflict-demo-"));
		cleanups.push(() => rm(directory, { recursive: true, force: true }));
		let demo = await ConflictDemo.open(directory, ["alice", "bob"], context);
		cleanups.push(() => demo.close(context));
		const app = await fixture(undefined, directory, demo);
		cleanups.push(app.close);
		const path = "/api/threads/room/conflict-demo";
		const post = async (token: string, body: ConflictAction) =>
			app.request(path, token, {
				method: "POST",
				body: JSON.stringify(body),
			});
		expect((await post(aliceToken, { kind: "publish" })).status).toBe(409);
		await Promise.all([post(aliceToken, { kind: "prepare" }), post(bobToken, { kind: "prepare" })]);
		const initial = parseConflictView(await (await app.request(path)).json());
		expect(initial.participants.every((item) => item.prepared && item.base === initial.current)).toBe(true);
		expect((await post(aliceToken, { kind: "publish" })).status).toBe(200);
		const conflict = parseConflictView(await (await post(bobToken, { kind: "publish" })).json());
		expect(conflict.current).toBe("Greeting: Hi from the team\nTheme: light\n");
		expect(conflict.proposals).toMatchObject([
			{ actorId: "alice", status: "applied" },
			{ actorId: "bob", status: "conflict" },
		]);
		expect(conflict.proposals[1]).toMatchObject({
			current: conflict.current,
			content: "Greeting: Hello\nTheme: dark\n",
		});
		expect(await readFile(join(directory, "workspace/shared.txt"), "utf8")).toBe(conflict.current);
		expect((await post(aliceToken, { kind: "resolve", content: "unauthorized resolution" })).status).toBe(409);
		const combined = "Greeting: Hi from the team\nTheme: dark\n";
		const resolution = { kind: "resolve", content: combined } as const;
		expect((await post(bobToken, resolution)).status).toBe(200);
		expect((await post(bobToken, resolution)).status).toBe(200);
		expect((await post(bobToken, { kind: "resolve", content: "changed retry" })).status).toBe(409);
		expect(await readFile(join(directory, "workspace/shared.txt"), "utf8")).toBe(combined);
		const saved = parseConflictView(await (await app.request(path, bobToken)).json());
		expect(saved.proposals).toHaveLength(3);
		expect(app.faux.state.callCount).toBe(0);
		expect(app.externalCalls()).toBe(0);
		await app.close();
		await demo.close(context);
		demo = await ConflictDemo.open(directory, ["alice", "bob"], context);
		expect(await demo.view("bob", context)).toEqual(saved);
		expect(await demo.perform("bob", resolution, context)).toEqual(saved);
	});

	it("authorizes before actions and refuses identity/path injection and oversized resolution text", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-conflict-auth-"));
		cleanups.push(() => rm(directory, { recursive: true, force: true }));
		const demo = await ConflictDemo.open(directory, ["alice", "bob", "carol"], context);
		cleanups.push(() => demo.close(context));
		const app = await fixture(undefined, directory, demo);
		cleanups.push(app.close);
		const path = "/api/threads/room/conflict-demo";
		expect((await app.request(path, "invalid")).status).toBe(401);
		expect((await app.request(path, outsiderToken)).status).toBe(403);
		expect((await app.request(path, outsiderToken, { method: "POST", body: '{"kind":"prepare"}' })).status).toBe(403);
		for (const body of [
			null,
			{ kind: "prepare", actorId: "bob" },
			{ kind: "publish", path: "/etc/passwd" },
			{ kind: "reset" },
		]) {
			expect((await app.request(path, aliceToken, { method: "POST", body: JSON.stringify(body) })).status).toBe(400);
		}
		expect((await app.request(path, aliceToken, { method: "DELETE" })).status).toBe(405);
		await expect(demo.perform("carol", { kind: "prepare" }, context)).rejects.toMatchObject({ code: "forbidden" });
		expect((await demo.view("carol", context)).participants).toHaveLength(2);
		await demo.perform("alice", { kind: "prepare" }, context);
		await demo.perform("bob", { kind: "prepare" }, context);
		await Promise.all([
			demo.perform("alice", { kind: "publish" }, context),
			demo.perform("bob", { kind: "publish" }, context),
		]);
		const before = await demo.view("bob", context);
		await expect(demo.perform("bob", { kind: "resolve", content: "x".repeat(16_385) }, context)).rejects.toMatchObject({
			code: "invalid_command",
		});
		expect((await demo.view("alice", context)).current).toBe(before.current);
	});
});
