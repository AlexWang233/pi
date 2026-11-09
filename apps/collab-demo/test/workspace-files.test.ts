// Real HTTP inspection tests use disposable files and require membership before reading them.
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aliceToken, fixture, outsiderToken } from "./fixture.ts";

let root: string;
let app: Awaited<ReturnType<typeof fixture>>;
const route = (path = "") => `/api/threads/room/files?path=${encodeURIComponent(path)}`;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "pi-workspace-files-"));
	await mkdir(join(root, "workspace"));
	app = await fixture(undefined, join(root, "workspace"));
});
afterEach(async () => {
	await app.close();
	await rm(root, { recursive: true, force: true });
});

describe("authenticated workspace inspection", () => {
	it("lists nested files and refreshes current UTF-8 content without modifying it", async () => {
		await mkdir(join(root, "workspace", "src"));
		const file = join(root, "workspace", "src", "hello.txt");
		await writeFile(file, "<script>literal</script> café");
		expect(await (await app.request(route())).json()).toMatchObject({
			kind: "directory",
			path: "",
			entries: [{ name: "src", kind: "directory" }],
			truncated: false,
		});
		expect(await (await app.request(route("src"))).json()).toMatchObject({
			entries: [{ name: "hello.txt", kind: "file" }],
		});
		expect(await (await app.request(route("src/hello.txt"))).json()).toMatchObject({
			kind: "file",
			content: "<script>literal</script> café",
		});
		await writeFile(file, "new edit");
		expect(await (await app.request(route("src/hello.txt"))).json()).toMatchObject({ content: "new edit" });
		expect(await readFile(file, "utf8")).toBe("new edit");
	});
	it("requires valid identity and membership even when the workspace is missing", async () => {
		await rm(join(root, "workspace"), { recursive: true });
		expect((await fetch(app.url + route())).status).toBe(401);
		expect((await app.request(route(), outsiderToken)).status).toBe(403);
		expect((await app.request(route())).status).toBe(404);
	});
	it("refuses mutations, traversal, absolute paths, hidden paths and alternate streams", async () => {
		for (const path of [
			"../secret",
			"/etc/passwd",
			"C:/secret",
			"src/../../secret",
			"src\\secret",
			".env",
			"src/.git/config",
			"node_modules/pkg",
			"NODE_MODULES/pkg",
			"node_modules./pkg",
			"node_modules /pkg",
			"file:stream",
			"a\0b",
		]) {
			expect((await app.request(route(path))).status, path).toBe(400);
		}
		expect((await app.request(route(), aliceToken, { method: "POST", body: "{}" })).status).toBe(405);
	});
	it("hides dotfiles and refuses directory links and hard-linked files", async () => {
		await writeFile(join(root, "secret.txt"), "outside");
		await writeFile(join(root, "workspace", ".env"), "private");
		await mkdir(join(root, "workspace", "node_modules"));
		await symlink(root, join(root, "workspace", "linked"), process.platform === "win32" ? "junction" : "dir");
		await link(join(root, "secret.txt"), join(root, "workspace", "hard.txt"));
		const response = await app.request(route());
		expect(await response.json()).toMatchObject({ entries: [{ name: "hard.txt", kind: "file" }] });
		expect((await app.request(route("linked/secret.txt"))).status).toBe(403);
		expect((await app.request(route("hard.txt"))).status).toBe(403);
	});
	it("bounds directory scans and rejects large, binary and invalid UTF-8 files", async () => {
		for (let index = 0; index < 201; index++) await writeFile(join(root, "workspace", `f${index}.txt`), "");
		const listing = await (await app.request(route())).json();
		expect(listing).toMatchObject({ truncated: true });
		expect(listing.entries).toHaveLength(200);
		for (const [name, data, status] of [
			["large.txt", Buffer.alloc(65537, 65), 413],
			["binary.bin", Buffer.from([0, 1, 2]), 415],
			["invalid.txt", Buffer.from([255]), 415],
		] as const) {
			await writeFile(join(root, "workspace", name), data);
			expect((await app.request(route(name))).status).toBe(status);
		}
		await writeFile(join(root, "workspace", "boundary.txt"), "a".repeat(65536));
		expect((await app.request(route("boundary.txt"))).status).toBe(200);
	});
});
