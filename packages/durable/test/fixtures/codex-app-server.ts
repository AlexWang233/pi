// Scripted JSONL app-server for actual Codex driver subprocess tests; no model or credentials are used.
import { appendFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import transcript from "./collaboration-codex.json" with { type: "json" };

const [mode, log] = process.argv.slice(2);
// Fixture argv and JSONL stdin are process boundaries, independent of typed adapter calls.
if (!mode || !log) throw new Error("Expected scenario and disposable log path");
await appendFile(log, `${process.pid}\n`);
const threadId = "01a0d5eb-f0c0-7481-a417-5e8871805cbc";
const turn = {
	id: "root-turn",
	items: [],
	itemsView: "notLoaded",
	status: "inProgress",
	error: null,
	startedAt: null,
	completedAt: null,
	durationMs: null,
};
const emit = (frame: object) => process.stdout.write(`${JSON.stringify(frame)}\n`);
const completed = () => {
	emit({
		method: "item/completed",
		params: {
			threadId,
			turnId: turn.id,
			completedAtMs: 1,
			item: {
				type: "agentMessage",
				id: "answer",
				text: "expected answer",
				phase: "final_answer",
				memoryCitation: null,
				delivery: null,
				questions: null,
			},
		},
	});
	emit({ method: "turn/completed", params: { threadId, turn: { ...turn, status: "completed" } } });
};
const input = createInterface({ input: process.stdin });
for await (const line of input) {
	const frame: unknown = JSON.parse(line);
	if (frame === null || typeof frame !== "object" || !("id" in frame || "method" in frame))
		throw new Error("Invalid client frame");
	if (!("method" in frame)) continue;
	if (typeof frame.method !== "string") throw new Error("Invalid client method");
	await appendFile(log, `${frame.method}\n`);
	if (frame.method === "initialized") continue;
	if (!("id" in frame)) throw new Error("Request ID required");
	switch (frame.method) {
		case "initialize":
			if (mode === "startup-exit") {
				process.stderr.write("fatal: scripted initialization failure\n");
				process.exit(17);
			}
			emit({
				id: frame.id,
				result: transcript.entries.find((entry) => entry.type === "emit_inbound" && entry.label === "initialize")!
					.frame.result,
			});
			break;
		case "thread/start":
		case "thread/resume":
			emit({
				id: frame.id,
				result: transcript.entries.find((entry) => entry.type === "emit_inbound" && entry.label === "thread/start")!
					.frame.result,
			});
			break;
		case "turn/start": {
			if (mode === "mismatched-start") {
				emit({ method: "turn/started", params: { threadId, turn: { ...turn, id: "unexpected-turn" } } });
				emit({ id: frame.id, result: { turn } });
				break;
			}
			if (mode !== "early-completion") emit({ id: frame.id, result: { turn } });
			emit({ method: "turn/started", params: { threadId, turn } });
			if (mode === "failed-turn") {
				emit({
					method: "turn/completed",
					params: { threadId, turn: { ...turn, status: "failed", error: { message: "scripted turn failure" } } },
				});
				break;
			}
			if (mode === "exit") {
				process.stderr.write("fatal: scripted provider disappeared\n");
				process.exit(23);
			}
			if (mode === "malformed") {
				process.stdout.write("{broken JSON\n");
				break;
			}
			if (["file-approval", "command-approval", "user-input", "unknown-request"].includes(mode)) {
				const method =
					mode === "file-approval"
						? "item/fileChange/requestApproval"
						: mode === "command-approval"
							? "item/commandExecution/requestApproval"
							: mode === "user-input"
								? "item/tool/requestUserInput"
								: "future/interactiveAction";
				emit({
					id: 1000,
					method,
					params: {
						threadId,
						turnId: turn.id,
						itemId: "interaction",
						startedAtMs: 1,
						isBlocking: true,
						questions: [],
					},
				});
				break;
			}
			emit({
				method: "item/agentMessage/delta",
				params: { threadId, turnId: turn.id, itemId: "answer", delta: "ready" },
			});
			if (mode === "interrupt" || mode === "interrupt-no-ack") break;
			if (mode === "item-only") {
				emit({
					method: "item/completed",
					params: {
						threadId,
						turnId: turn.id,
						completedAtMs: 1,
						item: {
							type: "agentMessage",
							id: "answer",
							text: "tool-level answer",
							phase: "final_answer",
							memoryCitation: null,
							delivery: null,
							questions: null,
						},
					},
				});
				emit({
					method: "item/agentMessage/delta",
					params: { threadId, turnId: turn.id, itemId: "answer", delta: "item-only-ready" },
				});
				break;
			}
			if (mode === "foreign-turn") {
				const other = { ...turn, id: "unrelated-turn" };
				emit({ method: "turn/started", params: { threadId, turn: other } });
				emit({
					method: "item/completed",
					params: {
						threadId,
						turnId: other.id,
						completedAtMs: 1,
						item: {
							type: "agentMessage",
							id: "other-answer",
							text: "wrong answer",
							phase: "final_answer",
							memoryCitation: null,
							delivery: null,
							questions: null,
						},
					},
				});
				emit({ method: "turn/completed", params: { threadId, turn: { ...other, status: "completed" } } });
			}
			completed();
			if (mode === "early-completion") emit({ id: frame.id, result: { turn } });
			break;
		}
		case "turn/interrupt":
			if (mode === "interrupt-no-ack") break;
			await appendFile(log, "interrupt-ack\n");
			emit({ id: frame.id, result: {} });
			break;
		default:
			throw new Error(`Unexpected client method: ${frame.method}`);
	}
}
