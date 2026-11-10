// Generate proposals, publish conditionally and reset round-scoped shared evidence.
import type { ConflictAction, ConflictProposal, ConflictView } from "./conflict-state.ts";

/** Show an isolated two-user conflict; all text is rendered literally and actions use bearer identity. */
export function createConflictDemo(threadId: string, actor: string, token: string, signal: AbortSignal): HTMLElement {
	const panel = node("details", "conflict-panel");
	panel.append(node("summary", "", "Shared-file conflict · Controlled demonstration"));
	const description = node(
		"p",
		"workspace-description",
		"Generate two proposals from a retained base, publish one, then inspect and resolve the stale edit. Loading the current round…",
	);
	panel.append(description);
	const steps = node("ol", "conflict-steps");
	panel.append(steps);
	const roundInfo = node("p", "workspace-description");
	panel.append(roundInfo);
	const modelLabel = node("label", "", "Model for my proposal (isolated conversation; no file tools)");
	const model = node("select", "proposal-model");
	model.id = `proposal-model-${encodeURIComponent(threadId)}`;
	modelLabel.htmlFor = model.id;
	const promptLabel = node("label", "", "My edit instruction");
	const prompt = node("textarea", "resolution-input");
	prompt.id = `proposal-prompt-${encodeURIComponent(threadId)}`;
	prompt.maxLength = 4096;
	promptLabel.htmlFor = prompt.id;
	panel.append(modelLabel, model, promptLabel, prompt);
	const controls = node("div", "file-toolbar");
	const prepare = node("button", "primary-button", "1. Prepare my edit");
	const publish = node("button", "primary-button", "2. Publish my edit");
	const refresh = node("button", "subtle-button", "Refresh shared evidence");
	const reset = node("button", "subtle-button", "Reset round for both users");
	controls.append(prepare, publish, refresh, reset);
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
			"Reset starts a fresh shared round, restores default prompts and stops old proposal generation. Previous rounds are retained (up to 64); stale browser actions are refused. Normal workspace files and agent histories are separate.",
		),
	);
	const base = `/api/threads/${encodeURIComponent(threadId)}/conflict-demo`;
	let busy = false;
	let current: ConflictView | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let request: Promise<void> | undefined;
	prepare.addEventListener("click", () => {
		if (current) void update({ kind: "prepare", round: current.round, agentId: model.value, prompt: prompt.value });
	});
	publish.addEventListener("click", () => {
		if (current) void update({ kind: "publish", round: current.round });
	});
	resolve.addEventListener("click", () => {
		if (current) void update({ kind: "resolve", round: current.round, content: resolution.value });
	});
	reset.addEventListener("click", () => {
		if (current) void update({ kind: "reset", round: current.round });
	});
	refresh.addEventListener("click", () => {
		void update();
	});
	panel.addEventListener("toggle", () => {
		if (panel.open) void update();
		else clearTimeout(timer);
	});
	signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
	prepare.disabled = publish.disabled = resolve.disabled = reset.disabled = prompt.disabled = model.disabled = true;
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
				const next = parseConflictView(value);
				if (signal.aborted) return;
				const participant = next.participants.find((item) => item.actorId === actor);
				if (current?.round !== next.round) {
					model.replaceChildren(
						...next.agents.map((agent) => {
							const option = node("option", "", agent.label);
							option.value = agent.id;
							return option;
						}),
					);
					model.value = participant?.agentId ?? next.agents[0]?.id ?? "";
					prompt.value = participant?.prompt ?? "";
					resolution.value = "Greeting: Hi from the team\nTheme: dark\n";
				}
				if (participant?.prepared) {
					prompt.value = participant.prompt;
					model.value = participant.agentId;
				}
				const savedResolution = next.proposals.find((item) => item.id === "resolution");
				if (savedResolution) resolution.value = savedResolution.content;
				current = next;
				render(current);
				feedback.dataset.tone = "";
				feedback.textContent =
					action?.kind === "reset"
						? "New shared round started. Both participants must generate fresh proposals."
						: "Shared evidence refreshed. Generating does not write the file; Publish checks the saved base.";
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
		prompt.disabled = model.disabled = prepare.disabled;
		prepare.textContent = current?.mode === "live" ? "1. Generate my proposal" : "1. Prepare sample proposal";
		publish.disabled =
			busy ||
			!participant ||
			participant.generation !== "completed" ||
			!current?.participants.every((item) => item.prepared) ||
			edit !== undefined;
		resolve.disabled = busy || edit?.status !== "conflict" || settled === true;
		resolution.disabled = resolve.disabled;
		refresh.disabled = busy;
		reset.disabled = busy || !participant;
	}

	function render(value: ConflictView): void {
		roundInfo.textContent = `Round ${value.round.slice(0, 8)} · ${value.mode === "live" ? "Live model generation; provider usage applies" : "Scripted preview; custom prompts are not interpreted"}`;
		description.textContent =
			value.mode === "live"
				? "Edit your prompt and select a configured native model. Each participant gets a separate proposal-only conversation with no tools. Both prepare from the same base; Publish applies a generated proposal through the real managed-file check. Ordinary agent/shell writes remain unprotected."
				: "Scripted preview uses fixed sample outputs with real SQLite/files. Use the live host for custom prompt interpretation. Both prepare, publish one, refuse the stale proposal, then explicitly resolve it.";
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
									? `base saved; generation ${participant.generation}${participant.reason ? ` · ${participant.reason}` : ""}`
									: "waiting to prepare"
					}`,
				);
			}),
		);
		const cards = [card(`Current file · ${value.file}`, value.current)];
		for (const participant of value.participants) {
			if (participant.prepared)
				cards.push(card(`${participant.actorId} · saved base`, participant.base ?? "(file absent)"));
			if (participant.prepared)
				cards.push(card(`${participant.actorId} · instruction to ${participant.agentId}`, participant.prompt));
			if (participant.output !== null) {
				const publication = value.proposals.find((item) => item.actorId === participant.actorId && item.id === "edit");
				cards.push(
					card(
						`${participant.actorId} · generated proposal · ${publication?.status ?? "awaiting publication"}`,
						participant.output,
					),
				);
			}
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
		typeof value.round !== "string" ||
		(value.mode !== "live" && value.mode !== "scripted") ||
		!Array.isArray(value.agents) ||
		typeof value.file !== "string" ||
		typeof value.current !== "string" ||
		!Array.isArray(value.participants) ||
		!Array.isArray(value.proposals)
	)
		throw new Error("Invalid conflict response");
	const agents = value.agents.map((item: unknown) => {
		if (!record(item) || typeof item.id !== "string" || typeof item.label !== "string")
			throw new Error("Invalid proposal model");
		return { id: item.id, label: item.label };
	});
	const participants = value.participants.map((item: unknown): ConflictView["participants"][number] => {
		if (
			!record(item) ||
			typeof item.actorId !== "string" ||
			typeof item.agentId !== "string" ||
			typeof item.prepared !== "boolean" ||
			typeof item.prompt !== "string" ||
			typeof item.reason !== "string" ||
			(item.output !== null && typeof item.output !== "string") ||
			(item.generation !== "unprepared" &&
				item.generation !== "queued" &&
				item.generation !== "running" &&
				item.generation !== "completed" &&
				item.generation !== "failed" &&
				item.generation !== "interrupted" &&
				item.generation !== "stopped") ||
			(item.base !== null && typeof item.base !== "string")
		)
			throw new Error("Invalid participant");
		return {
			actorId: item.actorId,
			agentId: item.agentId,
			prepared: item.prepared,
			base: item.base,
			prompt: item.prompt,
			generation: item.generation,
			output: item.output,
			reason: item.reason,
		};
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
	return {
		round: value.round,
		mode: value.mode,
		agents,
		file: value.file,
		current: value.current,
		participants,
		proposals,
	};
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
