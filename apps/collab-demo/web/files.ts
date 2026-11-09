// Read-only, manually refreshed workspace navigation; file text is always rendered literally.

/** Build a lazy workspace browser whose requests share the current authenticated page session. */
export function createWorkspaceFiles(threadId: string, token: string, signal: AbortSignal): HTMLDetailsElement {
	const panel = document.createElement("details");
	panel.className = "workspace-files";
	const summary = document.createElement("summary");
	summary.textContent = "Workspace files · Read only";
	const note = document.createElement("p");
	note.className = "workspace-description";
	note.textContent =
		"Browse current files without asking an agent. Refresh to see edits. Files may change while you read. Hidden files, links and node_modules are unavailable.";
	const toolbar = document.createElement("div");
	toolbar.className = "file-toolbar";
	const up = document.createElement("button");
	up.type = "button";
	up.className = "subtle-button";
	up.textContent = "Up one folder";
	up.disabled = true;
	const refresh = document.createElement("button");
	refresh.type = "button";
	refresh.className = "subtle-button";
	refresh.textContent = "Refresh files";
	const location = document.createElement("code");
	location.textContent = "/";
	toolbar.append(up, refresh, location);
	const layout = document.createElement("div");
	layout.className = "file-layout";
	const listing = document.createElement("nav");
	listing.className = "file-list";
	listing.setAttribute("aria-label", `${threadId} workspace directory`);
	const viewer = document.createElement("div");
	viewer.className = "file-viewer";
	const title = document.createElement("p");
	title.className = "file-title";
	title.textContent = "Select a text file (up to 64 KiB)";
	const content = document.createElement("pre");
	content.tabIndex = 0;
	content.setAttribute("aria-label", "File contents");
	viewer.append(title, content);
	layout.append(listing, viewer);
	const status = document.createElement("p");
	status.className = "feedback";
	status.setAttribute("role", "status");
	panel.append(summary, note, toolbar, layout, status);
	let directory = "";
	let selected: string | undefined;
	let loaded = false;
	let request: AbortController | undefined;
	panel.addEventListener("toggle", () => {
		if (panel.open && !loaded) void load("");
	});
	up.addEventListener("click", () => {
		void load(directory.split("/").slice(0, -1).join("/"));
	});
	refresh.addEventListener("click", () => {
		void load(directory, selected);
	});
	return panel;

	async function load(path: string, fileAfter?: string): Promise<void> {
		request?.abort();
		const active = new AbortController();
		request = active;
		selected = undefined;
		const requestSignal = AbortSignal.any([signal, active.signal]);
		status.dataset.tone = "";
		status.textContent = "Reading workspace…";
		content.textContent = "";
		title.textContent = "Select a text file (up to 64 KiB)";
		try {
			const response = await fetch(
				`/api/threads/${encodeURIComponent(threadId)}/files?path=${encodeURIComponent(path)}`,
				{
					headers: { Authorization: `Bearer ${token}` },
					signal: requestSignal,
				},
			);
			const value: unknown = await response.json();
			if (requestSignal.aborted) return;
			if (!response.ok)
				throw new Error(record(value) && typeof value.error === "string" ? value.error : `HTTP ${response.status}`);
			// HTTP response boundary: check fields before using paths, entry names or text in the UI.
			if (!record(value) || typeof value.path !== "string") throw new Error("Invalid workspace response");
			if (value.kind === "directory" && Array.isArray(value.entries) && typeof value.truncated === "boolean") {
				const buttons = value.entries.map((entry: unknown) => {
					if (!record(entry) || typeof entry.name !== "string" || (entry.kind !== "directory" && entry.kind !== "file"))
						throw new Error("Invalid directory entry");
					const child = path ? `${path}/${entry.name}` : entry.name;
					const button = document.createElement("button");
					button.type = "button";
					button.className = "file-entry";
					button.textContent = `${entry.name}${entry.kind === "directory" ? "/" : ""}`;
					button.addEventListener("click", () => {
						void load(child);
					});
					return button;
				});
				directory = value.path;
				selected = undefined;
				loaded = true;
				location.textContent = `/${directory}`;
				up.disabled = !directory;
				listing.replaceChildren(...buttons);
				status.textContent = value.truncated
					? "Only the first 200 directory entries were scanned; some entries are omitted."
					: buttons.length
						? "Directory refreshed. Select a file to inspect it."
						: "No visible files in this folder.";
				if (fileAfter !== undefined) await load(fileAfter);
			} else if (value.kind === "file" && typeof value.content === "string" && typeof value.bytes === "number") {
				selected = value.path;
				title.textContent = `${value.path} · ${value.bytes} bytes`;
				content.textContent = value.content;
				status.textContent = "Text read just now. Refresh to check for later edits.";
			} else throw new Error("Invalid workspace response");
		} catch (error) {
			if (requestSignal.aborted) return;
			status.dataset.tone = "error";
			status.textContent = String(error);
		}
	}
}

// Only untyped JSON received from the server passes this guard.
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
