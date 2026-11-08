// Launch a local, disposable preview without invoking model APIs or the Codex CLI.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openPreview } from "./preview-host.ts";

// These public tokens grant access only to this loopback, simulated preview.
const tokens = new Map([
	["preview-alice", "alice"],
	["preview-bob", "bob"],
	["preview-carol", "carol"],
]);
const directory = await mkdtemp(join(tmpdir(), "pi-collab-preview-"));
try {
	const preview = await openPreview(directory, tokens, BACKGROUND_CONTEXT);
	try {
		await new Promise<void>((resolve, reject) => {
			preview.server.once("error", reject);
			preview.server.listen(4311, "127.0.0.1", resolve);
		});
		console.log("SIMULATED agents, real Durable/tools/HTTP. No provider calls or Codex process.");
		console.log("http://127.0.0.1:4311 — tokens: preview-alice / preview-bob / preview-carol");
		console.log(`Disposable workspace: ${directory}`);
		await new Promise<void>((resolve) => {
			process.once("SIGINT", resolve);
			process.once("SIGTERM", resolve);
		});
	} finally {
		await preview.close();
	}
} finally {
	await rm(directory, { recursive: true, force: true });
}
