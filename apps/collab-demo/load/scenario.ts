// Exercise real command/status/SSE endpoints; instrumentation is local to this load composition.
import { get } from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import type { AgentSnapshot, CommandStatus } from "@earendil-works/pi-durable/collaboration";
import { sseData } from "../web/stream.ts";
import { loadToken, openLoadHost } from "./host.ts";
import { account, type CommandSample, distribution } from "./measure.ts";

export type Scenario = {
	name: string;
	threads: number;
	rounds: number;
	intervalMs: number;
	burst: number;
	serviceMs: number;
	outputChars: number;
	reconnectEvery: number;
	pausedReader: boolean;
};

/** Run one bounded scenario with fresh stores and a separately counted duplicate-request probe. */
export async function runScenario(root: string, options: Scenario) {
	const host = await openLoadHost(root, options.threads, options.serviceMs, options.outputChars);
	const commands = new Map<string, CommandSample>();
	const httpStatuses: Record<number, number> = {};
	const viewers: Awaited<ReturnType<typeof observe>>[] = [];
	const resources: { elapsedMs: number; rss: number; heapUsed: number }[] = [];
	const started = performance.now();
	const cpu = process.cpuUsage();
	const loop = monitorEventLoopDelay({ resolution: 20 });
	let frames = 0;
	let reconnects = 0;
	let retryProbes = 0;
	let retryFailures = 0;
	const streamErrors: string[] = [];
	loop.enable();
	const sample = () => {
		const { rss, heapUsed } = process.memoryUsage();
		resources.push({ elapsedMs: performance.now() - started, rss, heapUsed });
	};
	sample();
	const sampler = setInterval(sample, 1000);
	const request = (path: string, init?: RequestInit) =>
		fetch(host.url + path, {
			...init,
			signal: AbortSignal.timeout(30_000),
			headers: { Authorization: `Bearer ${loadToken}`, "Content-Type": "application/json" },
		});
	const onFrame = (snapshot: AgentSnapshot) => {
		frames++;
		for (const status of snapshot.commands) {
			if (status.status === "queued" || status.status === "running") continue;
			const command = commands.get(status.id);
			if (command) {
				command.streamObserved ??= performance.now();
				command.terminal ??= { status: status.status, observed: command.streamObserved };
			}
		}
	};
	let paused: Awaited<ReturnType<typeof pauseReader>> | undefined;
	try {
		for (const lane of host.lanes) viewers.push(await observe(`${host.url}${lane.path}/events`, onFrame, streamErrors));
		if (options.pausedReader) paused = await pauseReader(`${host.url}${host.lanes[0].path}/events`);
		const submit = async (path: string, id: string) => {
			const command: CommandSample = { id, path, submitted: performance.now(), accepted: 0 };
			// Install before I/O: an SSE completion may arrive before the POST reply.
			commands.set(id, command);
			const response = await request(`${path}/commands`, { method: "POST", body: JSON.stringify({ id, text: id }) });
			httpStatuses[response.status] = (httpStatuses[response.status] ?? 0) + 1;
			await response.text();
			if (response.status !== 202) {
				commands.delete(id);
				if (response.status !== 429) throw new Error(`Unexpected admission response ${response.status}`);
				return;
			}
			command.accepted = performance.now();
		};
		for (let round = 0; round < options.rounds; round++) {
			const target = started + round * options.intervalMs;
			await delay(Math.max(0, target - performance.now()));
			const jobs = host.lanes.flatMap((lane) =>
				Array.from(
					{ length: options.burst },
					(_, index) => () => submit(lane.path, `${lane.threadId}-${lane.agentId}-${round}-${index}`),
				),
			);
			let next = 0;
			// Bound client connections independently of server capacity and drain all workers before teardown.
			const workers = await Promise.allSettled(
				Array.from({ length: Math.min(16, jobs.length) }, async () => {
					while (next < jobs.length) await jobs[next++]();
				}),
			);
			for (const worker of workers) if (worker.status === "rejected") throw worker.reason;
			if (options.reconnectEvery > 0 && (round + 1) % options.reconnectEvery === 0) {
				for (const viewer of viewers.splice(0)) await viewer.close();
				for (const lane of host.lanes)
					viewers.push(await observe(`${host.url}${lane.path}/events`, onFrame, streamErrors));
				reconnects += host.lanes.length;
			}
		}
		await delay(Math.max(0, started + options.rounds * options.intervalMs - performance.now()));
		// Retry accepted identities concurrently: each must return its original receipt without a second start.
		await Promise.all(
			[...commands.values()].slice(0, 10).map(async (command) => {
				retryProbes++;
				const response = await request(`${command.path}/commands`, {
					method: "POST",
					body: JSON.stringify({ id: command.id, text: command.id }),
				});
				const body: unknown = await response.json();
				// Wire boundary: verify the actual receipt rather than trusting a 202 alone.
				if (
					response.status !== 202 ||
					body === null ||
					typeof body !== "object" ||
					!("id" in body) ||
					body.id !== command.id
				)
					retryFailures++;
			}),
		);
		const deadline = performance.now() + 30_000;
		// Snapshots retain eight receipts. Query every accepted identity once, including those omitted by coalescing.
		for (const command of commands.values()) {
			while (true) {
				const response = await request(`${command.path}/commands/${command.id}`);
				if (response.status !== 200) throw new Error(`Status response ${response.status}`);
				// Same-host server contract; independent HTTP tests validate its wire shape.
				const status = (await response.json()) as CommandStatus;
				if (status.status !== "queued" && status.status !== "running") {
					command.terminal ??= { status: status.status, observed: performance.now() };
					break;
				}
				if (performance.now() > deadline) throw new Error(`Drain deadline exceeded: ${command.id}`);
				await delay(50);
			}
		}
		await delay(100);
		sample();
		const totals = account([...commands.values()], host.executions);
		const usage = process.cpuUsage(cpu);
		return {
			options,
			elapsedMs: performance.now() - started,
			httpStatuses,
			retryProbes,
			retryFailures,
			...totals,
			frames,
			reconnects,
			streamErrors,
			pausedReader: paused ? { attached: true, peerClosedBeforeCleanup: paused.peerClosed() } : { attached: false },
			cpuMs: { user: usage.user / 1000, system: usage.system / 1000 },
			rssBytes: distribution(resources.map((entry) => entry.rss)),
			heapUsedBytes: distribution(resources.map((entry) => entry.heapUsed)),
			resources,
			eventLoopMs: {
				p50: loop.percentile(50) / 1e6,
				p95: loop.percentile(95) / 1e6,
				p99: loop.percentile(99) / 1e6,
				max: loop.max / 1e6,
			},
			processes: { hostAndClient: 1, externalChildren: 0 },
		};
	} finally {
		clearInterval(sampler);
		loop.disable();
		paused?.close();
		await Promise.all(viewers.map((viewer) => viewer.close()));
		await host.close();
	}
}

async function observe(url: string, onFrame: (snapshot: AgentSnapshot) => void, errors: string[]) {
	const controller = new AbortController();
	const initial = Promise.withResolvers<void>();
	const timer = setTimeout(() => controller.abort(new Error("SSE attach timeout")), 10_000);
	const work = (async () => {
		try {
			const response = await fetch(url, {
				headers: { Authorization: `Bearer ${loadToken}` },
				signal: controller.signal,
			});
			if (response.status !== 200) throw new Error(`SSE response ${response.status}`);
			async function* chunks() {
				const reader = response.body!.getReader();
				try {
					while (true) {
						const chunk = await reader.read();
						if (chunk.done) return;
						yield chunk.value;
					}
				} finally {
					reader.releaseLock();
				}
			}
			for await (const frame of sseData(chunks())) {
				// Same-host transport contract, also exercised in HTTP/stream tests.
				const value = JSON.parse(frame) as { agent: AgentSnapshot };
				onFrame(value.agent);
				clearTimeout(timer);
				initial.resolve();
			}
			if (!controller.signal.aborted) throw new Error("Unexpected SSE EOF");
		} catch (error) {
			initial.reject(error);
			if (!controller.signal.aborted) errors.push(String(error));
		} finally {
			clearTimeout(timer);
		}
	})();
	try {
		await initial.promise;
	} catch (error) {
		controller.abort();
		await work;
		throw error;
	}
	return {
		async close() {
			controller.abort();
			await work;
		},
	};
}

async function pauseReader(url: string) {
	let peerClosed = false;
	const request = get(url, { headers: { Authorization: `Bearer ${loadToken}` } });
	await new Promise<void>((resolve, reject) => {
		request.once("error", reject);
		request.once("response", (response) => {
			if (response.statusCode !== 200) {
				response.destroy();
				reject(new Error("Paused SSE attach failed"));
				return;
			}
			response.pause();
			response.on("error", () => {
				peerClosed = true;
			});
			response.on("close", () => {
				peerClosed = true;
			});
			resolve();
		});
	});
	return { peerClosed: () => peerClosed, close: () => request.destroy() };
}
