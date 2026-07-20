import { defineConfig } from "vitest/config";

// Tests for the repo's CI/deploy tooling in scripts/. Deliberately NOT named
// vitest.config.* so the workspace packages (run via `pnpm -r test`) don't
// auto-discover it by walking up the tree — it is loaded only via the explicit
// `--config` in the root "test" script.
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.mjs"],
  },
});
