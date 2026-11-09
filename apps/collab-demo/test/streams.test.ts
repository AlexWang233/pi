// Stream framing/backpressure and real HTTP late join/disconnect behavior.
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { type AgentSnapshot, CollaborativeThread } from "@earendil-works/pi-durable/collaboration";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamViewer } from "../src/streams.ts";
import { sseData } from "../web/stream.ts";
import { aliceToken, bobToken, context, fixture, lane } from "./fixture.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0).reverse()) await close();
	vi.restoreAllMocks();
});

async function* chunks(response: Response) {
	const reader = response.body!.getReader();
	try {
		while (true) {
			const item = await reader.read();
			if (item.done) return;
			yield item.value;
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

async function until(frames: AsyncGenerator<string>, predicate: (snapshot: AgentSnapshot) => boolean) {
	while (true) {
		const { done, value: frame } = await frames.next();
		if (done) throw new Error("Stream ended before the expected snapshot");
		// Test fixture uses the server's own snapshot contract; assertions inspect the result.
		const value = JSON.parse(frame) as { agent: AgentSnapshot };
		if (predicate(value.agent)) return value.agent;
	}
}

describe("bounded collaborative observations", () => {
	it("handles split UTF-8/CRLF and multiple events and discards an incomplete last event", async () => {
		const bytes = new TextEncoder().encode(
			": heartbeat\r\ndata: héllo\r\ndata: world\r\n\r\ndata: second\n\ndata: incomplete",
		);
		async function* fragments() {
			for (const byte of bytes) yield Uint8Array.of(byte);
		}
		const values = [];
		for await (const data of sseData(fragments())) values.push(data);
		expect(values).toEqual(["héllo\nworld", "second"]);
	});

	it("rejects a peer that sends an unbounded event", async () => {
		async function* fragments() {
			yield new TextEncoder().encode(`data: ${"x".repeat(1024 * 1024 + 1)}`);
		}
		await expect(async () => {
			for await (const _data of sseData(fragments())) {
			}
		}).rejects.toThrow("limit");
	});

	it("coalesces a slow viewer to its newest snapshot and disconnects oversized frames", () => {
		const response = new ServerResponse(new IncomingMessage(new Socket()));
		const write = vi.spyOn(response, "write").mockReturnValueOnce(false).mockReturnValue(true);
		const destroy = vi.spyOn(response, "destroy");
		const viewer = new StreamViewer(response);
		viewer.send("initial");
		for (let index = 0; index < 1000; index++) viewer.send(`snapshot ${index}`);
		viewer.heartbeat();
		expect(write).toHaveBeenCalledTimes(1);
		response.emit("drain");
		expect(write).toHaveBeenLastCalledWith("snapshot 999");
		expect(write).toHaveBeenCalledTimes(2);
		viewer.send("x".repeat(1024 * 1024 + 1));
		expect(destroy).toHaveBeenCalledTimes(1);
	});

	it("caps viewers per lane without allocating more package watches", async () => {
		const watch = vi.spyOn(CollaborativeThread.prototype, "watch");
		const app = await fixture();
		cleanups.push(app.close);
		const disconnect = new AbortController();
		// Retain response bodies: fetch may release unreachable streams during GC, freeing viewer slots.
		const viewers: Response[] = [];
		cleanups.push(async () => {
			disconnect.abort();
			await Promise.all(viewers.map((viewer) => viewer.body!.cancel().catch(() => {})));
		});
		for (let index = 0; index < 32; index++) {
			const viewer = await app.request(`${lane()}/events`, aliceToken, { signal: disconnect.signal });
			viewers.push(viewer);
			expect(viewer.status).toBe(200);
		}
		expect((await app.request(`${lane()}/events`, bobToken)).status).toBe(503);
		expect(watch).toHaveBeenCalledTimes(2);
	});

	it("supports two viewers, mid-run attachment, disconnect without stop, and reconnect", async () => {
		const watch = vi.spyOn(CollaborativeThread.prototype, "watch");
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const app = await fixture({
			name: "held",
			open: async () => ({
				run: async () => {
					started.resolve();
					await release.promise;
					return { status: "completed", text: "shared answer", continuation: null };
				},
				close: async () => {},
			}),
		});
		cleanups.push(async () => {
			release.resolve();
			await app.close();
		});
		const first = new AbortController();
		const second = new AbortController();
		cleanups.push(async () => {
			first.abort();
			second.abort();
		});
		const viewA = await app.request(`${lane("external")}/events`, aliceToken, { signal: first.signal });
		const dataA = sseData(chunks(viewA));
		expect(await until(dataA, (value) => value.messages.length === 0)).toMatchObject({ busy: false });
		await app.request(`${lane("external")}/commands`, aliceToken, {
			method: "POST",
			body: JSON.stringify({ id: "work", text: "wait" }),
		});
		await started.promise;
		const viewB = await app.request(`${lane("external")}/events`, bobToken, { signal: second.signal });
		const dataB = sseData(chunks(viewB));
		expect(await until(dataB, (value) => value.busy)).toMatchObject({ agentId: "external" });
		expect(await until(dataA, (value) => value.busy)).toMatchObject({ agentId: "external" });
		expect(watch).toHaveBeenCalledTimes(2);
		first.abort();
		release.resolve();
		await app.harness.waitForIdle(context);
		expect(
			await until(dataB, (value) => value.commands.some((command) => command.status === "completed")),
		).toMatchObject({ agentId: "external" });
		expect(await app.thread.command("alice", "external", "work", context)).toMatchObject({ status: "completed" });
		const reconnected = await app.request(`${lane("external")}/events`, bobToken, { signal: second.signal });
		const snapshot = await until(sseData(chunks(reconnected)), (value) =>
			value.commands.some((command) => command.status === "completed"),
		);
		expect(snapshot.messages.filter((message) => message.text === "shared answer")).toHaveLength(1);
	});

	it("explicit HTTP stop cancels active/queued work while a peer still completes", async () => {
		const started = Promise.withResolvers<void>();
		const app = await fixture({
			name: "blocked",
			open: async () => ({
				run: async ({ signal }) => {
					started.resolve();
					return new Promise((_, reject) =>
						signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
					);
				},
				close: async () => {},
			}),
		});
		cleanups.push(app.close);
		for (const id of ["active", "queued"])
			await app.request(`${lane("external")}/commands`, aliceToken, {
				method: "POST",
				body: JSON.stringify({ id, text: "wait" }),
			});
		await started.promise;
		expect((await app.request(`${lane("external")}/stop`, bobToken, { method: "POST" })).status).toBe(200);
		await app.request(`${lane()}/commands`, aliceToken, {
			method: "POST",
			body: JSON.stringify({ id: "peer", text: "hi" }),
		});
		await app.harness.waitForIdle(context);
		for (const id of ["active", "queued"])
			expect(await app.thread.command("alice", "external", id, context)).toMatchObject({ status: "stopped" });
		expect(await app.thread.command("alice", "pi", "peer", context)).toMatchObject({ status: "completed" });
	});
});
