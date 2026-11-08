// Node-only Codex driver; generic Durable imports do not load Effect or spawn processes.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Scope from "effect/Scope";
import type { ExternalAgentDriver } from "../../collaboration/types.ts";
import { codexSession } from "./session.ts";
import { makeChildStdio, makeStderrTail, makeTerminationError } from "./vendor/_internal/stdio.ts";
import { make } from "./vendor/client.ts";

/** Run an external Codex app-server using the T3 client; no credentials are copied. */
export function createCodexDriver(options: { command?: string; args?: string[] } = {}): ExternalAgentDriver {
	return {
		name: "codex",
		open: async (input) => {
			const runtime = ManagedRuntime.make(NodeServices.layer);
			const scope = await Effect.runPromise(Scope.make());
			const close = async () => {
				try {
					await Effect.runPromise(Scope.close(scope, Exit.void));
				} finally {
					await runtime.dispose();
				}
			};
			try {
				const client = await runtime.runPromise(
					Effect.gen(function* () {
						const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
						const process = yield* spawner.spawn(
							ChildProcess.make(options.command ?? "codex", options.args ?? ["app-server"], {
								cwd: input.workspace,
							}),
						);
						const stderr = yield* makeStderrTail(process.stderr);
						return yield* make(
							makeChildStdio(process, stderr.awaitDrained),
							{},
							makeTerminationError(process, stderr.read),
						);
					}).pipe(Scope.provide(scope)),
					{ signal: input.signal },
				);
				return await codexSession(client, input, close);
			} catch (error) {
				await close();
				throw error;
			}
		},
	};
}
