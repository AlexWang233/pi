// Activity labels expose observed evidence without manufacturing a complete transition history.
import { describe, expect, it } from "vitest";
import { activityItems } from "../web/activity.ts";
import { parseConflictView } from "../web/conflict.ts";

describe("browser activity projections", () => {
	it("attributes requests, keeps tool results agent-scoped and does not invent missed states", () => {
		const items = activityItems(
			"agent-a",
			[{ actorId: "alice", id: "request-1", status: "completed" }],
			[
				{ id: "entry:1", name: "write", status: "requested" },
				{ id: "entry:2", name: "write", status: "failed" },
			],
		);
		expect(items.map((item) => item.text)).toEqual([
			"alice → agent-a · request request- · observed completed",
			"agent-a · write tool · requested",
			"agent-a · write tool · failed",
		]);
		expect(items.some((item) => item.status === "running")).toBe(false);
		expect(new Set(items.map((item) => item.key)).size).toBe(3);
	});
	it("rejects malformed tool and conflict responses at the browser boundary", () => {
		for (const tools of [null, [null], [{ id: "1", name: "write", status: "unknown" }]])
			expect(() => activityItems("agent", [], tools)).toThrow("Invalid tool");
		expect(() =>
			parseConflictView({ file: "shared.txt", current: "", participants: [], proposals: [{ status: "unknown" }] }),
		).toThrow();
	});
});
