// Load accounting keeps HTTP attempts separate from logical commands and execution starts.
import type { ExecutionSample } from "./host.ts";

export type CommandSample = {
	id: string;
	path: string;
	submitted: number;
	accepted: number;
	terminal?: { status: string; observed: number };
	streamObserved?: number;
};

/** Summarize nonempty measurements with nearest-rank percentiles; empty samples stay explicit. */
export function distribution(values: number[]) {
	const sorted = values.toSorted((a, b) => a - b);
	const rank = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
	return {
		count: sorted.length,
		min: sorted[0] ?? null,
		p50: rank(0.5),
		p95: rank(0.95),
		p99: rank(0.99),
		max: sorted.at(-1) ?? null,
	};
}

/** Report omissions and unexpected starts instead of treating accepted requests as completed work. */
export function account(commands: CommandSample[], executions: ReadonlyMap<string, ExecutionSample>) {
	const accepted = new Set(commands.map((command) => command.id));
	return {
		accepted: commands.length,
		completed: commands.filter((command) => command.terminal?.status === "completed").length,
		otherTerminal: commands.filter((command) => command.terminal && command.terminal.status !== "completed").length,
		unsettled: commands.filter((command) => !command.terminal).map((command) => command.id),
		missingStarts: commands.filter((command) => !executions.has(command.id)).map((command) => command.id),
		unexpectedStarts: [...executions.keys()].filter((id) => !accepted.has(id)),
		duplicateStarts: [...executions].filter(([, sample]) => sample.starts !== 1).map(([id]) => id),
		starts: [...executions.values()].reduce((total, sample) => total + sample.starts, 0),
		streamObserved: commands.filter((command) => command.streamObserved !== undefined).length,
		submitToDriverStartMs: distribution(
			commands.flatMap((command) => {
				const execution = executions.get(command.id);
				return execution ? [execution.started - command.submitted] : [];
			}),
		),
		acceptanceMs: distribution(commands.map((command) => command.accepted - command.submitted)),
		submitToTerminalObservationMs: distribution(
			commands.flatMap((command) => (command.terminal ? [command.terminal.observed - command.submitted] : [])),
		),
		driverReturnToStreamTerminalMs: distribution(
			commands.flatMap((command) => {
				const returned = executions.get(command.id)?.returned;
				return returned !== undefined && command.streamObserved !== undefined
					? [command.streamObserved - returned]
					: [];
			}),
		),
	};
}
