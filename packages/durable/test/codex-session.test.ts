// T3-backed replay verifies the same client and bridge used by the live Codex driver.

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { describe, expect, it } from "vitest";
import { codexSession } from "../src/adapters/codex/session.ts";
import { CodexAppServerClient } from "../src/adapters/codex/vendor/client.ts";
import {
	CodexAppServerReplayTranscript,
	layerReplayWithDriver,
	makeReplayDriver,
} from "../src/adapters/codex/vendor/replay.ts";
import { createCollaboration } from "../src/collaboration/index.ts";
import { createRegistry, Harness, MemoryStorage } from "../src/index.ts";
import transcriptJson from "./fixtures/collaboration-codex.json" with { type: "json" };

async function replayFixture() {
	// Recording input is a wire boundary; validate it with the upstream transcript schema.
	const transcript = Schema.decodeUnknownSync(CodexAppServerReplayTranscript)(transcriptJson);
	const scope = await Effect.runPromise(Scope.make());
	const driver = await Effect.runPromise(makeReplayDriver(transcript));
	const services = await Effect.runPromise(Layer.buildWithScope(layerReplayWithDriver(driver), scope));
	return {
		transcript,
		driver,
		client: Context.get(services, CodexAppServerClient),
		close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
	};
}

describe("T3-backed Codex session", () => {
	it("initializes, starts a turn, streams text, and settles only at root completion", async () => {
		const { transcript, driver, client, close } = await replayFixture();
		const controller = new AbortController();
		const progress: string[] = [];
		try {
			const session = await codexSession(
				client,
				{
					workspace: "/workspace",
					agentId: "codex",
					model: null,
					instructions: "",
					continuation: null,
					signal: controller.signal,
				},
				close,
			);
			const result = await session.run({
				text: "hello",
				signal: controller.signal,
				progress: async (text) => {
					progress.push(text);
				},
			});
			expect(result).toMatchObject({ status: "completed" });
			if (result.status === "completed") {
				expect(result.text.length).toBeGreaterThan(0);
				expect(result.continuation).toBeTruthy();
			}
			expect(progress.length).toBeGreaterThan(0);
			expect(await Effect.runPromise(Ref.get(driver.state))).toEqual({
				cursor: transcript.entries.length,
				failure: null,
			});
		} finally {
			await close();
		}
	});

	it("executes a durably admitted command through the actual T3 replay client", async () => {
		const replay = await replayFixture();
		const context = BACKGROUND_CONTEXT;
		const collaboration = createCollaboration([
			{
				name: "codex",
				open: (input) => codexSession(replay.client, input, replay.close),
			},
		]);
		const registry = createRegistry();
		registry.install(collaboration.extension);
		const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry }, context);
		try {
			const thread = await collaboration.open(
				harness,
				{
					id: "replay",
					workspace: "/workspace",
					members: ["alice", "bob"],
					agents: [{ id: "codex", kind: "external", driver: "codex" }],
				},
				context,
			);
			await thread.submit("alice", { id: "c1", agentId: "codex", text: "hello" }, context);
			await harness.waitForIdle(context);
			expect(await thread.command("alice", "codex", "c1", context)).toMatchObject({ status: "completed" });
			expect(
				(await thread.history("bob", "codex", 10, undefined, context)).items.some(
					(item) => item.kind === "collab.answer",
				),
			).toBe(true);
			expect(await Effect.runPromise(Ref.get(replay.driver.state))).toEqual({
				cursor: replay.transcript.entries.length,
				failure: null,
			});
		} finally {
			await harness.close(context);
			await replay.close();
		}
	});
});
