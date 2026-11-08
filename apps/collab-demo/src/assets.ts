// Load the fixed browser asset allowlist; never serve workspace files or arbitrary paths.
import { readFile } from "node:fs/promises";

/** Read the built browser modules and static page for either host composition. */
export async function loadAssets(): Promise<Map<string, { contentType: string; body: string }>> {
	const assets = new Map<string, { contentType: string; body: string }>();
	for (const [path, file, contentType] of [
		["/", "../web/index.html", "text/html; charset=utf-8"],
		["/style.css", "../web/style.css", "text/css; charset=utf-8"],
		["/favicon.svg", "../web/favicon.svg", "image/svg+xml"],
		["/app.js", "../dist/web/app.js", "text/javascript; charset=utf-8"],
		["/stream.js", "../dist/web/stream.js", "text/javascript; charset=utf-8"],
	] as const)
		assets.set(path, { body: await readFile(new URL(file, import.meta.url), "utf8"), contentType });
	return assets;
}
