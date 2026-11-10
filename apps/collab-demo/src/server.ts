// Authenticated HTTP transport over Durable's collaboration API; no execution state lives here.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Context } from "@earendil-works/chord/context";
import { type Cursor, type EntryRecord, StorageRequestError } from "@earendil-works/pi-durable";
import {
	CollaborationError,
	type CollaborativeThread,
	type CollaborativeThreadConfig,
} from "@earendil-works/pi-durable/collaboration";
import type { ConflictDemo } from "./conflict-demo.ts";
import { LaneStream } from "./streams.ts";
import { inspectWorkspace, WorkspaceFileError } from "./workspace-files.ts";

export type HostedThread = {
	thread: CollaborativeThread;
	config: CollaborativeThreadConfig;
	conflictDemo?: ConflictDemo;
};
export type DemoServerOptions = {
	threads: ReadonlyMap<string, HostedThread>;
	tokens: ReadonlyMap<string, string>;
	assets: ReadonlyMap<string, { contentType: string; body: string }>;
};

const BODY_LIMIT = 64 * 1024;

/** Create shared observations and a server; the caller owns listening and Harness lifetime. */
export async function createDemoServer(options: DemoServerOptions, context: Context) {
	const streams = new Map<string, Map<string, LaneStream>>();
	try {
		for (const [id, { thread, config }] of options.threads) {
			const lanes = new Map<string, LaneStream>();
			streams.set(id, lanes);
			for (const agent of config.agents) {
				lanes.set(agent.id, new LaneStream(id, await thread.watch(config.members[0], agent.id, context)));
			}
		}
	} catch (error) {
		await Promise.all([...streams.values()].flatMap((lanes) => [...lanes.values()].map((lane) => lane.close())));
		throw error;
	}
	const server = createServer((request, response) => {
		response.setHeader("X-Content-Type-Options", "nosniff");
		response.setHeader("Cache-Control", "no-store");
		response.setHeader("Content-Security-Policy", "default-src 'self'; object-src 'none'; frame-ancestors 'none'");
		void route(request, response).catch((error: unknown) => {
			if (response.headersSent) {
				response.destroy();
				return;
			}
			// A rejected body may still be arriving. Flush the error, then close
			// this connection instead of leaving a paused request on keep-alive.
			if (!request.complete) {
				response.setHeader("Connection", "close");
				response.once("finish", () => request.destroy());
			}
			if (error instanceof HttpError || error instanceof WorkspaceFileError)
				json(response, error.status, { error: error.message });
			else if (error instanceof CollaborationError) {
				const status = {
					forbidden: 403,
					not_found: 404,
					conflict: 409,
					capacity: 429,
					invalid_config: 400,
					invalid_command: 400,
				}[error.code];
				json(response, status, { error: error.message, code: error.code });
			} else if (error instanceof StorageRequestError) json(response, 400, { error: "Invalid history cursor" });
			else json(response, 500, { error: "Runtime operation failed; retry a submit with its original command ID" });
		});
	});
	server.requestTimeout = 10_000;
	server.headersTimeout = 10_000;

	async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const url = new URL(request.url ?? "/", "http://localhost");
		if (request.method === "GET" && options.assets.has(url.pathname)) {
			const asset = options.assets.get(url.pathname)!;
			response.writeHead(200, { "Content-Type": asset.contentType });
			response.end(asset.body);
			return;
		}
		const authorization = request.headers.authorization;
		const actor = authorization?.startsWith("Bearer ") ? options.tokens.get(authorization.slice(7)) : undefined;
		if (!actor) throw new HttpError(401, "A valid bearer token is required");
		if (request.method === "GET" && url.pathname === "/api/threads") {
			json(response, 200, {
				actor,
				threads: [...options.threads.values()]
					.filter(({ config }) => config.members.includes(actor))
					.map(({ config, conflictDemo }) => ({
						id: config.id,
						members: config.members,
						conflictDemo: conflictDemo !== undefined,
						agents: config.agents.map((agent) => ({
							id: agent.id,
							kind: agent.kind,
							recovery: agent.kind === "native" ? "Native Durable recovery" : "Uncertain turns require explicit retry",
						})),
					})),
			});
			return;
		}
		const conflict = /^\/api\/threads\/([^/]+)\/conflict-demo$/.exec(url.pathname);
		if (conflict) {
			let id: string;
			try {
				id = decodeURIComponent(conflict[1]);
			} catch {
				throw new HttpError(400, "Invalid path encoding");
			}
			const hosted = options.threads.get(id);
			if (!hosted) throw new HttpError(404, "Unknown thread");
			await hosted.thread.history(actor, hosted.config.agents[0].id, 1, undefined, context);
			if (!hosted.conflictDemo) throw new HttpError(404, "Walkthrough unavailable");
			if (request.method === "GET") json(response, 200, await hosted.conflictDemo.view(actor, context));
			else if (request.method === "POST") {
				const body = await readBody(request);
				// Wire boundary: clients select only a configured model and current round, never an actor or file path.
				if (!isObject(body) || typeof body.round !== "string" || body.round.length > 64)
					throw new HttpError(400, "Expected a walkthrough action only");
				const keys =
					body.kind === "prepare"
						? ["kind", "round", "agentId", "prompt"]
						: body.kind === "resolve"
							? ["kind", "round", "content"]
							: ["kind", "round"];
				if (Object.keys(body).some((key) => !keys.includes(key)))
					throw new HttpError(400, "Unexpected walkthrough fields");
				if (body.kind === "publish" || body.kind === "reset")
					json(
						response,
						200,
						await hosted.conflictDemo.perform(actor, { kind: body.kind, round: body.round }, context),
					);
				else if (body.kind === "prepare" && typeof body.prompt === "string" && typeof body.agentId === "string")
					json(
						response,
						200,
						await hosted.conflictDemo.perform(
							actor,
							{ kind: "prepare", round: body.round, prompt: body.prompt, agentId: body.agentId },
							context,
						),
					);
				else if (body.kind === "resolve" && typeof body.content === "string")
					json(
						response,
						200,
						await hosted.conflictDemo.perform(
							actor,
							{ kind: "resolve", round: body.round, content: body.content },
							context,
						),
					);
				else throw new HttpError(400, "Expected prepare with prompt/model, publish, reset, or resolve with text");
			} else throw new HttpError(405, "Unsupported method");
			return;
		}
		const files = /^\/api\/threads\/([^/]+)\/files$/.exec(url.pathname);
		if (files) {
			if (request.method !== "GET") throw new HttpError(405, "Workspace inspection is read-only");
			let id: string;
			try {
				id = decodeURIComponent(files[1]);
			} catch {
				throw new HttpError(400, "Invalid path encoding");
			}
			const hosted = options.threads.get(id);
			if (!hosted) throw new HttpError(404, "Unknown thread");
			// Authorize through Durable before touching the filesystem, including empty directories.
			await hosted.thread.history(actor, hosted.config.agents[0].id, 1, undefined, context);
			json(response, 200, await inspectWorkspace(hosted.config.workspace, url.searchParams.get("path") ?? ""));
			return;
		}
		const match = /^\/api\/threads\/([^/]+)\/agents\/([^/]+)\/(commands(?:\/([^/]+))?|events|state|history|stop)$/.exec(
			url.pathname,
		);
		if (!match) throw new HttpError(404, "Unknown route");
		let threadId: string;
		let agentId: string;
		let commandId: string | undefined;
		try {
			threadId = decodeURIComponent(match[1]);
			agentId = decodeURIComponent(match[2]);
			commandId = match[4] === undefined ? undefined : decodeURIComponent(match[4]);
		} catch {
			throw new HttpError(400, "Invalid path encoding");
		}
		const hosted = options.threads.get(threadId);
		if (!hosted) throw new HttpError(404, "Unknown thread");
		const { thread } = hosted;
		const action = match[3];
		if (request.method === "POST" && action === "commands") {
			const body = await readBody(request);
			if (
				!isObject(body) ||
				Object.keys(body).some((key) => key !== "id" && key !== "text") ||
				typeof body.id !== "string" ||
				!body.id ||
				body.id.length > 128 ||
				typeof body.text !== "string"
			) {
				throw new HttpError(400, "Expected only a nonempty id (up to 128 characters) and text");
			}
			json(response, 202, await thread.submit(actor, { id: body.id, agentId, text: body.text }, context));
		} else if (request.method === "GET" && commandId !== undefined) {
			json(response, 200, await thread.command(actor, agentId, commandId, context));
		} else if (request.method === "POST" && action === "stop") {
			await thread.stop(actor, agentId, context);
			json(response, 200, { stopped: agentId });
		} else if (request.method === "GET" && (action === "events" || action === "state")) {
			// The one shared watch was opened by the host. Check every viewer through
			// the package before giving it any snapshots from that watch.
			await thread.history(actor, agentId, 1, undefined, context);
			const stream = streams.get(threadId)!.get(agentId)!;
			if (action === "state") json(response, 200, stream.snapshot);
			else if (!stream.attach(response)) throw new HttpError(503, "Stream unavailable or full");
		} else if (request.method === "GET" && action === "history") {
			const limit = Number(url.searchParams.get("limit") ?? 20);
			if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HttpError(400, "History limit must be 1..50");
			const page = await thread.history(actor, agentId, limit, readCursor(url.searchParams.get("cursor")), context);
			json(response, 200, { items: page.items.map(historyEntry), next: page.next ? JSON.stringify(page.next) : null });
		} else throw new HttpError(405, "Unsupported method");
	}

	return {
		server,
		async close(): Promise<void> {
			await Promise.all([...streams.values()].flatMap((lanes) => [...lanes.values()].map((lane) => lane.close())));
			if (!server.listening) return;
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			});
		},
	};
}

class HttpError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

function json(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	response.end(JSON.stringify(body));
}

// Only untyped JSON from the wire passes through this guard.
function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
	if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
		throw new HttpError(415, "Use application/json");
	}
	const chunks: Buffer[] = [];
	let bytes = 0;
	// Consume bounded bytes using data events so rejecting a body does not make
	// the async iterator destroy the socket before the 413 response can flush.
	return new Promise((resolve, reject) => {
		request.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > BODY_LIMIT) {
				request.pause();
				reject(new HttpError(413, "Request body exceeds 64 KiB"));
			} else chunks.push(chunk);
		});
		request.once("error", reject);
		request.once("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(new HttpError(400, "Malformed JSON"));
			}
		});
	});
}

function readCursor(text: string | null): Cursor | undefined {
	if (text === null) return undefined;
	if (text.length > 2048) throw new HttpError(400, "Invalid history cursor");
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new HttpError(400, "Invalid history cursor");
	}
	if (
		!isObject(value) ||
		typeof value.after !== "number" ||
		!Number.isSafeInteger(value.after) ||
		(value.order !== "ascending" && value.order !== "descending")
	)
		throw new HttpError(400, "Invalid history cursor");
	return { after: value.after, order: value.order };
}

function historyEntry(entry: EntryRecord) {
	// Strip runtime/model/continuation identities at the transport boundary.
	const data = entry.data;
	const text =
		entry.model
			?.flatMap((message) =>
				message.role === "assistant"
					? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
					: [],
			)
			.join("") ?? "";
	return {
		id: String(entry.id),
		kind: entry.kind,
		text: text.slice(0, 8192),
		...(isObject(data)
			? {
					author: typeof data.actorId === "string" ? data.actorId : undefined,
					text: typeof data.text === "string" ? data.text.slice(0, 8192) : text.slice(0, 8192),
				}
			: {}),
	};
}
