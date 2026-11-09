// Bounded collaboration projections over existing conversation and document watches.
import type { Context } from "@earendil-works/chord/context";
import { NativeWatch } from "@earendil-works/chord/watch";
import type { LiveState } from "../harness/live.ts";
import type { Conversation, ConversationWatch, Harness } from "../harness/types.ts";
import type { ConversationView } from "../harness/view.ts";
import { type StoredCommand, ThreadDoc, type ThreadState } from "./state.ts";
import type { AgentSnapshot, AgentWatch, CommandStatus } from "./types.ts";

/** Follow one lane using package-owned state; slow listeners are folded by the watch. */
export async function watchAgent(
	harness: Harness,
	conversation: Conversation,
	agentId: string,
	readCommand: (command: StoredCommand) => Promise<CommandStatus>,
	context: Context,
): Promise<AgentWatch> {
	const metadata = (await harness.watchDoc(ThreadDoc, context))!;
	let conversationWatch: ConversationWatch;
	try {
		conversationWatch = await conversation.watch(context, { min: 20, max: 40 });
	} catch (error) {
		await metadata.stop();
		throw error;
	}
	let state = metadata.value;
	let view = conversationWatch.value;
	let revision = 0;
	const project = async () => {
		const commands = await Promise.all(
			state.commands
				.filter((item) => item.agentId === agentId)
				.slice(-8)
				.map(readCommand),
		);
		const active = state.commands.findLast(
			(item) => item.agentId === agentId && item.kind === "external" && item.state.status === "running",
		);
		// The running command may precede the eight visible receipts when many follow-ups are queued.
		const activeStatus =
			active === undefined
				? undefined
				: (commands.find((command) => command.id === active.id && command.actorId === active.actorId) ??
					(await readCommand(active)));
		const progress =
			active?.kind === "external" && active.state.status === "running" && activeStatus?.status === "running"
				? active.state.progress
				: "";
		return projectAgent(state, view, agentId, commands, progress);
	};
	const stopSources = () => {
		void Promise.all([metadata.stop(), conversationWatch.stop()]);
	};
	let initial: AgentSnapshot;
	try {
		initial = await project();
	} catch (error) {
		stopSources();
		throw error;
	}
	const watch = new NativeWatch(initial, stopSources, () => {});
	const refresh = async () => {
		const current = ++revision;
		const next = await project();
		if (current === revision) watch.advance(next, context);
	};
	metadata.start(async (call) => {
		if (call.kind !== "value") return;
		state = call.value;
		await refresh();
	});
	conversationWatch.start(async (call) => {
		if (call.kind !== "value") return;
		view = call.value;
		await refresh();
	});
	void metadata.closed.then((end) => {
		watch.end(end);
		stopSources();
	});
	void conversationWatch.closed.then((end) => {
		watch.end(end);
		stopSources();
	});
	return {
		get value() {
			return watch.value;
		},
		start: (listener) =>
			watch.start(async (call) => {
				if (call.kind === "value") await listener(call.value);
			}),
		stop: async () => {
			await watch.stop();
			await Promise.all([metadata.stop(), conversationWatch.stop()]);
		},
		closed: watch.closed.then(() => {}),
	};
}

function projectAgent(
	state: Readonly<ThreadState>,
	view: ConversationView,
	agentId: string,
	commands: CommandStatus[],
	externalProgress: string,
): AgentSnapshot {
	const agent = state.thread!.configuration.agents.find((item) => item.id === agentId)!;
	// pi.live is a runtime-owned document whose kind fixes its schema.
	const live = view.docs["pi.live"] as LiveState | undefined;
	const nativeProgress =
		live?.generation?.message?.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("") ?? "";
	const messages: AgentSnapshot["messages"] = [];
	for (const entry of view.entries.slice(-20)) {
		if (entry.kind === "collab.input") {
			// Collaboration owns collab.input and writes exactly this metadata for both execution kinds.
			const data = entry.data as { actorId: string; text: string };
			messages.push({ id: String(entry.id), role: "user", author: data.actorId, text: data.text.slice(0, 8192) });
		} else if (entry.kind === "collab.answer") {
			const data = entry.data as { text: string };
			messages.push({ id: String(entry.id), role: "assistant", author: agentId, text: data.text.slice(0, 8192) });
		} else {
			for (const message of entry.model ?? []) {
				if (message.role !== "assistant") continue;
				const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
				if (text)
					messages.push({ id: String(entry.id), role: "assistant", author: agentId, text: text.slice(0, 8192) });
			}
		}
	}
	return {
		agentId,
		kind: agent.kind,
		busy: live?.run !== undefined || commands.some((item) => item.status === "queued" || item.status === "running"),
		progress: (agent.kind === "native" ? nativeProgress : externalProgress).slice(-8192),
		commands: commands.map((item) =>
			item.status === "completed" ? { ...item, answer: item.answer.slice(0, 8192) } : item,
		),
		messages,
	};
}
