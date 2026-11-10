// Shared workspace UI with attributed conversations, stable retries, and live command queues.

import { createActivityFeed } from "./activity.ts";
import { createConflictDemo } from "./conflict.ts";
import { createWorkspaceFiles } from "./files.ts";
import { sseData } from "./stream.ts";

const login = document.querySelector<HTMLFormElement>("#login")!;
const tokenInput = document.querySelector<HTMLInputElement>("#token")!;
const status = document.querySelector<HTMLElement>("#status")!;
const lanes = document.querySelector<HTMLElement>("#lanes")!;
const navigation = document.querySelector<HTMLElement>("#workspace-nav")!;
const memberList = document.querySelector<HTMLElement>("#member-list")!;
const welcome = document.querySelector<HTMLElement>("#welcome")!;
const sidebarToggle = document.querySelector<HTMLButtonElement>("#sidebar-toggle")!;
const backdrop = document.querySelector<HTMLButtonElement>("#sidebar-backdrop")!;
let session = new AbortController();

sidebarToggle.addEventListener("click", () => {
	if (document.body.classList.contains("sidebar-open")) closeSidebar();
	else {
		document.body.classList.add("sidebar-open");
		sidebarToggle.setAttribute("aria-expanded", "true");
		backdrop.hidden = false;
	}
});
backdrop.addEventListener("click", closeSidebar);
window.matchMedia("(max-width: 700px)").addEventListener("change", closeSidebar);
document.querySelector<HTMLButtonElement>("#open-login")!.addEventListener("click", () => {
	if (window.matchMedia("(max-width: 700px)").matches && !document.body.classList.contains("sidebar-open"))
		sidebarToggle.click();
	tokenInput.focus();
});

login.addEventListener("submit", (event) => {
	event.preventDefault();
	session.abort();
	session = new AbortController();
	const signal = session.signal;
	const token = tokenInput.value;
	void connect(token, signal).catch((error: unknown) => {
		if (!signal.aborted) {
			status.textContent = String(error);
			status.parentElement!.dataset.state = "error";
		}
	});
});

async function connect(token: string, signal: AbortSignal): Promise<void> {
	lanes.replaceChildren();
	navigation.replaceChildren();
	memberList.replaceChildren();
	lanes.hidden = true;
	welcome.hidden = false;
	status.textContent = "Connecting to your workspace…";
	status.parentElement!.dataset.state = "connecting";
	document.querySelector<HTMLElement>("#session-name")!.textContent = "Not connected";
	document.querySelector<HTMLElement>("#session-avatar")!.textContent = "?";
	document.querySelector<HTMLElement>("#workspace-count")!.textContent = "0";
	document.querySelector<HTMLElement>("#workspace-title")!.textContent = "Overview";
	document.querySelector<HTMLElement>("#environment-badge")!.textContent = "Local workspace";
	const listing: unknown = await api("/api/threads", token, signal);
	if (!object(listing) || typeof listing.actor !== "string" || !Array.isArray(listing.threads))
		throw new Error("Invalid thread list");
	if (signal.aborted) return;
	tokenInput.value = "";
	status.textContent = `Signed in as ${listing.actor}. Conversations are shared with every thread member.`;
	status.parentElement!.dataset.state = "connected";
	document.querySelector<HTMLElement>("#session-name")!.textContent = listing.actor;
	document.querySelector<HTMLElement>("#session-avatar")!.textContent = listing.actor.slice(0, 2).toUpperCase();
	document.querySelector<HTMLElement>("#workspace-count")!.textContent = String(listing.threads.length);
	document.querySelector<HTMLButtonElement>("#login button")!.textContent = "Switch";
	const members = new Set<string>();
	let pane = 0;
	for (const thread of listing.threads) {
		if (
			!object(thread) ||
			typeof thread.id !== "string" ||
			!Array.isArray(thread.agents) ||
			!Array.isArray(thread.members) ||
			!thread.members.every((member: unknown) => typeof member === "string")
		)
			throw new Error("Invalid thread");
		const group = element("section", "workspace-section");
		group.id = `workspace-${pane}`;
		const workspaceLink = element("a", "workspace-link");
		workspaceLink.href = `#${group.id}`;
		workspaceLink.append(element("span", "workspace-symbol", "~/"), element("span", "", thread.id));
		workspaceLink.addEventListener("click", closeSidebar);
		navigation.append(workspaceLink);
		const overview = element("header", "workspace-overview");
		const heading = element("div", "workspace-heading");
		const title = element("div", "");
		title.append(
			element("span", "eyebrow", "SHARED WORKSPACE"),
			element("h1", "", thread.id === "preview" ? "Preview workspace" : thread.id),
		);
		const faces = element("div", "member-avatars");
		faces.setAttribute("aria-label", "Thread members");
		for (const member of thread.members) {
			members.add(member);
			faces.append(avatar(member));
		}
		heading.append(title, faces);
		const description = element(
			"p",
			"workspace-description",
			`${thread.members.length} members · ${thread.agents.length} shared agents · Everyone can message every agent`,
		);
		const coordination = element("details", "coordination-details");
		coordination.append(
			element("summary", "", `Access & coordination · ${thread.members.length} users × ${thread.agents.length} agents`),
		);
		coordination.append(
			element(
				"p",
				"coordination-copy",
				"Each agent has one ordered queue. Different agents can run concurrently in the shared workspace. File conflicts are not merged or prevented.",
			),
		);
		const relationships = document.createElement("table");
		relationships.setAttribute("aria-label", `${thread.id} user and agent access`);
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
			for (const _agent of thread.agents) row.insertCell().textContent = "Message & observe";
		}
		const matrix = element("div", "matrix-scroll");
		matrix.append(relationships);
		coordination.append(matrix);
		overview.append(heading, description, coordination);
		const grid = element("div", "agent-grid");
		group.append(overview);
		if (thread.conflictDemo === true) group.append(createConflictDemo(thread.id, listing.actor, token, signal));
		group.append(createWorkspaceFiles(thread.id, token, signal), grid);
		lanes.append(group);
		for (const agent of thread.agents) {
			if (
				!object(agent) ||
				typeof agent.id !== "string" ||
				typeof agent.kind !== "string" ||
				typeof agent.recovery !== "string"
			)
				throw new Error("Invalid agent");
			if (agent.kind !== "native" && agent.kind !== "external") throw new Error("Invalid agent kind");
			const link = element("a", "agent-link");
			const panelId = `agent-${++pane}`;
			link.href = `#${panelId}`;
			link.append(
				element("span", "status-dot"),
				element("span", "", agent.id),
				element("span", "nav-caption", agent.kind === "native" ? "Pi" : "External"),
			);
			link.addEventListener("click", closeSidebar);
			navigation.append(link);
			createLane(
				thread.id,
				agent.id,
				agent.kind,
				agent.recovery,
				thread.members.length,
				{ grid, link, panelId },
				token,
				signal,
			);
		}
	}
	for (const member of members) {
		const row = element("div", "member-row");
		row.append(avatar(member), element("span", "member-name", member));
		if (member === listing.actor) row.append(element("span", "member-you", "YOU"));
		memberList.append(row);
	}
	const first = listing.threads[0];
	document.querySelector<HTMLElement>("#workspace-title")!.textContent =
		object(first) && typeof first.id === "string" ? first.id : "No workspaces";
	document.querySelector<HTMLElement>("#environment-badge")!.textContent =
		object(first) && first.id === "preview" ? "Simulated agents" : "Local workspace";
	welcome.hidden = true;
	lanes.hidden = false;
	if (!listing.threads.length)
		lanes.append(element("p", "workspace-description", "You do not have access to any configured workspaces."));
	closeSidebar();
}

function createLane(
	threadId: string,
	agentId: string,
	kind: "native" | "external",
	recovery: string,
	memberCount: number,
	view: { grid: HTMLElement; link: HTMLElement; panelId: string },
	token: string,
	signal: AbortSignal,
): void {
	const base = `/api/threads/${encodeURIComponent(threadId)}/agents/${encodeURIComponent(agentId)}`;
	const section = element("section", "agent-panel");
	section.id = view.panelId;
	section.dataset.kind = kind;
	const header = element("header", "agent-header");
	const heading = element("div", "agent-heading");
	heading.append(
		element("h2", "", agentId),
		element(
			"p",
			"",
			kind === "native" ? "Pi harness · Durable recovery" : "External harness · Explicit retry on interruption",
		),
	);
	heading.title = recovery;
	const connection = element("div", "status-badge");
	const connectionText = element("span", "", "Connecting");
	connection.append(element("span", "status-dot"), connectionText);
	header.append(element("span", "agent-glyph", kind === "native" ? ">_" : "<>"), heading, connection);
	const activity = element("details", "command-activity");
	activity.open = true;
	const activitySummary = element("summary", "", "Activity · No commands yet");
	const commands = element("div", "command-list");
	const timeline = createActivityFeed(agentId);
	activity.append(
		activitySummary,
		commands,
		timeline.root,
		element(
			"p",
			"activity-note",
			"Recent observed changes, not a complete event log. Reconnect restores current receipts and saved tool records; missed transitions are not invented. Tool results do not prove the requested file change succeeded.",
		),
	);
	const transcript = element("div", "transcript");
	transcript.setAttribute("aria-label", `Conversation with ${agentId}`);
	const empty = element("div", "conversation-empty");
	empty.append(
		element("span", "agent-glyph", kind === "native" ? ">_" : "<>"),
		element("h3", "", "Start a shared conversation"),
		element("p", "", "Send this agent a message. Every thread member can follow along and add instructions."),
	);
	transcript.append(empty);
	const progress = element("div", "progress");
	progress.hidden = true;
	const progressText = element("pre", "");
	progress.append(element("p", "progress-label", "In progress · transient output"), progressText);
	progress.setAttribute("aria-label", "Uncommitted agent progress");
	const composerArea = element("div", "composer-area");
	const form = element("form", "composer");
	const input = document.createElement("textarea");
	input.maxLength = 16384;
	input.required = true;
	input.placeholder = threadId === "preview" ? "Try shared: A change from your agent…" : `Message ${agentId}…`;
	input.setAttribute("aria-label", `Message to ${agentId}`);
	const send = document.createElement("button");
	send.textContent = "Send message";
	send.className = "primary-button";
	const stop = document.createElement("button");
	stop.type = "button";
	stop.textContent = "Stop this agent and its queue";
	stop.className = "subtle-button stop-button";
	stop.disabled = true;
	const abandon = document.createElement("button");
	abandon.type = "button";
	abandon.textContent = "Clear draft";
	abandon.className = "subtle-button";
	abandon.title = "Discard the draft or retry; already accepted work continues";
	const older = document.createElement("button");
	older.type = "button";
	older.textContent = "Load earlier history";
	older.className = "subtle-button";
	const feedback = element("p", "feedback");
	feedback.setAttribute("role", "status");
	const toolbar = element("div", "composer-toolbar");
	toolbar.append(element("span", "composer-caption", `Shared with ${memberCount} members`), send);
	form.append(input, toolbar);
	const actions = element("div", "lane-actions");
	const draftActions = element("div", "");
	draftActions.append(abandon, older);
	actions.append(draftActions, stop);
	composerArea.append(form, actions, feedback);
	section.append(header, transcript, progress, activity, composerArea);
	view.grid.append(section);
	let pending: { id: string; text: string } | null = null;
	let cursor: string | null = null;
	const messages = new Map<string, { author: string; text: string; role: "user" | "assistant" }>();
	const renderMessages = () => {
		const atBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 70;
		const entries = [...messages].sort(([left], [right]) => Number(left) - Number(right));
		for (const [id] of entries.slice(0, Math.max(0, entries.length - 200))) messages.delete(id);
		const nodes = [...messages]
			.sort(([left], [right]) => Number(left) - Number(right))
			.map(([, message]) => {
				const article = element("article", "message");
				article.dataset.role = message.role;
				const heading = element("div", "message-heading");
				heading.append(
					avatar(message.author),
					element("span", "", message.author),
					element("span", "message-role", message.role === "user" ? "Member" : "Agent"),
				);
				article.append(heading, element("div", "message-body", message.text));
				return article;
			});
		transcript.replaceChildren(...(nodes.length ? nodes : [empty]));
		if (atBottom) transcript.scrollTop = transcript.scrollHeight;
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
				send.textContent = "Send message";
				abandon.textContent = "Clear draft";
				feedback.dataset.tone = "success";
				feedback.textContent = "Accepted durably; execution may still be queued.";
			})
			.catch((error: unknown) => {
				send.textContent = "Retry same command";
				abandon.textContent = "Discard retry";
				feedback.dataset.tone = "error";
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
		send.textContent = "Send message";
		abandon.textContent = "Clear draft";
		feedback.dataset.tone = "success";
		feedback.textContent = "Draft/retry discarded. Any already accepted work continues; use Stop to cancel it.";
	});
	stop.addEventListener("click", () => {
		void api(`${base}/stop`, token, signal, {})
			.then(() => {
				feedback.dataset.tone = "success";
				feedback.textContent = "Agent stopped. Peer agents continue.";
			})
			.catch((error: unknown) => {
				feedback.dataset.tone = "error";
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
						messages.set(item.id, {
							author: typeof item.author === "string" ? item.author : agentId,
							text: item.text,
							role: item.kind === "collab.input" ? "user" : "assistant",
						});
				}
				cursor = page.next;
				renderMessages();
				older.disabled = cursor === null;
			})
			.catch((error: unknown) => {
				older.disabled = false;
				feedback.dataset.tone = "error";
				feedback.textContent = String(error);
			});
	});
	void follow();

	async function follow(): Promise<void> {
		while (!signal.aborted) {
			try {
				connectionText.textContent = "Connecting";
				connection.dataset.state = "connecting";
				const response = await fetch(`${base}/events`, { headers: { Authorization: `Bearer ${token}` }, signal });
				if (!response.ok || !response.body) throw new Error(`Stream HTTP ${response.status}`);
				connectionText.textContent = "Live";
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
							(message.role !== "user" && message.role !== "assistant") ||
							typeof message.id !== "string" ||
							typeof message.author !== "string" ||
							typeof message.text !== "string"
						)
							throw new Error("Invalid message");
						messages.set(message.id, { author: message.author, text: message.text, role: message.role });
					}
					let running = 0;
					let queued = 0;
					const receipts: { actorId: string; id: string; status: string }[] = [];
					const commandRows = agent.commands.map((command: unknown) => {
						if (
							!object(command) ||
							typeof command.actorId !== "string" ||
							typeof command.id !== "string" ||
							typeof command.status !== "string"
						)
							throw new Error("Invalid command state");
						if (command.status === "running") running++;
						if (command.status === "queued") queued++;
						receipts.push({ actorId: command.actorId, id: command.id, status: command.status });
						const row = element("div", "command-row");
						row.dataset.status = command.status;
						const author = element("span", "command-author", command.actorId);
						const id = element("code", "", command.id.slice(0, 8));
						id.title = command.id;
						author.append(id);
						row.append(author, element("span", "command-state", command.status));
						if (typeof command.reason === "string") {
							row.title = command.reason;
							row.append(element("p", "command-reason", command.reason));
						}
						return row;
					});
					commands.replaceChildren(
						...(commandRows.length ? commandRows : [element("p", "command-empty", "No commands yet")]),
					);
					timeline.update(receipts, agent.tools);
					activitySummary.textContent =
						running || queued
							? `Activity · ${running} running · ${queued} queued`
							: `Activity · ${commandRows.length} recent commands`;
					connectionText.textContent = agent.busy ? "Working" : "Idle";
					connection.dataset.state = agent.busy ? "busy" : "idle";
					view.link.dataset.state = agent.busy ? "busy" : "idle";
					stop.disabled = !agent.busy;
					progress.hidden = !agent.progress;
					progressText.textContent = agent.progress;
					renderMessages();
				}
			} catch (error) {
				if (signal.aborted) return;
				connectionText.textContent = "Reconnecting";
				connection.dataset.state = "reconnecting";
				connection.title = String(error);
				view.link.dataset.state = "reconnecting";
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}
}

function closeSidebar(): void {
	document.body.classList.remove("sidebar-open");
	sidebarToggle.setAttribute("aria-expanded", "false");
	backdrop.hidden = true;
}

function avatar(name: string): HTMLSpanElement {
	const face = element("span", "avatar", name.slice(0, 2).toUpperCase());
	face.title = name;
	face.setAttribute("aria-hidden", "true");
	face.dataset.color = String((name.charCodeAt(0) % 3) + 1);
	return face;
}

function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
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
