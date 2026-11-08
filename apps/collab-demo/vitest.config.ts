// Run only explicitly selected deterministic demo tests, with workspace source exports.
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: { environment: "node", include: ["test/*.test.ts"] },
	resolve: { conditions: ["source"] },
	ssr: { resolve: { conditions: ["source"] } },
});
