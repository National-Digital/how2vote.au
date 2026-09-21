import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Builds the engine into a single script the native iOS core evaluates in JavaScriptCore
 * (ADR 0018 D2).
 *
 * JavaScriptCore's `JSContext` evaluates plain scripts, not ES modules, so the output is an IIFE
 * that hangs one global off the context. Everything the engine touches is inlined: the bundle has
 * to be self-contained because there is no module loader, no bundler runtime and no network on the
 * other side. `scripts/check-engine-bundle.mjs` asserts all of that, and asserts the result still
 * reproduces the committed golden artifacts.
 *
 * Deliberately NOT minified. The bundle is legally-consequential logic that a reviewer or an
 * F-Droid-style auditor may want to read against the source, and the size saved is irrelevant next
 * to a dataset that is 300 KB on its own.
 *
 * Run from `apps/web`, which is where vite is a declared dependency:
 *   pnpm -C apps/web exec vite build --config ../../packages/engine/vite.native.config.ts
 */
export default defineConfig({
  root: resolve(import.meta.dirname),
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/native.ts"),
      name: "How2VoteEngine",
      formats: ["iife"],
      fileName: () => "how2vote-engine.js",
    },
    outDir: resolve(import.meta.dirname, "dist-native"),
    emptyOutDir: true,
    minify: false,
    // The bundle runs in JavaScriptCore on the minimum iOS target (17), whose engine is well ahead
    // of this baseline; es2020 keeps the output readable rather than down-levelled into helpers.
    target: "es2020",
    reportCompressedSize: false,
  },
});
