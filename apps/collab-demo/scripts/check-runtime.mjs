// Refuse unsupported Node before loading TypeScript, providers, or SQLite storage.
import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 19) || !isBuiltin("node:sqlite")) {
	console.error(`Demo requires Node 22.19+ with node:sqlite; running ${process.version} at ${process.execPath}.`);
	console.error("Activate the prepared tools in this terminal before running npm start:");
	console.error(`PowerShell: . "${fileURLToPath(new URL("../../../.artifacts/env.ps1", import.meta.url))}"`);
	process.exitCode = 1;
}
