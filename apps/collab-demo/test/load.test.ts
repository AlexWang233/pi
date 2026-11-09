// Accounting regressions plus a bounded real SQLite/HTTP/SSE pressure smoke.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { account, distribution } from "../load/measure.ts";
import { runScenario } from "../load/scenario.ts";

describe("deterministic load evidence", () => {
	it("uses nearest-rank percentiles and represents missing samples explicitly", () => {
		expect(distribution([])).toEqual({ count: 0, min: null, p50: null, p95: null, p99: null, max: null });
		expect(distribution([9, 1, 3, 2])).toEqual({ count: 4, min: 1, p50: 2, p95: 9, p99: 9, max: 9 });
	});
	it("detects missing, duplicated and unexpected starts without inflating completion counts", () => {
		const result = account(
			[
				{
					id: "a",
					path: "/",
					submitted: 1,
					accepted: 2,
					terminal: { status: "completed", observed: 10 },
					streamObserved: 9,
				},
				{ id: "b", path: "/", submitted: 1, accepted: 2 },
			],
			new Map([
				["a", { starts: 2, started: 4, returned: 8 }],
				["rejected", { starts: 1, started: 4 }],
			]),
		);
		expect(result).toMatchObject({
			accepted: 2,
			completed: 1,
			starts: 3,
			unsettled: ["b"],
			missingStarts: ["b"],
			unexpectedStarts: ["rejected"],
			duplicateStarts: ["a"],
			streamObserved: 1,
		});
		expect(result.driverReturnToStreamTerminalMs.p50).toBe(1);
	});
	it("accounts for saturation, retry and reconnect while a real SSE reader is paused", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-load-test-"));
		try {
			const result = await runScenario(root, {
				name: "test",
				threads: 5,
				rounds: 1,
				intervalMs: 0,
				burst: 60,
				serviceMs: 150,
				outputChars: 128,
				reconnectEvery: 1,
				pausedReader: true,
			});
			expect(result.httpStatuses[429]).toBeGreaterThan(0);
			expect(result.accepted).toBeGreaterThan(0);
			expect(result.completed).toBe(result.accepted);
			expect(result.starts).toBe(result.accepted);
			expect(result).toMatchObject({
				retryFailures: 0,
				unsettled: [],
				missingStarts: [],
				unexpectedStarts: [],
				duplicateStarts: [],
				otherTerminal: 0,
				streamErrors: [],
				reconnects: 10,
			});
			expect(result.pausedReader.attached).toBe(true);
			expect(result.frames).toBeGreaterThan(2);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});
