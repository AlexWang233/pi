// HTTP acceptance, authenticated identities, and retries through actual Durable execution.
import { afterEach, describe, expect, it } from "vitest";
import { aliceToken, bobToken, context, fixture, lane, outsiderToken } from "./fixture.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0).reverse()) await close();
});

describe("collaboration HTTP transport", () => {
	it("authenticates all API reads and writes and rejects nonmembers through the package", async () => {
		const app = await fixture();
		cleanups.push(app.close);
		expect((await fetch(`${app.url}/`)).status).toBe(200);
		for (const suffix of ["/history", "/events", "/state", "/commands/unknown"]) {
			expect((await app.request(lane() + suffix, "invalid")).status).toBe(401);
			expect((await app.request(lane() + suffix, outsiderToken)).status).toBe(403);
		}
		for (const suffix of ["/commands", "/stop"]) {
			expect(
				(
					await app.request(lane() + suffix, outsiderToken, {
						method: "POST",
						body: JSON.stringify({ id: "x", text: "hi" }),
					})
				).status,
			).toBe(403);
		}
		expect(await (await app.request("/api/threads", outsiderToken)).json()).toEqual({ actor: "mallory", threads: [] });
		expect((await app.request("/api/threads/other/agents/pi/history")).status).toBe(404);
	});

	it("keeps native/external routes identical and deduplicates a retry after an unread reply", async () => {
		const app = await fixture();
		cleanups.push(app.close);
		for (const agentId of ["pi", "external"]) {
			const body = JSON.stringify({ id: "lost-reply", text: "work" });
			const first = await app.request(`${lane(agentId)}/commands`, aliceToken, { method: "POST", body });
			expect(first.status).toBe(202);
			await first.body?.cancel();
			const retry = await app.request(`${lane(agentId)}/commands`, aliceToken, { method: "POST", body });
			expect(await retry.json()).toEqual({ id: "lost-reply", actorId: "alice", agentId });
		}
		await app.harness.waitForIdle(context);
		expect(app.faux.state.callCount).toBe(1);
		expect(app.externalCalls()).toBe(1);
		expect(await (await app.request(`${lane()}/commands/lost-reply`)).json()).toMatchObject({
			status: "completed",
			answer: "native answer",
		});
		expect((await app.request(`${lane()}/commands/lost-reply`, bobToken)).status).toBe(404);
		expect(
			(
				await app.request(`${lane()}/commands`, aliceToken, {
					method: "POST",
					body: JSON.stringify({ id: "lost-reply", text: "different" }),
				})
			).status,
		).toBe(409);
		const history = await (await app.request(`${lane()}/history?limit=1`, bobToken)).json();
		expect(history.items).toHaveLength(1);
		expect(history.items[0]).not.toHaveProperty("conversationId");
		if (history.next)
			expect((await app.request(`${lane()}/history?cursor=${encodeURIComponent(history.next)}`)).status).toBe(200);
	});

	it("rejects malformed, oversized, and identity-injecting input before admission", async () => {
		const app = await fixture();
		cleanups.push(app.close);
		for (const [body, status] of [
			["{", 400],
			["null", 400],
			[JSON.stringify({ id: "x", text: "hi", actorId: "bob" }), 400],
			[JSON.stringify({ id: "x", text: "a".repeat(17_000) }), 400],
			[JSON.stringify({ id: "x", text: "\u{1F600}".repeat(20_000) }), 413],
		] as const) {
			expect((await app.request(`${lane()}/commands`, aliceToken, { method: "POST", body })).status).toBe(status);
		}
		expect(
			(
				await app.request(`${lane()}/commands`, aliceToken, {
					method: "POST",
					headers: { "Content-Type": "text/plain" },
					body: "hi",
				})
			).status,
		).toBe(415);
		for (const query of ["limit=0", "limit=51", "cursor=bad", `cursor=${encodeURIComponent('{"after":"bad"}')}`]) {
			expect((await app.request(`${lane()}/history?${query}`)).status).toBe(400);
		}
		expect(app.faux.state.callCount).toBe(0);
	});

	it("maps bounded command capacity to 429 while keeping existing receipts retryable", async () => {
		const app = await fixture();
		cleanups.push(app.close);
		for (let index = 0; index < 4; index++) {
			expect(
				(
					await app.request(`${lane("external")}/commands`, aliceToken, {
						method: "POST",
						body: JSON.stringify({ id: String(index), text: "work" }),
					})
				).status,
			).toBe(202);
		}
		expect(
			(
				await app.request(`${lane("external")}/commands`, aliceToken, {
					method: "POST",
					body: JSON.stringify({ id: "extra", text: "work" }),
				})
			).status,
		).toBe(429);
		expect(
			(
				await app.request(`${lane("external")}/commands`, aliceToken, {
					method: "POST",
					body: JSON.stringify({ id: "0", text: "work" }),
				})
			).status,
		).toBe(202);
	});
});
