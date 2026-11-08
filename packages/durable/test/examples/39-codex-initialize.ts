// Verify the real T3-backed Codex client without starting a model turn or spending tokens.
// Requires an installed Codex CLI compatible with the vendored app-server schema.
// Run from packages/durable:
//   node --conditions=source --experimental-strip-types test/examples/39-codex-initialize.ts
// CODEX_BIN may name an explicit executable; credentials are never read or copied by this example.
import { createCodexDriver } from "../../src/adapters/codex/index.ts";

const driver = createCodexDriver({ command: process.env.CODEX_BIN ?? "codex" });
const session = await driver.open({
	workspace: process.cwd(),
	agentId: "initialization-probe",
	model: null,
	instructions: "",
	continuation: null,
	signal: AbortSignal.timeout(15_000),
});
await session.close();
console.log("Codex initialized and created a thread. No model turn started.");
