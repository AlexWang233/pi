// Execute preflight with disposable configuration; it must not start a server or create runtime data.
import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { prepareHost } from "../src/startup.ts";

describe("read-only preflight CLI", () => {
	it.each(["valid", "invalid-json", "missing-key", "env-file", "env-override"])(
		"checks %s input without echoing tokens or opening data",
		async (mode) => {
			const directory = await mkdtemp(join(tmpdir(), "pi-preflight-"));
			try {
				const token = "preflight-private-token-never-print";
				const apiKey = "preflight-file-key-never-print";
				const config = join(directory, "config.json");
				const data = join(directory, "data");
				const members = [{ id: "alice", tokenEnv: "COLLAB_TOKEN_ALICE" }];
				const modelId = prepareHost({ members, agents: [] }, { COLLAB_TOKEN_ALICE: token }, directory).models.getModels(
					"openai",
				)[0]!.id;
				await writeFile(
					config,
					mode !== "invalid-json"
						? JSON.stringify({
								members,
								agents:
									mode === "missing-key" || mode === "env-file" || mode === "env-override"
										? [{ id: "native", kind: "native", model: { provider: "openai", modelId } }]
										: [{ id: "codex", kind: "external", driver: "codex" }],
							})
						: `{"broken":"${token}"`,
				);
				const environment: NodeJS.ProcessEnv = {
					...process.env,
					OPENAI_API_KEY: "",
					COLLAB_CONFIG: config,
					COLLAB_DATA: data,
					COLLAB_TOKEN_ALICE: token,
				};
				if (mode === "env-file" || mode === "env-override") {
					await writeFile(
						join(directory, ".env"),
						[
							`OPENAI_API_KEY=${apiKey}`,
							`COLLAB_TOKEN_ALICE=${token}`,
							`COLLAB_CONFIG="${config.replaceAll("\\", "/")}"`,
							`COLLAB_DATA="${data.replaceAll("\\", "/")}"`,
						].join("\n"),
					);
					// Isolate the child from the developer's real .env and credentials.
					for (const key of ["COLLAB_CONFIG", "COLLAB_DATA", "COLLAB_TOKEN_ALICE"]) delete environment[key];
					if (mode === "env-file") delete environment.OPENAI_API_KEY;
				}
				const result = await promisify(execFile)(
					process.execPath,
					[
						"--env-file-if-exists=.env",
						"--conditions=source",
						"--experimental-strip-types",
						resolve("src/preflight.ts"),
					],
					{
						env: environment,
						cwd: directory,
						windowsHide: true,
						timeout: 10_000,
					},
				).then(
					(output) => ({ ...output, code: 0 }),
					(error: { stdout: string; stderr: string; code: number }) => error,
				);
				expect(result.code).toBe(mode === "valid" || mode === "env-file" ? 0 : 1);
				expect(result.stdout + result.stderr).not.toContain(token);
				expect(result.stdout + result.stderr).not.toContain(apiKey);
				if (mode === "valid" || mode === "env-file")
					expect(JSON.parse(result.stdout)).toMatchObject({ status: "configuration-valid", missingKeys: [] });
				else if (mode === "missing-key" || mode === "env-override")
					expect(JSON.parse(result.stdout)).toMatchObject({
						status: "missing-api-key-environment",
						missingKeys: ["OPENAI_API_KEY"],
					});
				else expect(result.stderr).toContain("Cannot read valid configuration JSON");
				await expect(access(data)).rejects.toMatchObject({ code: "ENOENT" });
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		},
	);
});
