// Real stdio/process boundary coverage for the T3-backed driver, using a scripted local app-server.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createCodexDriver } from "../src/adapters/codex/index.ts";
import type { ExternalSession } from "../src/collaboration/index.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(mode: string, continuation: string | null = null) {
	const workspace = await mkdtemp(join(tmpdir(), "pi-codex-process-"));
	cleanups.push(() => rm(workspace, { recursive: true, force: true }));
	const log = join(workspace, "requests.txt");
	const controller = new AbortController();
	const script = fileURLToPath(new URL("./fixtures/codex-app-server.ts", import.meta.url));
	const driver = createCodexDriver({
		command: process.execPath,
		args: ["--experimental-strip-types", script, mode, log],
	});
	return {
		log,
		controller,
		open: () =>
			driver.open({
				workspace,
				agentId: "codex",
				model: null,
				instructions: "",
				continuation,
				signal: controller.signal,
			}),
	};
}

async function trackedSession(open: () => Promise<ExternalSession>) {
	const session = await open();
	cleanups.push(() => session.close());
	return session;
}

describe("Codex driver process lifecycle", () => {
	it.each(["success", "early-completion", "foreign-turn"])(
		"correlates the root result through actual JSONL stdio: %s",
		async (mode) => {
			const { open, controller, log } = await fixture(mode);
			const session = await trackedSession(open);
			expect(
				await session.run({ text: "hello", signal: controller.signal, progress: async () => {} }),
			).toMatchObject({ status: "completed", text: "expected answer" });
			await session.close();
			const lines = (await readFile(log, "utf8")).trim().split("\n");
			expect(lines.slice(1)).toEqual(["initialize", "initialized", "thread/start", "turn/start"]);
			// The PID was emitted by this fixture child; probing it does not signal or kill other processes.
			expect(() => process.kill(Number(lines[0]), 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
		},
	);

	it("resumes the supplied continuation rather than starting another thread", async () => {
		const { open, controller, log } = await fixture("success", "01a0d5eb-f0c0-7481-a417-5e8871805cbc");
		const session = await trackedSession(open);
		expect(
			await session.run({ text: "continue", signal: controller.signal, progress: async () => {} }),
		).toMatchObject({ status: "completed" });
		expect(await readFile(log, "utf8")).toContain("thread/resume\n");
	});

	it.each(["file-approval", "command-approval", "user-input", "unknown-request"])(
		"fails an unsupported interaction without approving it: %s",
		async (mode) => {
			const { open, controller } = await fixture(mode);
			const session = await trackedSession(open);
			expect(await session.run({ text: "work", signal: controller.signal, progress: async () => {} })).toMatchObject(
				{ status: "failed", reason: expect.stringMatching(/unsupported|interactive/i) },
			);
		},
	);

	it("reports an unexpected child exit with its diagnostic", async () => {
		const { open, controller } = await fixture("exit");
		const session = await trackedSession(open);
		await expect(session.run({ text: "work", signal: controller.signal, progress: async () => {} })).rejects.toThrow(
			/23.*scripted provider disappeared/,
		);
	});

	it("reports root turn failure without converting it into successful text", async () => {
		const { open, controller } = await fixture("failed-turn");
		const session = await trackedSession(open);
		expect(await session.run({ text: "work", signal: controller.signal, progress: async () => {} })).toEqual({
			status: "failed",
			reason: "scripted turn failure",
		});
	});

	it("keeps an item completion pending until the root turn ends", async () => {
		const { open, controller } = await fixture("item-only");
		const session = await trackedSession(open);
		const ready = Promise.withResolvers<void>();
		let settled = false;
		const running = session.run({
			text: "work",
			signal: controller.signal,
			progress: async (text) => {
				if (text.includes("item-only-ready")) ready.resolve();
			},
		});
		const observed = running.finally(() => {
			settled = true;
		});
		const rejected = expect(observed).rejects.toThrow();
		await ready.promise;
		expect(settled).toBe(false);
		controller.abort(new Error("stop after item"));
		await rejected;
	});

	it("rejects malformed JSONL rather than treating it as a successful result", async () => {
		const { open, controller } = await fixture("malformed");
		const session = await trackedSession(open);
		await expect(session.run({ text: "work", signal: controller.signal, progress: async () => {} })).rejects.toThrow(
			/decode-wire-message/,
		);
	});

	it("cleans up a process that exits during initialization", async () => {
		const { open, log } = await fixture("startup-exit");
		await expect(open()).rejects.toThrow(/17.*scripted initialization failure/);
		const pid = Number((await readFile(log, "utf8")).split("\n")[0]);
		expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
	});

	it("rejects a start response that disagrees with the initial notification", async () => {
		const { open, controller } = await fixture("mismatched-start");
		const session = await trackedSession(open);
		await expect(session.run({ text: "work", signal: controller.signal, progress: async () => {} })).rejects.toThrow(
			/does not match/,
		);
	});

	it.each(["interrupt", "interrupt-no-ack"])(
		"bounds the interrupt exchange before closing the child: %s",
		async (mode) => {
			const { open, controller, log } = await fixture(mode);
			const session = await trackedSession(open);
			const ready = Promise.withResolvers<void>();
			const running = session.run({
				text: "wait",
				signal: controller.signal,
				progress: async () => ready.resolve(),
			});
			const rejected = expect(running).rejects.toThrow();
			await ready.promise;
			controller.abort(new Error("stop requested"));
			await rejected;
			await session.close();
			const lines = await readFile(log, "utf8");
			expect(lines).toContain("turn/interrupt\n");
			if (mode === "interrupt") expect(lines).toContain("interrupt-ack\n");
			else expect(lines).not.toContain("interrupt-ack\n");
		},
	);
});
