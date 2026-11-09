// Bounded read-only workspace inspection for authenticated thread members; never an arbitrary static file server.
import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join } from "node:path";

/** Refuse a workspace inspection with a safe, path-free HTTP error. */
export class WorkspaceFileError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** Inspect one relative directory or at most 64 KiB of UTF-8 text, refusing links and hidden paths. */
export async function inspectWorkspace(workspace: string, path: string) {
	// HTTP path boundary: accept portable relative segments, never drive paths, ADS or traversal.
	const segments = path === "" ? [] : path.split("/");
	if (
		path.length > 1024 ||
		segments.length > 32 ||
		segments.some(
			(part) =>
				!part ||
				part.startsWith(".") ||
				part.toLowerCase() === "node_modules" ||
				part.endsWith(".") ||
				part.endsWith(" ") ||
				part.includes("\0") ||
				/[\\:]/.test(part),
		)
	)
		throw new WorkspaceFileError(
			400,
			"Use a visible relative workspace path; hidden files and node_modules are unavailable",
		);
	try {
		let target = await realpath(workspace);
		for (const segment of segments) {
			target = join(target, segment);
			// Filesystem boundary: reject every link component rather than following it outside the workspace.
			if ((await lstat(target)).isSymbolicLink()) throw new WorkspaceFileError(403, "Linked paths are unavailable");
		}
		const info = await lstat(target);
		if (info.isDirectory()) {
			const entries: { name: string; kind: "directory" | "file" }[] = [];
			let scanned = 0;
			let truncated = false;
			for await (const entry of await opendir(target)) {
				// One overflow probe distinguishes a complete directory from an omitted tail.
				if (++scanned > 200) {
					truncated = true;
					break;
				}
				if (
					entry.name.startsWith(".") ||
					entry.name.toLowerCase() === "node_modules" ||
					entry.name.endsWith(".") ||
					entry.name.endsWith(" ") ||
					/[\\:]/.test(entry.name)
				)
					continue;
				if (entry.isDirectory()) entries.push({ name: entry.name, kind: "directory" });
				else if (entry.isFile()) entries.push({ name: entry.name, kind: "file" });
			}
			entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
			return { kind: "directory" as const, path, entries, truncated };
		}
		if (!info.isFile()) throw new WorkspaceFileError(415, "Only regular text files can be viewed");
		// POSIX final-component protection; Node does not offer portable handle-relative traversal on Windows.
		const flags =
			process.platform === "win32"
				? constants.O_RDONLY
				: constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
		const file = await open(target, flags);
		try {
			const opened = await file.stat();
			if (!opened.isFile() || opened.nlink > 1)
				throw new WorkspaceFileError(403, "Linked or special files are unavailable");
			if (opened.size > 65536) throw new WorkspaceFileError(413, "Text preview is limited to 64 KiB");
			// Read a fixed buffer even if a concurrent writer grows the file after stat.
			const buffer = Buffer.alloc(65537);
			let bytes = 0;
			while (bytes < buffer.length) {
				const read = await file.read(buffer, bytes, buffer.length - bytes, bytes);
				if (!read.bytesRead) break;
				bytes += read.bytesRead;
			}
			if (bytes > 65536) throw new WorkspaceFileError(413, "Text preview is limited to 64 KiB");
			const content = buffer.subarray(0, bytes);
			if (content.includes(0)) throw new WorkspaceFileError(415, "Only UTF-8 text can be viewed");
			let text: string;
			try {
				text = new TextDecoder("utf-8", { fatal: true }).decode(content);
			} catch {
				throw new WorkspaceFileError(415, "Only UTF-8 text can be viewed");
			}
			return { kind: "file" as const, path, content: text, bytes };
		} finally {
			await file.close();
		}
	} catch (error) {
		// OS error boundary: redact absolute paths and system details from expected filesystem refusals.
		if (error instanceof Error && "code" in error) {
			if (["ENOENT", "ENOTDIR", "ELOOP"].includes(String(error.code)))
				throw new WorkspaceFileError(404, "Workspace path not found");
			if (["EACCES", "EPERM"].includes(String(error.code)))
				throw new WorkspaceFileError(403, "Workspace path unavailable");
		}
		throw error;
	}
}
