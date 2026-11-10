// End-to-end preview composition serves the actual browser and writes both lanes' shared files.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { describe, expect, it } from "vitest";
import { openPreview } from "../src/preview-host.ts";

describe("credential-free browser preview", () => {
	it("serves built browser modules and executes real native tools alongside simulated external work", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "pi-collab-preview-test-"));
		try {
			const preview = await openPreview(
				workspace,
				new Map([
					["preview-alice", "alice"],
					["preview-bob", "bob"],
				]),
				BACKGROUND_CONTEXT,
			);
			try {
				await new Promise<void>((resolve, reject) => {
					preview.server.once("error", reject);
					preview.server.listen(0, "127.0.0.1", resolve);
				});
				const address = preview.server.address();
				if (address === null || typeof address === "string") throw new Error("Expected TCP address");
				const origin = `http://127.0.0.1:${address.port}`;
				expect(await (await fetch(origin)).text()).toContain('id="login"');
				const script = await fetch(`${origin}/app.js`);
				expect(script.headers.get("content-type")).toContain("text/javascript");
				expect(await script.text()).toContain('"./stream.js"');
				for (const asset of ["activity.js", "conflict.js"])
					expect((await fetch(`${origin}/${asset}`)).status).toBe(200);
				await Promise.all(
					["native-simulated", "external-simulated"].map(async (agent) => {
						const response = await fetch(`${origin}/api/threads/preview/agents/${agent}/commands`, {
							method: "POST",
							headers: { Authorization: "Bearer preview-alice", "Content-Type": "application/json" },
							body: JSON.stringify({ id: "first", text: "shared external file content" }),
						});
						expect(response.status).toBe(202);
					}),
				);
				await preview.harness.waitForIdle(BACKGROUND_CONTEXT);
				expect(await readFile(join(workspace, "native-preview.txt"), "utf8")).toBe("Deterministic native tool write");
				expect(await readFile(join(workspace, "external-preview.txt"), "utf8")).toBe("shared external file content");
				const peerState = await fetch(`${origin}/api/threads/preview/agents/native-simulated/state`, {
					headers: { Authorization: "Bearer preview-bob" },
				});
				const peer = await peerState.json();
				expect(peer).toMatchObject({ commands: [{ actorId: "alice", status: "completed" }] });
				expect(peer.tools).toEqual([
					{ id: expect.any(String), name: "write", status: "requested" },
					{ id: expect.any(String), name: "write", status: "completed" },
				]);
				// The same shared-file command is available on both execution paths.
				// Successful sequential commands can still intentionally replace prior work.
				for (const [actor, agent] of [
					["alice", "native-simulated"],
					["bob", "external-simulated"],
				]) {
					const response = await fetch(`${origin}/api/threads/preview/agents/${agent}/commands`, {
						method: "POST",
						headers: { Authorization: `Bearer preview-${actor}`, "Content-Type": "application/json" },
						body: JSON.stringify({ id: "shared-edit", text: `shared: ${actor} replacement` }),
					});
					expect(response.status).toBe(202);
					await preview.harness.waitForIdle(BACKGROUND_CONTEXT);
					expect(await readFile(join(workspace, "shared-preview.txt"), "utf8")).toBe(`${actor} replacement`);
				}
			} finally {
				await preview.close();
			}
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});
});
