// Presenter-controlled managed-file steps with shared, periodically refreshed durable evidence.
import type { ConflictAction, ConflictProposal, ConflictView } from "./conflict-state.ts";

/** Show an isolated two-user conflict; all text is rendered literally and actions use bearer identity. */
export function createConflictDemo(threadId: string, actor: string, token: string, signal: AbortSignal): HTMLElement {
	const panel = node("details", "conflict-panel");
	panel.append(node("summary", "", "Shared-file conflict · Controlled demonstration"));
	panel.append(
		node(
			"p",
			"workspace-description",
			"Two signed-in members prepare edits from the same file. Publish one, reject the stale edit, then explicitly resolve it. Scripted proposals use real Durable/SQLite and ManagedFile; no model calls. Live agent/shell writes are not protected.",
		),
	);
	const steps = node("ol", "conflict-steps");
	panel.append(steps);
	const controls = node("div", "file-toolbar");
	const prepare = node("button", "primary-button", "1. Prepare my edit");
	const publish = node("button", "primary-button", "2. Publish my edit");
	const refresh = node("button", "subtle-button", "Refresh shared evidence");
	controls.append(prepare, publish, refresh);
	panel.append(controls);
	const comparison = node("div", "conflict-comparison");
	panel.append(comparison);
	const resolutionLabel = node("label", "", "Explicit resolution (editable; nothing is automatically merged)");
	const resolution = node("textarea", "resolution-input");
	resolution.id = `resolution-${encodeURIComponent(threadId)}`;
	resolutionLabel.htmlFor = resolution.id;
	resolution.maxLength = 8192;
	resolution.value = "Greeting: Hi from the team\nTheme: dark\n";
	const resolve = node("button", "primary-button", "3. Publish my resolution");
	const resolutionControls = node("div", "resolution-controls");
	resolutionControls.append(resolutionLabel, resolution, resolve);
	panel.append(resolutionControls);
	const feedback = node("p", "feedback");
	feedback.setAttribute("role", "status");
	panel.append(feedback);
	panel.append(
		node(
			"p",
			"workspace-description",
			"One saved walkthrough per installation. Refresh/reconnect restores evidence; repeating an action retries the same step. A saved resolution cannot be replaced with different text. Live workspace files are separate.",
		),
	);
	const base = `/api/threads/${encodeURIComponent(threadId)}/conflict-demo`;
	let busy = false;
	let current: ConflictView | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let request: Promise<void> | undefined;
	prepare.addEventListener("click", () => {
		void update({ kind: "prepare" });
	});
	publish.addEventListener("click", () => {
		void update({ kind: "publish" });
	});
	resolve.addEventListener("click", () => {
		void update({ kind: "resolve", content: resolution.value });
	});
	refresh.addEventListener("click", () => {
		void update();
	});
	panel.addEventListener("toggle", () => {
		if (panel.open) void update();
		else clearTimeout(timer);
	});
	signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
	prepare.disabled = publish.disabled = resolve.disabled = true;
	return panel;

	function update(action?: ConflictAction): Promise<void> {
		// Do not overlap polls or let a stale GET response replace the result of a button action.
		if (request) return request;
		clearTimeout(timer);
		busy = true;
		renderControls();
		request = (async () => {
			try {
				const response = await fetch(base, {
					method: action ? "POST" : "GET",
					signal,
					headers: { Authorization: `Bearer ${token}`, ...(action ? { "Content-Type": "application/json" } : {}) },
					...(action ? { body: JSON.stringify(action) } : {}),
				});
				const value: unknown = await response.json();
				if (!response.ok)
					throw new Error(record(value) && typeof value.error === "string" ? value.error : `HTTP ${response.status}`);
				current = parseConflictView(value);
				if (signal.aborted) return;
				render(current);
				feedback.dataset.tone = "";
				feedback.textContent = "Shared evidence refreshed. Stale publication is retained as a conflict, not written.";
			} catch (error) {
				if (!signal.aborted) {
					feedback.dataset.tone = "error";
					feedback.textContent = String(error);
				}
			} finally {
				busy = false;
				request = undefined;
				renderControls();
				if (panel.open && !signal.aborted)
					timer = setTimeout(() => {
						void update();
					}, 2000);
			}
		})();
		return request;
	}

	function renderControls(): void {
		const participant = current?.participants.find((item) => item.actorId === actor);
		const edit = current?.proposals.find((item) => item.actorId === actor && item.id === "edit");
		const settled = current?.proposals.some((item) => item.actorId === actor && item.id === "resolution");
		prepare.disabled = busy || !participant || participant.prepared;
		publish.disabled =
			busy || !participant || !current?.participants.every((item) => item.prepared) || edit !== undefined;
		resolve.disabled = busy || edit?.status !== "conflict" || settled === true;
		resolution.disabled = resolve.disabled;
		refresh.disabled = busy;
	}

	function render(value: ConflictView): void {
		steps.replaceChildren(
			...value.participants.map((participant) => {
				const proposal = value.proposals.find((item) => item.actorId === participant.actorId && item.id === "edit");
				const result = value.proposals.find((item) => item.actorId === participant.actorId && item.id === "resolution");
				return node(
					"li",
					"",
					`${participant.actorId}${participant.actorId === actor ? " (you)" : ""} → ${participant.agentId}: ${
						result
							? `resolution ${result.status}`
							: proposal
								? `publication ${proposal.status}`
								: participant.prepared
									? "base saved; edit ready"
									: "waiting to prepare"
					}`,
				);
			}),
		);
		const cards = [card(`Current file · ${value.file}`, value.current)];
		for (const participant of value.participants) {
			if (participant.prepared)
				cards.push(card(`${participant.actorId} · saved base`, participant.base ?? "(file absent)"));
		}
		for (const proposal of value.proposals) {
			const article = card(`${proposal.actorId} · ${proposal.id} · ${proposal.status}`, proposal.content);
			article.dataset.status = proposal.status;
			if (proposal.status === "conflict")
				article.append(
					node("p", "feedback", "Rejected stale edit. The current file was preserved."),
					card("Current when rejected", proposal.current ?? "(file absent)"),
				);
			if (proposal.status === "uncertain") article.append(node("p", "feedback", proposal.reason));
			cards.push(article);
		}
		comparison.replaceChildren(...cards);
	}
}

/** Validate the HTTP response before rendering saved content, actors or publication states. */
export function parseConflictView(value: unknown): ConflictView {
	if (
		!record(value) ||
		typeof value.file !== "string" ||
		typeof value.current !== "string" ||
		!Array.isArray(value.participants) ||
		!Array.isArray(value.proposals)
	)
		throw new Error("Invalid conflict response");
	const participants = value.participants.map((item: unknown) => {
		if (
			!record(item) ||
			typeof item.actorId !== "string" ||
			typeof item.agentId !== "string" ||
			typeof item.prepared !== "boolean" ||
			(item.base !== null && typeof item.base !== "string")
		)
			throw new Error("Invalid participant");
		return { actorId: item.actorId, agentId: item.agentId, prepared: item.prepared, base: item.base };
	});
	const proposals = value.proposals.map((item: unknown): ConflictProposal => {
		if (
			!record(item) ||
			typeof item.id !== "string" ||
			typeof item.baseId !== "string" ||
			typeof item.actorId !== "string" ||
			typeof item.agentId !== "string" ||
			typeof item.content !== "string" ||
			(item.base !== null && typeof item.base !== "string")
		)
			throw new Error("Invalid proposal");
		const base = {
			id: item.id,
			baseId: item.baseId,
			actorId: item.actorId,
			agentId: item.agentId,
			content: item.content,
			base: item.base,
		};
		if (item.status === "applied" || item.status === "prepared") return { ...base, status: item.status };
		if (item.status === "conflict" && (item.current === null || typeof item.current === "string"))
			return { ...base, status: "conflict", current: item.current };
		if (item.status === "uncertain" && typeof item.reason === "string")
			return { ...base, status: "uncertain", reason: item.reason };
		throw new Error("Invalid publication status");
	});
	return { file: value.file, current: value.current, participants, proposals };
}

function card(title: string, content: string): HTMLElement {
	const article = node("article", "conflict-card");
	article.append(node("h3", "", title), node("pre", "", content));
	return article;
}

function node<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const result = document.createElement(tag);
	result.className = className;
	if (text !== undefined) result.textContent = text;
	return result;
}

// Only untyped HTTP values pass this boundary guard.
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
