import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for pure app modules. The SvelteKit plugin is intentionally omitted — component and
// full-flow behaviour is covered by the Playwright e2e suite (test:e2e), not here. The two SvelteKit
// path aliases the tested modules rely on are re-declared so vitest can resolve them without the
// plugin: `$lib` (app code) and `$data` (the committed datasets, used by content.server.ts / webmcp.ts).
export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
      $data: fileURLToPath(new URL("../../data", import.meta.url)),
      // PUBLIC_ env reads resolve to an empty map in unit tests (the "unset" build state), so
      // modules like channel.ts are importable and their fallbacks are what gets exercised.
      "$env/dynamic/public": fileURLToPath(
        new URL("./test-support/env-public.ts", import.meta.url),
      ),
      // Same reason: the SvelteKit plugin is omitted, so `browser`/`dev` need a stand-in for the
      // on-device modules (privacy/local-data.ts, native-storage.ts) to be importable here.
      "$app/environment": fileURLToPath(
        new URL("./test-support/app-environment.ts", import.meta.url),
      ),
    },
  },
  test: {
    // App modules under src/, the pure/exported helpers of the build-time generators, and the
    // pure validators of the Pages Functions under functions/.
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "functions/**/*.test.ts"],
  },
});
