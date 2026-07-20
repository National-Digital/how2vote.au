import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@how2vote/data-schema": fileURLToPath(
        new URL("../data-schema/src/index.ts", import.meta.url),
      ),
    },
  },
});
