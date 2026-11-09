// Run from apps/collab-demo: node --conditions=source --experimental-strip-types load/run.ts [soak-seconds] [report.json]
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runScenario, type Scenario } from "./scenario.ts";

const seconds = Number(process.argv[2] ?? 600);
// CLI boundary: keep load duration and lifetime receipt use bounded.
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) throw new Error("Soak seconds must be 1..600");
const reportPath = resolve(process.argv[3] ?? "../../.artifacts/collab-load.json");
const root = await mkdtemp(join(tmpdir(), "pi-collab-load-"));
const scenarios: Scenario[] = [
	{
		name: "baseline",
		threads: 1,
		rounds: 10,
		intervalMs: 200,
		burst: 1,
		serviceMs: 40,
		outputChars: 4096,
		reconnectEvery: 5,
		pausedReader: false,
	},
	{
		name: "saturation",
		threads: 5,
		rounds: 1,
		intervalMs: 0,
		burst: 60,
		serviceMs: 100,
		outputChars: 4096,
		reconnectEvery: 0,
		pausedReader: true,
	},
	{
		name: "soak",
		threads: 5,
		rounds: Math.ceil(seconds / 5),
		intervalMs: 5000,
		burst: 1,
		serviceMs: 40,
		outputChars: 4096,
		reconnectEvery: 10,
		pausedReader: true,
	},
];
const report = {
	date: new Date().toISOString(),
	revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	workingTree: "Includes uncommitted load increment; see accompanying diff",
	node: process.version,
	machine: {
		platform: platform(),
		release: release(),
		cpu: cpus()[0]?.model,
		logicalCpus: cpus().length,
		ramBytes: totalmem(),
	},
	workload:
		"SQLite per thread; one faux native response / one simulated external run per command; no tools, Codex process or paid APIs",
	limits: {
		maxCommandsPerThread: 256,
		maxPendingPerLane: 8,
		outputChars: 4096,
		clientSubmitConcurrency: 16,
		automaticCompaction: false,
	},
	limitations: [
		"Client and server share one process; CPU/RSS/event-loop measurements include both.",
		"No isolated commit latency, provider quota, real child-process load or recovery-time measurement.",
		"Submit-to-driver-start includes HTTP/admission. Terminal observation mixes first SSE observation with later status polling.",
		"SSE is coalesced with eight recent receipts; coverage is reported, not assumed. No durable stream replay cursor.",
		"Paused reader attachment does not prove server/kernel buffer limits were reached or whole-process memory is bounded.",
	],
	results: [] as Awaited<ReturnType<typeof runScenario>>[],
};
try {
	for (const scenario of scenarios) {
		console.log(`Starting ${scenario.name}: ${scenario.threads} threads, ${scenario.rounds} rounds`);
		const result = await runScenario(join(root, scenario.name), scenario);
		report.results.push(result);
		await mkdir(dirname(reportPath), { recursive: true });
		await writeFile(reportPath, JSON.stringify(report, null, 2));
		console.log(
			`${scenario.name}: ${result.accepted} accepted, ${result.completed} completed, ${result.httpStatuses[429] ?? 0} rejected`,
		);
		if (
			result.retryFailures ||
			result.unsettled.length ||
			result.missingStarts.length ||
			result.unexpectedStarts.length ||
			result.duplicateStarts.length ||
			result.otherTerminal ||
			result.streamErrors.length
		) {
			throw new Error(`Accounting/failure check failed; inspect ${reportPath}`);
		}
	}
	console.log(`Report: ${reportPath}`);
} finally {
	// Only the exact directory returned by mkdtemp is removed after its owned server/stores close.
	await rm(root, { recursive: true, force: true });
}
