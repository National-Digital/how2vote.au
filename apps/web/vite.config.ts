import { sveltekit } from "@sveltejs/kit/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [sveltekit()],
  // Pin the emitted-syntax floor to the real support matrix (docs/store-distribution.md). Vite's
  // default "baseline-widely-available" floor (~Safari 16.4) sits ABOVE the native shells'
  // deployment targets — iOS 15 WKWebView and old Android System WebView would hit a SyntaxError
  // on modern syntax. These targets keep one bundle safe for the web PWA and both shells.
  build: {
    target: ["es2021", "safari15", "chrome99"],
    // terser, not esbuild's minifier: two passes compress this bundle ~4% smaller gzipped, which
    // is what keeps the JS budget (budgets.json) holding on the vite 7 line — and it is pure JS,
    // so the F-Droid closure stays free of prebuilt binaries.
    minify: "terser",
    terserOptions: { compress: { passes: 2 } },
  },
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
