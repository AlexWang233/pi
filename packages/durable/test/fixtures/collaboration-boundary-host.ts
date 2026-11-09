// Disposable owner: withhold admission persistence/receipt or stop inside a native model/tool call.
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Harness } from "../../src/index.ts";
import { openNodeSqliteStorage } from "../../src/storage/sqlite/node.ts";
import { type Boundary, boundaryRuntime } from "./collaboration-boundary-support.ts";

const [workspace, requested, agentId] = process.argv.slice(2);
// Process argv/IPC boundary: only the parent test supplies a disposable store and a valid barrier.
if (
	!workspace ||
	!["before-admission", "after-admission", "native-request", "native-tool"].includes(requested ?? "") ||
	!["native", "external"].includes(agentId ?? "") ||
	!process.send
) {
	throw new Error("Expected disposable workspace, boundary, agent and IPC");
}
const boundary = requested as Boundary;
const context = BACKGROUND_CONTEXT;
const hold = async (at: Boundary) => {
	if (boundary !== at) return;
	process.send!({ type: "ready", boundary, agentId });
	await new Promise<void>(() => {});
};
const runtime = boundaryRuntime(workspace, hold);
if (boundary === "native-tool") runtime.faux.setResponses([runtime.toolCall]);
const storage = await openNodeSqliteStorage(join(workspace, "thread.sqlite"));
const harness = await Harness.open(storage, runtime, context);
const thread = await runtime.collaboration.open(harness, runtime.config, context);
const commit = storage.commit.bind(storage);
storage.commit = async (batches, receive, ctx) => {
	const admission = batches.some((writes) =>
		writes.some(
			(write) =>
				(write.type === "submission" && write.value.status === "queued") ||
				(write.type === "entry" && write.value.kind === "collab.input"),
		),
	);
	if (admission && (boundary === "before-admission" || boundary === "after-admission")) {
		if (boundary === "before-admission") await hold(boundary);
		// SQLite committed, but the owning Session/caller never receives its durability acknowledgement.
		const result = await commit(batches, () => {}, ctx);
		await hold(boundary);
		return result;
	}
	return commit(batches, receive, ctx);
};
await thread.submit("alice", { id: "first", agentId, text: "work" }, context);
