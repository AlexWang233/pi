// Promise-based external session using T3's typed Codex app-server client.
import * as Effect from "effect/Effect";
import type { ExternalAgentDriver, ExternalSession, ExternalTurnResult } from "../../collaboration/types.ts";
import type { CodexAppServerClient } from "./vendor/client.ts";
import { CodexAppServerRequestError } from "./vendor/errors.ts";

type Client = CodexAppServerClient["Service"];
type OpenInput = Parameters<ExternalAgentDriver["open"]>[0];

/** Initialize an adapter-owned client; close is always the caller's resource finalizer. */
export async function codexSession(
	client: Client,
	input: OpenInput,
	close: () => Promise<void>,
): Promise<ExternalSession> {
	const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect, { signal: input.signal });
	await run(client.request("initialize", { clientInfo: { name: "pi-durable", version: "1.5.0" } }));
	await run(client.notify("initialized", undefined));
	const options = {
		cwd: input.workspace,
		model: input.model,
		developerInstructions: input.instructions,
		sandbox: "workspace-write" as const,
		approvalPolicy: "never" as const,
	};
	const thread =
		input.continuation === null
			? await run(client.request("thread/start", options))
			: await run(client.request("thread/resume", { ...options, threadId: input.continuation }));
	const threadId = thread.thread.id;
	return {
		close,
		run: async (turn) => {
			const terminal = Promise.withResolvers<ExternalTurnResult>();
			// A terminal/abort notification may arrive before the turn/start response is awaited.
			void terminal.promise.catch(() => {});
			let turnId: string | null = null;
			let interrupt: Promise<void> | undefined;
			let text = "";
			let finalText = "";
			await run(
				client.handleServerNotification("turn/started", (event) =>
					Effect.sync(() => {
						if (event.threadId === threadId && turnId === null) turnId = event.turn.id;
					}),
				),
			);
			await run(
				client.handleServerNotification("item/agentMessage/delta", (event) => {
					if (event.threadId !== threadId || event.turnId !== turnId) return Effect.void;
					text = (text + event.delta).slice(-65_536);
					return Effect.tryPromise({
						try: () => turn.progress(text),
						catch: () => CodexAppServerRequestError.internalError("Progress publication failed"),
					});
				}),
			);
			await run(
				client.handleServerNotification("item/completed", (event) =>
					Effect.sync(() => {
						if (event.threadId === threadId && event.turnId === turnId && event.item.type === "agentMessage") {
							finalText = event.item.text.slice(0, 65_536);
						}
					}),
				),
			);
			await run(
				client.handleServerNotification("turn/completed", (event) =>
					Effect.sync(() => {
						if (event.threadId !== threadId || event.turn.id !== turnId) return;
						terminal.resolve(
							event.turn.status === "completed"
								? { status: "completed", text: finalText || text, continuation: threadId }
								: { status: "failed", reason: event.turn.error?.message ?? `Codex turn ${event.turn.status}` },
						);
					}),
				),
			);
			await run(
				client.handleUnknownServerRequest((method) => {
					terminal.resolve({ status: "failed", reason: `Unsupported Codex interaction: ${method}` });
					return Effect.fail(CodexAppServerRequestError.methodNotFound(method));
				}),
			);
			// Register all known interactive methods too; known requests do not reach the unknown handler.
			await run(
				client.handleServerRequest("item/tool/requestUserInput", () => {
					terminal.resolve({ status: "failed", reason: "Codex requested interactive user input" });
					return Effect.fail(CodexAppServerRequestError.internalError("Interactive input is unsupported"));
				}),
			);
			for (const method of ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"] as const) {
				await run(
					client.handleServerRequest(method, () => {
						terminal.resolve({ status: "failed", reason: `Unsupported Codex approval: ${method}` });
						return Effect.fail(CodexAppServerRequestError.internalError("Interactive approval is unsupported"));
					}),
				);
			}
			const aborted = () => {
				terminal.reject(turn.signal.reason);
				if (turnId !== null && interrupt === undefined) {
					interrupt = Effect.runPromise(
						client
							.request("turn/interrupt", { threadId, turnId })
							.pipe(Effect.timeout("1 second"), Effect.ignore),
					).then(
						() => {},
						() => {},
					);
				}
			};
			turn.signal.addEventListener("abort", aborted, { once: true });
			const observation = new AbortController();
			const terminated = Effect.runPromise(client.awaitTermination, {
				signal: AbortSignal.any([turn.signal, observation.signal]),
			}).catch((error: unknown) => terminal.reject(error));
			try {
				turn.signal.throwIfAborted();
				const started = await run(
					client.request("turn/start", { threadId, input: [{ type: "text", text: turn.text }] }),
				);
				if (turnId !== null && turnId !== started.turn.id) {
					throw new Error("Codex turn/start response does not match the initial turn notification");
				}
				turnId = started.turn.id;
				return await terminal.promise;
			} finally {
				turn.signal.removeEventListener("abort", aborted);
				observation.abort();
				await terminated;
				// Let the bounded interrupt exchange finish before the caller closes the process scope.
				await interrupt;
			}
		},
	};
}
