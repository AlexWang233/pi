// A bounded observation feed, rebuilt from current receipts and committed tool evidence on reconnect.

type Receipt = { actorId: string; id: string; status: string };
type ActivityItem = { key: string; text: string; status: string };

/** Project literal labels without inventing missed transitions or attributing tools to a particular user. */
export function activityItems(agentId: string, commands: readonly Receipt[], tools: unknown): ActivityItem[] {
	// SSE boundary: tool records are untyped JSON received from the server.
	if (!Array.isArray(tools)) throw new Error("Invalid tool activity");
	const events = commands.map((command) => ({
		key: JSON.stringify(["request", command.actorId, command.id, command.status]),
		text: `${command.actorId} → ${agentId} · request ${command.id.slice(0, 8)} · observed ${command.status}`,
		status: command.status,
	}));
	const toolEvents = tools.map((item: unknown): ActivityItem => {
		if (
			item === null ||
			typeof item !== "object" ||
			!("id" in item) ||
			typeof item.id !== "string" ||
			!("name" in item) ||
			typeof item.name !== "string" ||
			!("status" in item) ||
			(item.status !== "requested" && item.status !== "completed" && item.status !== "failed")
		)
			throw new Error("Invalid tool activity record");
		return {
			key: JSON.stringify(["tool", item.id]),
			text: `${agentId} · ${item.name} tool · ${item.status}`,
			status: item.status,
		};
	});
	return [...events, ...toolEvents];
}

/** Retain up to 64 distinct observed updates; this is not an exhaustive server event log. */
export function createActivityFeed(agentId: string) {
	const root = document.createElement("ol");
	root.className = "activity-timeline";
	root.setAttribute("aria-label", `${agentId} observed request and tool activity`);
	const events = new Map<string, ActivityItem>();
	return {
		root,
		update(commands: readonly Receipt[], tools: unknown): void {
			for (const event of activityItems(agentId, commands, tools)) events.set(event.key, event);
			while (events.size > 64) events.delete(events.keys().next().value!);
			root.replaceChildren(
				...[...events.values()].map((event) => {
					const row = document.createElement("li");
					row.dataset.status = event.status;
					row.textContent = event.text;
					return row;
				}),
			);
		},
	};
}
