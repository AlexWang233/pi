// Local-provider policy and actual Pi streaming are checked without a downloaded model or paid endpoint.
import { createServer } from "node:http";
import { createModels } from "@earendil-works/pi-ai/models";
import { describe, expect, it } from "vitest";
import { ollamaProvider } from "../src/ollama.ts";

describe("local Ollama composition", () => {
	it("refuses remote, credential-bearing and non-v1 endpoints", () => {
		for (const endpoint of [
			"https://example.com/v1",
			"http://example.com/v1",
			"http://user:secret@localhost/v1",
			"http://localhost/api",
			"http://localhost/v1?key=secret",
		]) {
			expect(() => ollamaProvider(["local-model"], endpoint)).toThrow("loopback");
		}
	});
	it("streams through Pi's compatible API with local placeholder auth and conservative capabilities", async () => {
		const requests: { authorization?: string; body: string }[] = [];
		const server = createServer(async (request, response) => {
			let body = "";
			for await (const chunk of request) body += String(chunk);
			requests.push({ authorization: request.headers.authorization, body });
			response.writeHead(200, { "Content-Type": "text/event-stream" });
			for (const delta of [{ content: "local answer" }, {}]) {
				response.write(
					`data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 0, model: "local-model", choices: [{ index: 0, delta, finish_reason: "content" in delta ? null : "stop" }] })}\n\n`,
				);
			}
			response.end("data: [DONE]\n\n");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Expected TCP address");
			const models = createModels();
			models.setProvider(ollamaProvider(["local-model"], `http://127.0.0.1:${address.port}/v1`));
			const model = models.getModel("ollama", "local-model")!;
			const result = await models
				.streamSimple(model, { messages: [{ role: "user", content: "Say hello", timestamp: 0 }] })
				.result();
			expect(result.stopReason).toBe("stop");
			expect(result.content).toEqual([{ type: "text", text: "local answer" }]);
			expect(requests).toHaveLength(1);
			expect(requests[0].authorization).toBe("Bearer ollama-local");
			expect(JSON.parse(requests[0].body)).toMatchObject({ model: "local-model", stream: true, max_tokens: 1024 });
			expect(JSON.parse(requests[0].body)).not.toHaveProperty("store");
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	});
});
