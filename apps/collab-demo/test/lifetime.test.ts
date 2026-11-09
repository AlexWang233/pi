// Failed storage must release the host's signal wait, with no automatic reopen or leaked signal handlers.
import { EventEmitter } from "node:events";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vitest";
import { waitForHostShutdown } from "../src/lifetime.ts";

describe("demo host lifetime", () => {
	it.each(["SIGINT", "SIGTERM"])(
		"releases both handlers on %s without stopping an unrelated Harness",
		async (signal) => {
			const signals = new EventEmitter();
			const closed = Promise.withResolvers<Awaited<Harness["closed"]>>();
			const waiting = waitForHostShutdown(closed.promise, signals);
			signals.emit(signal);
			await waiting;
			expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM")).toBe(0);
			// A later failure is still observed by the already-settled race rather than becoming unhandled.
			closed.resolve({ kind: "failed", error: new Error("late") });
		},
	);
	it("rejects on a real Harness storage failure without exposing its cause", async () => {
		const storage = new MemoryStorage();
		const context = BACKGROUND_CONTEXT;
		const harness = await Harness.open(storage, { models: createModels(), registry: createRegistry() }, context);
		try {
			const root = await harness.root(context);
			const signals = new EventEmitter();
			const failure = new Error("sensitive injected backend detail");
			const waiting = expect(waitForHostShutdown(harness.closed, signals)).rejects.toThrow(/^Durable host failed;/);
			storage.commit = async () => {
				throw failure;
			};
			await expect(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context)).rejects.toBe(failure);
			await waiting;
			expect(signals.eventNames()).toEqual([]);
		} finally {
			await harness.close(context);
		}
	});
	it("also ends when the Harness closes normally without an OS signal", async () => {
		const signals = new EventEmitter();
		await waitForHostShutdown(Promise.resolve({ kind: "closed" }), signals);
		expect(signals.eventNames()).toEqual([]);
	});
});
