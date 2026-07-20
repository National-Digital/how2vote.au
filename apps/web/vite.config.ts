import { sveltekit } from "@sveltejs/kit/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [sveltekit()],
  // Copyright year, frozen at build time. `new Date()` here runs in Node when the config is loaded
  // — i.e. when the site is built — so the value reflects the last build (the last time anything
  // changed) rather than the visitor's clock. A rebuild advances it; a stale, un-rebuilt deploy
  // keeps showing the year it was actually built. This is the real build-time derivation the footer
  // credit needs: `new Date().getFullYear()` in the component would re-run in the browser at render
  // time and always show the current year.
  define: {
    __BUILD_YEAR__: JSON.stringify(new Date().getFullYear()),
  },
  server: {
    // Allow importing the committed dataset from the repo-root data/ directory.
    fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] },
  },
});
