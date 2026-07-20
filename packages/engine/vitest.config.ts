import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve the workspace dependency to its TypeScript source so tests run without a prior build.
export default defineConfig({
  resolve: {
    alias: {
      "@how2vote/data-schema": fileURLToPath(
        new URL("../data-schema/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // index.ts is a re-export barrel with no logic to cover.
      exclude: ["src/index.ts", "src/**/*.test.ts"],
      // The scoring/ballot/card engine is the deterministic core — keep it well covered.
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
