// External turns use Durable tasks; uncertain dispatches are never sent again automatically.
import type { Context } from "@earendil-works/chord/context";
import type { Extension, Harness } from "../harness/types.ts";
import { defineTask } from "../tasks.ts";
import type { TaskRuntime } from "../types.ts";
import { type StoredCommand, ThreadDoc, type ThreadState } from "./state.ts";
import {
	CollaborativeThread,
	type ExternalCommandCheckpoint,
	type ExternalCommandInput,
	type ExternalCommandTask,
} from "./thread.ts";
import type { CollaborativeThreadConfig, ExternalAgentDriver, ExternalTurnResult } from "./types.ts";

type ExternalCommand = Extract<StoredCommand, { kind: "external" }>;
type Runtime = TaskRuntime<ExternalCommandInput, ExternalCommandCheckpoint, null, object>;

/** Create a process-owned runtime; install its extension before opening the Harness. */
export function createCollaboration(drivers: readonly ExternalAgentDriver[] = []) {
	const byName = new Map(drivers.map((driver) => [driver.name, driver]));
	// Registration policy: persisted driver names must have exactly one implementation.
	if (byName.size !== drivers.length) throw new Error("External driver names must be unique");
	const task: ExternalCommandTask = defineTask<ExternalCommandInput, ExternalCommandCheckpoint, null>({
		name: "pi.collaboration.external",
		version: 1,
		initial: () => ({ phase: "wait" }),
		phases: {
			wait: async (record, runtime, context) => {
				const predecessor = record.input.predecessor;
				if (predecessor !== null && (await runtime.getTask(predecessor, context))!.state.status !== "terminal") {
					await runtime.commit(
						() => ({ status: "waiting", checkpoint: { phase: "wait" }, on: [predecessor], policy: "allSettled" }),
						context,
					);
				} else {
					if (predecessor !== null) {
						const state = (await runtime.snapshot(ThreadDoc, context))!;
						const prior = state.commands.find((item) => item.kind === "external" && item.taskId === predecessor);
						if (prior?.kind === "external" && prior.state.status !== "completed") {
							await settle(
								runtime,
								record.input.command,
								{ status: "stopped", reason: "Previous queued command did not complete" },
								context,
							);
							return;
						}
					}
					await runtime.commit(() => ({ status: "running", checkpoint: { phase: "execute" } }), context);
				}
			},
			execute: async (record, runtime, context) => {
				const index = record.input.command;
				if (await runtime.memo<boolean>("dispatched", context)) {
					await settle(
						runtime,
						index,
						{ status: "interrupted", reason: "External dispatch outcome is uncertain; retry explicitly" },
						context,
					);
					return;
				}
				const state = (await runtime.snapshot(ThreadDoc, context))!;
				const command = externalCommand(state, index);
				const config = state.thread!.configuration;
				const agent = config.agents.find((item) => item.id === command.agentId)!;
				// The task is created only for an external execution configuration.
				const execution = agent as Extract<typeof agent, { kind: "external" }>;
				const driver = byName.get(execution.driver);
				if (!driver) {
					await settle(
						runtime,
						index,
						{ status: "failed", reason: `External driver unavailable: ${execution.driver}` },
						context,
					);
					return;
				}
				await runtime.memo("dispatched", true, context);
				await runtime.commit(async (tx) => {
					externalCommand(await tx.doc(ThreadDoc), index).state = { status: "running", progress: "" };
				}, context);
				const signal = AbortSignal.any([runtime.signal, AbortSignal.timeout(config.externalTimeoutMs)]);
				let outcome: ExternalTurnResult;
				try {
					const session = await driver.open({
						workspace: config.workspace,
						agentId: agent.id,
						model: execution.model,
						instructions: agent.instructions,
						continuation: state.thread!.agents.find((item) => item.id === agent.id)!.continuation,
						signal,
					});
					try {
						outcome = await session.run({
							text: command.text,
							signal,
							progress: (text) =>
								runtime.commit(
									async (tx) => {
										externalCommand(await tx.doc(ThreadDoc), index).state = {
											status: "running",
											progress: text.slice(-config.maxOutputChars),
										};
									},
									context,
									{ persistence: { kind: "deferred", withinMs: 1000 } },
								),
						});
					} finally {
						await session.close();
					}
				} catch (error) {
					if (runtime.signal.aborted) throw error;
					outcome = {
						status: "failed",
						reason: signal.aborted ? "External turn deadline exceeded" : String(error).slice(0, 1000),
					};
				}
				if (outcome.status === "completed") {
					await runtime.commit(async (tx) => {
						const next = await tx.doc(ThreadDoc);
						const answer = outcome.text.slice(0, config.maxOutputChars);
						externalCommand(next, index).state = { status: "completed", answer };
						next.thread!.agents.find((item) => item.id === agent.id)!.continuation = outcome.continuation;
						await tx.appendEntry(runtime.conversationId, {
							kind: "collab.answer",
							data: { actorId: command.actorId, commandId: command.id, agentId: command.agentId, text: answer },
						});
						return { status: "terminal", outcome: { status: "completed", result: null } };
					}, context);
				} else {
					await settle(runtime, index, { status: "failed", reason: outcome.reason.slice(0, 1000) }, context);
				}
			},
		},
		abort: async (record, runtime, context) => {
			await settle(runtime, record.input.command, { status: "stopped", reason: "Agent stopped" }, context);
		},
	});
	const extension: Extension = { name: "pi.collaboration", tasks: [task] };
	return {
		extension,
		open: (harness: Harness, config: CollaborativeThreadConfig, context: Context) =>
			CollaborativeThread.open(harness, config, task, context),
	};
}

function externalCommand(state: Readonly<ThreadState>, index: number): ExternalCommand {
	// Admission creates this task only for the external record at this append-only index.
	return state.commands[index] as ExternalCommand;
}

async function settle(
	runtime: Runtime,
	index: number,
	state: Extract<ExternalCommand["state"], { reason: string }>,
	context: Context,
): Promise<void> {
	await runtime.commit(async (tx) => {
		externalCommand(await tx.doc(ThreadDoc), index).state = state;
		await tx.appendEntry(runtime.conversationId, { kind: "collab.outcome", data: state });
		return { status: "terminal", outcome: { status: "completed", result: null } };
	}, context);
}
