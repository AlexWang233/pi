// Minimal shared-lane UI: authenticated fetch, stable retries, and replaceable snapshots.
import { sseData } from "./stream.ts";

const login = document.querySelector<HTMLFormElement>("#login")!;
const tokenInput = document.querySelector<HTMLInputElement>("#token")!;
const status = document.querySelector<HTMLElement>("#status")!;
const lanes = document.querySelector<HTMLElement>("#lanes")!;
let session = new AbortController();

login.addEventListener("submit", (event) => {
	event.preventDefault();
	session.abort();
	session = new AbortController();
	const signal = session.signal;
	const token = tokenInput.value;
	void connect(token, signal).catch((error: unknown) => {
		if (!signal.aborted) status.textContent = String(error);
	});
});

async function connect(token: string, signal: AbortSignal): Promise<void> {
	lanes.replaceChildren();
	const listing: unknown = await api("/api/threads", token, signal);
	if (!object(listing) || typeof listing.actor !== "string" || !Array.isArray(listing.threads))
		throw new Error("Invalid thread list");
	if (signal.aborted) return;
	tokenInput.value = "";
	status.textContent = `Connected as ${listing.actor}. Files are shared; agent histories are separate.`;
	for (const thread of listing.threads) {
		if (
			!object(thread) ||
			typeof thread.id !== "string" ||
			!Array.isArray(thread.agents) ||
			!Array.isArray(thread.members) ||
			!thread.members.every((member: unknown) => typeof member === "string")
		)
			throw new Error("Invalid thread");
		const overview = document.createElement("section");
		overview.className = "workspace";
		const heading = document.createElement("h2");
		heading.textContent = `${thread.id}: ${thread.members.length} users × ${thread.agents.length} shared agents`;
		const policy = document.createElement("p");
		policy.textContent =
			"Every member can message every agent. Each agent has one ordered queue; different agents run concurrently. Shared-file conflicts are not merged or prevented.";
		const relationships = document.createElement("table");
		const header = relationships.createTHead().insertRow();
		const corner = document.createElement("th");
		corner.textContent = "Thread member";
		header.append(corner);
		for (const agent of thread.agents) {
			if (!object(agent) || typeof agent.id !== "string") throw new Error("Invalid agent");
			const column = document.createElement("th");
			column.textContent = agent.id;
			header.append(column);
		}
		const body = relationships.createTBody();
		for (const member of thread.members) {
			const row = body.insertRow();
			row.insertCell().textContent = `${member}${member === listing.actor ? " (you)" : ""}`;
			for (const _agent of thread.agents) row.insertCell().textContent = "Can message and observe";
		}
		overview.append(heading, policy, relationships);
		lanes.append(overview);
		for (const agent of thread.agents) {
			if (
				!object(agent) ||
				typeof agent.id !== "string" ||
				typeof agent.kind !== "string" ||
				typeof agent.recovery !== "string"
			)
				throw new Error("Invalid agent");
			createLane(thread.id, agent.id, `${agent.kind}: ${agent.recovery}`, token, signal);
		}
	}
}

function createLane(threadId: string, agentId: string, description: string, token: string, signal: AbortSignal): void {
	const base = `/api/threads/${encodeURIComponent(threadId)}/agents/${encodeURIComponent(agentId)}`;
	const section = document.createElement("section");
	const title = document.createElement("h2");
	title.textContent = `${threadId} / ${agentId}`;
	const capability = document.createElement("p");
	capability.className = "muted";
	capability.textContent = description;
	const connection = document.createElement("p");
	const commands = document.createElement("pre");
	const transcript = document.createElement("pre");
	transcript.className = "transcript";
	const progress = document.createElement("pre");
	progress.className = "progress";
	progress.setAttribute("aria-label", "Uncommitted agent progress");
	const form = document.createElement("form");
	const input = document.createElement("textarea");
	input.maxLength = 16384;
	input.required = true;
	input.setAttribute("aria-label", `Message to ${agentId}`);
	const send = document.createElement("button");
	send.textContent = "Send follow-up";
	const stop = document.createElement("button");
	stop.type = "button";
	stop.textContent = "Stop this agent and its queue";
	const abandon = document.createElement("button");
	abandon.type = "button";
	abandon.textContent = "Discard unsent draft / retry";
	const older = document.createElement("button");
	older.type = "button";
	older.textContent = "Load earlier history";
	const feedback = document.createElement("p");
	feedback.setAttribute("role", "status");
	form.append(input, send);
	section.append(title, capability, connection, commands, transcript, progress, form, abandon, stop, older, feedback);
	lanes.append(section);
	let pending: { id: string; text: string } | null = null;
	let cursor: string | null = null;
	const messages = new Map<string, { author: string; text: string }>();
	const renderMessages = () => {
		const entries = [...messages].sort(([left], [right]) => Number(left) - Number(right));
		for (const [id] of entries.slice(0, Math.max(0, entries.length - 200))) messages.delete(id);
		transcript.textContent = [...messages]
			.sort(([left], [right]) => Number(left) - Number(right))
			.map(([, message]) => `${message.author}: ${message.text}`)
			.join("\n\n");
	};
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		pending ??= { id: crypto.randomUUID(), text: input.value };
		input.disabled = true;
		send.disabled = true;
		abandon.disabled = true;
		void api(`${base}/commands`, token, signal, pending)
			.then(() => {
				pending = null;
				input.value = "";
				input.disabled = false;
				send.textContent = "Send follow-up";
				feedback.textContent = "Accepted durably; execution may still be queued.";
			})
			.catch((error: unknown) => {
				send.textContent = "Retry same command";
				feedback.textContent = `${String(error)}. Retry preserves the original command ID and text.`;
			})
			.finally(() => {
				send.disabled = false;
				abandon.disabled = false;
			});
	});
	abandon.addEventListener("click", () => {
		pending = null;
		input.disabled = false;
		input.value = "";
		send.textContent = "Send follow-up";
		feedback.textContent = "Draft/retry discarded. Any already accepted work continues; use Stop to cancel it.";
	});
	stop.addEventListener("click", () => {
		void api(`${base}/stop`, token, signal, {})
			.then(() => {
				feedback.textContent = "Agent stopped. Peer agents continue.";
			})
			.catch((error: unknown) => {
				feedback.textContent = String(error);
			});
	});
	older.addEventListener("click", () => {
		older.disabled = true;
		void api(`${base}/history?limit=20${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`, token, signal)
			.then((page: unknown) => {
				if (!object(page) || !Array.isArray(page.items) || (page.next !== null && typeof page.next !== "string"))
					throw new Error("Invalid history");
				for (const item of page.items) {
					if (!object(item) || typeof item.id !== "string" || typeof item.text !== "string")
						throw new Error("Invalid history entry");
					if (item.text)
						messages.set(item.id, { author: typeof item.author === "string" ? item.author : agentId, text: item.text });
				}
				cursor = page.next;
				renderMessages();
				older.disabled = cursor === null;
			})
			.catch((error: unknown) => {
				older.disabled = false;
				feedback.textContent = String(error);
			});
	});
	void follow();

	async function follow(): Promise<void> {
		while (!signal.aborted) {
			try {
				connection.textContent = "Connecting…";
				const response = await fetch(`${base}/events`, { headers: { Authorization: `Bearer ${token}` }, signal });
				if (!response.ok || !response.body) throw new Error(`Stream HTTP ${response.status}`);
				connection.textContent = "Live";
				const reader = response.body.getReader();
				async function* chunks() {
					try {
						while (true) {
							const { done, value } = await reader.read();
							if (done) return;
							yield value;
						}
					} finally {
						await reader.cancel().catch(() => {});
						reader.releaseLock();
					}
				}
				for await (const data of sseData(chunks())) {
					const frame: unknown = JSON.parse(data);
					if (!object(frame) || frame.threadId !== threadId || !object(frame.agent))
						throw new Error("Invalid snapshot");
					const agent = frame.agent;
					if (
						agent.agentId !== agentId ||
						typeof agent.busy !== "boolean" ||
						typeof agent.progress !== "string" ||
						!Array.isArray(agent.messages) ||
						!Array.isArray(agent.commands)
					)
						throw new Error("Invalid agent state");
					for (const message of agent.messages) {
						if (
							!object(message) ||
							typeof message.id !== "string" ||
							typeof message.author !== "string" ||
							typeof message.text !== "string"
						)
							throw new Error("Invalid message");
						messages.set(message.id, { author: message.author, text: message.text });
					}
					commands.textContent = agent.commands
						.map((command: unknown) => {
							if (
								!object(command) ||
								typeof command.actorId !== "string" ||
								typeof command.id !== "string" ||
								typeof command.status !== "string"
							)
								throw new Error("Invalid command state");
							return `${command.actorId} / ${command.id}: ${command.status}${typeof command.reason === "string" ? ` (${command.reason})` : ""}`;
						})
						.join("\n");
					connection.textContent = agent.busy ? "Live — agent busy" : "Live — agent idle";
					progress.textContent = agent.progress ? `Transient progress:\n${agent.progress}` : "";
					renderMessages();
				}
			} catch (error) {
				if (signal.aborted) return;
				connection.textContent = `${String(error)}; reconnecting with current state…`;
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}
}

async function api(path: string, token: string, signal: AbortSignal, body?: object): Promise<unknown> {
	const response = await fetch(path, {
		method: body === undefined ? "GET" : "POST",
		signal,
		headers: {
			Authorization: `Bearer ${token}`,
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const value: unknown = await response.json();
	if (!response.ok)
		throw new Error(object(value) && typeof value.error === "string" ? value.error : `HTTP ${response.status}`);
	return value;
}

// Validate only data received over HTTP, before displaying its fields.
function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
