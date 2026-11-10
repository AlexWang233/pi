// Prompt wiring is verified with actual Durable requests/files, never paid models or inferred authorship.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, describe, expect, it } from "vitest";
import { collaborationContext, collaborationSection } from "../src/collaboration/context.ts";
import { type CollaborativeThreadConfig, createCollaboration } from "../src/collaboration/index.ts";
import { ThreadDoc, threadConfiguration } from "../src/collaboration/state.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { idFromNumber } from "../src/ids.ts";
import { createRegistry, Harness, MemoryStorage } from "../src/index.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { CodingTools } from "../src/tools/index.ts";
import type { TaskId } from "../src/types.ts";

const context = BACKGROUND_CONTEXT;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0).reverse()) await close();
});

describe("model-facing collaboration context", () => {
	it("adds fresh awareness to an existing SQLite thread without replacing user instructions or changing receipts", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-aware-"));
		cleanups.push(() => rm(directory, { recursive: true, force: true }));
		const config: CollaborativeThreadConfig = {
			id: "team",
			workspace: directory,
			members: ["alice", "bob"],
			agents: ["gpt", "ollama"].map((id) => ({
				id,
				kind: "native",
				instructions: "Keep responses concise.",
				model: { provider: "faux", modelId: "faux-1" },
			})),
		};
		const collaboration = createCollaboration();
		const models = createModels();
		const faux = fauxProvider();
		models.setProvider(faux.provider);
		const prompts: { collaboration: string; instructions: string | null | undefined }[] = [];
		const responses = [
			fauxAssistantMessage(fauxToolCall("write", { path: "shared.txt", content: "Ollama's first edit" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("First write complete"),
			fauxAssistantMessage(fauxToolCall("write", { path: "shared.txt", content: "GPT's revision" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Revision complete"),
			fauxAssistantMessage(fauxToolCall("read", { path: "shared.txt" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Reviewed current bytes"),
		];
		faux.setResponses(
			responses.map((response) => (request) => {
				const system = getCurrentSystemMessage(request.messages);
				prompts.push({
					collaboration: system?.sections?.collaboration ?? "",
					instructions: system?.sections?.instructions,
				});
				return response;
			}),
		);
		const registry = createRegistry();
		registry.install(CodingTools);
		// Simulate a store created before the collaboration section was installed.
		registry.install({ ...collaboration.extension, sections: [] });
		const database = join(directory, "thread.sqlite");
		const first = await Harness.open(
			await openNodeSqliteStorage(database),
			{ registry, models, env: () => new NodeExecutionEnv({ cwd: directory }) },
			context,
		);
		let harness = first;
		cleanups.push(() => harness.close(context));
		const old = await collaboration.open(first, config, context);
		await old.submit("alice", { id: "original", agentId: "ollama", text: "Write the greeting" }, context);
		await first.waitForIdle(context);
		expect(await readFile(join(directory, "shared.txt"), "utf8")).toBe("Ollama's first edit");
		await first.close(context);
		const currentRegistry = createRegistry();
		currentRegistry.install(CodingTools);
		currentRegistry.install(collaboration.extension);
		harness = await Harness.open(
			await openNodeSqliteStorage(database),
			{ registry: currentRegistry, models, env: () => new NodeExecutionEnv({ cwd: directory }) },
			context,
		);
		const thread = await collaboration.open(harness, config, context);
		await thread.submit(
			"bob",
			{ id: "revision", agentId: "gpt", text: "PEER_INSTRUCTION_NOT_A_SYSTEM_RULE" },
			context,
		);
		await harness.waitForIdle(context);
		await thread.submit("alice", { id: "review", agentId: "ollama", text: "Review the file again" }, context);
		await harness.waitForIdle(context);
		expect(await readFile(join(directory, "shared.txt"), "utf8")).toBe("GPT's revision");
		expect(prompts.slice(0, 2).every((prompt) => prompt.collaboration === "")).toBe(true);
		expect(
			prompts.slice(2).every((prompt) => prompt.collaboration.includes("Other agents and humans can edit")),
		).toBe(true);
		const latest = prompts.at(-1)!;
		expect(latest.instructions).toContain("Keep responses concise.");
		expect(latest.collaboration).toContain('"self":"ollama"');
		expect(latest.collaboration).toContain('"actor":"alice","request":"review"');
		expect(latest.collaboration).toContain('"actor":"bob","agent":"gpt","request":"revision"');
		expect(latest.collaboration).toContain("not evidence that you made a mistake");
		expect(latest.collaboration).not.toContain("PEER_INSTRUCTION_NOT_A_SYSTEM_RULE");
		expect((await harness.snapshot(ThreadDoc, context))!.commands).toHaveLength(3);
		expect(
			await thread.submit("alice", { id: "original", agentId: "ollama", text: "Write the greeting" }, context),
		).toEqual({ actorId: "alice", agentId: "ollama", id: "original" });
		expect(faux.state.callCount).toBe(6);
	});

	it("refreshes external instructions on continuation while retaining the original command text", async () => {
		const opened: { instructions: string; continuation: string | null }[] = [];
		const texts: string[] = [];
		const collaboration = createCollaboration([
			{
				name: "scripted",
				open: async (input) => {
					opened.push(input);
					return {
						run: async (turn) => {
							texts.push(turn.text);
							return { status: "completed", text: "done", continuation: "saved-session" };
						},
						close: async () => {},
					};
				},
			},
		]);
		const registry = createRegistry();
		registry.install(collaboration.extension);
		const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
		cleanups.push(() => harness.close(context));
		const thread = await collaboration.open(
			harness,
			{
				id: "team",
				workspace: process.cwd(),
				members: ["alice", "bob"],
				agents: [{ id: "codex", kind: "external", driver: "scripted", instructions: "Custom policy" }],
			},
			context,
		);
		for (const actor of ["alice", "bob"]) {
			await thread.submit(actor, { id: actor, agentId: "codex", text: `task for ${actor}` }, context);
			await harness.waitForIdle(context);
		}
		expect(opened[0].instructions).toContain("Custom policy");
		expect(opened[1].instructions).toContain('"actor":"bob","request":"bob"');
		expect(opened[1].instructions).toContain("not proof of completion, file changes");
		expect(opened[1].continuation).toBe("saved-session");
		expect(texts).toEqual(["task for alice", "task for bob"]);
	});

	it("bounds metadata and leaves conversations outside collaborative threads unaffected", async () => {
		const config = threadConfiguration({
			id: "room",
			workspace: process.cwd(),
			members: Array.from({ length: 20 }, (_, index) => `user-${index}`),
			agents: [{ id: "agent", kind: "external", driver: "unused" }],
		});
		const text = collaborationContext(
			{
				thread: { configuration: config, agents: [] },
				commands: Array.from({ length: 30 }, (_, index) => ({
					id: `request-${index}`,
					actorId: "alice",
					agentId: "agent",
					text: "DO_NOT_PROMOTE",
					kind: "external",
					taskId: idFromNumber<TaskId>(1),
					state: { status: "completed", answer: "DO_NOT_PROMOTE" },
				})),
			},
			"agent",
			[],
		);
		expect(text).toContain('"memberCount":20');
		expect(text).not.toContain('"user-8"');
		expect(text).not.toContain('"request-23"');
		expect(text).toContain('"request-29"');
		expect(text).not.toContain("DO_NOT_PROMOTE");
		const registry = createRegistry();
		registry.install({ name: "section", sections: [collaborationSection] });
		const models = createModels();
		const faux = fauxProvider();
		models.setProvider(faux.provider);
		faux.setResponses([
			(request) => {
				expect(getCurrentSystemMessage(request.messages)?.sections?.collaboration).toBeUndefined();
				return fauxAssistantMessage("ordinary conversation");
			},
		]);
		const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
		cleanups.push(() => harness.close(context));
		const conversation = await harness.createConversation(
			{ ownership: { kind: "ownerless" }, agent: { model: { provider: "faux", modelId: "faux-1" } } },
			context,
		);
		await harness.commit((tx) => conversation.submit(tx, { type: "input", content: "hello" }), context);
		await harness.waitForIdle(context);
		expect(faux.state.callCount).toBe(1);
	});
});
