// Execute preflight with disposable configuration; it must not start a server or create runtime data.
import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { prepareHost } from "../src/startup.ts";

describe("read-only preflight CLI", () => {
	it.each(["valid", "invalid-json", "missing-key"])(
		"checks %s input without echoing tokens or opening data",
		async (mode) => {
			const directory = await mkdtemp(join(tmpdir(), "pi-preflight-"));
			try {
				const token = "preflight-private-token-never-print";
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
									mode === "missing-key"
										? [{ id: "native", kind: "native", model: { provider: "openai", modelId } }]
										: [{ id: "codex", kind: "external", driver: "codex" }],
							})
						: `{"broken":"${token}"`,
				);
				const result = await promisify(execFile)(
					process.execPath,
					["--conditions=source", "--experimental-strip-types", resolve("src/preflight.ts")],
					{
						env: {
							...process.env,
							OPENAI_API_KEY: "",
							COLLAB_CONFIG: config,
							COLLAB_DATA: data,
							COLLAB_TOKEN_ALICE: token,
						},
						windowsHide: true,
						timeout: 10_000,
					},
				).then(
					(output) => ({ ...output, code: 0 }),
					(error: { stdout: string; stderr: string; code: number }) => error,
				);
				expect(result.code).toBe(mode === "valid" ? 0 : 1);
				expect(result.stdout + result.stderr).not.toContain(token);
				if (mode === "valid")
					expect(JSON.parse(result.stdout)).toMatchObject({ status: "configuration-valid", missingKeys: [] });
				else if (mode === "missing-key")
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
