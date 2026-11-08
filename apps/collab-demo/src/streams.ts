// One package watch per lane, with bounded and coalesced delivery to HTTP viewers.
import type { ServerResponse } from "node:http";
import type { AgentSnapshot, AgentWatch } from "@earendil-works/pi-durable/collaboration";

const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_BUFFER_BYTES = 2 * MAX_FRAME_BYTES;
const MAX_VIEWERS = 32;

/** A viewer retains at most one pending snapshot while its socket is blocked. */
export class StreamViewer {
	readonly #response: ServerResponse;
	#pending: string | null = null;
	#blocked = false;

	constructor(response: ServerResponse) {
		this.#response = response;
		response.on("drain", () => {
			this.#blocked = false;
			const frame = this.#pending;
			this.#pending = null;
			if (frame !== null) this.send(frame);
		});
	}

	/** Send or replace the pending snapshot, dropping an oversized/overloaded socket. */
	send(frame: string): void {
		const response = this.#response;
		if (response.destroyed || response.writableEnded) return;
		const bytes = Buffer.byteLength(frame);
		if (bytes > MAX_FRAME_BYTES || response.writableLength + bytes > MAX_BUFFER_BYTES) {
			response.destroy();
			return;
		}
		if (this.#blocked) this.#pending = frame;
		else this.#blocked = !response.write(frame);
	}

	/** Heartbeats do not queue behind snapshots or cause more progress buffering. */
	heartbeat(): void {
		if (!this.#blocked) this.send(": keep-alive\n\n");
	}

	/** Dispose transport only; the shared lane keeps executing. */
	close(): void {
		this.#pending = null;
		this.#response.destroy();
	}
}

/** Fan out current snapshots without creating a package watch for each viewer. */
export class LaneStream {
	readonly #watch: AgentWatch;
	readonly #viewers = new Set<StreamViewer>();
	readonly #heartbeat: ReturnType<typeof setInterval>;
	#frame: string;
	#closed = false;

	constructor(threadId: string, watch: AgentWatch) {
		this.#watch = watch;
		const encode = (agent: AgentSnapshot) => `data: ${JSON.stringify({ threadId, agent })}\n\n`;
		this.#frame = encode(watch.value);
		watch.start(async (value) => {
			this.#frame = encode(value);
			for (const viewer of this.#viewers) viewer.send(this.#frame);
		});
		this.#heartbeat = setInterval(() => {
			for (const viewer of this.#viewers) viewer.heartbeat();
		}, 15_000);
		this.#heartbeat.unref();
		void watch.closed.then(() => this.#disposeViewers());
	}

	/** Return the current package projection for an authorized state request. */
	get snapshot(): AgentSnapshot {
		return this.#watch.value;
	}

	/** Attach and send current state in the same synchronous step. */
	attach(response: ServerResponse): boolean {
		if (this.#closed || this.#viewers.size >= MAX_VIEWERS) return false;
		response.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Accel-Buffering": "no",
		});
		const viewer = new StreamViewer(response);
		this.#viewers.add(viewer);
		response.once("close", () => this.#viewers.delete(viewer));
		viewer.send(this.#frame);
		return true;
	}

	/** Stop the shared subscription and all viewers without cancelling tasks. */
	async close(): Promise<void> {
		this.#disposeViewers();
		await this.#watch.stop();
	}

	#disposeViewers(): void {
		this.#closed = true;
		clearInterval(this.#heartbeat);
		for (const viewer of this.#viewers) viewer.close();
		this.#viewers.clear();
	}
}
