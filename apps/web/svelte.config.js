import process from "node:process";
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { mergeRegistryCsp } from "./src/lib/privacy/csp.js";

// Hand-owned base Content-Security-Policy: the first-party ('self') tokens and keywords every
// policy shares. Third-party origins are NOT listed here — they are merged in from the
// third-party services registry (src/lib/privacy/third-party-services.json) by mergeRegistryCsp,
// so the CSP can never allow more (or less) than the registry declares (the same registry drives
// the consent UI and the privacy-policy inventory). Add a domain by editing the registry, not here.
const BASE_CSP = {
  "default-src": ["self"],
  "script-src": ["self"],
  // Svelte 5 sets inline style attributes at runtime for transitions/animations, so style-src needs
  // 'unsafe-inline'. Low risk given script-src is hash-locked (no unsafe-eval).
  "style-src": ["self", "unsafe-inline"],
  "img-src": ["self", "data:"],
  "font-src": ["self"],
  "connect-src": ["self"],
  "media-src": ["none"],
  "manifest-src": ["self"],
  "worker-src": ["self"],
  "child-src": ["none"],
  "frame-src": ["none"],
  "base-uri": ["none"],
  "form-action": ["none"],
  "object-src": ["none"],
};

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Fully static output for Cloudflare Pages. Every route is prerendered (see +layout.ts);
    // all interactivity, scoring and the card run client-side after hydration.
    adapter: adapter({ pages: "build", assets: "build", fallback: "404.html", strict: true }),
    // Strict Content-Security-Policy, emitted per-page as a <meta> tag. SvelteKit hashes the inline
    // hydration script (mode "hash"); that hash differs per prerendered page, so the policy cannot be
    // a single static header — it lives here. Header-only directives that <meta> cannot express
    // (frame-ancestors, upgrade-insecure-requests) are set alongside in static/_headers.
    // Third-party origins come from the registry via mergeRegistryCsp. Today NO browser-loaded
    // third party exists at all (the anti-abuse challenge is self-hosted and the forms post to our
    // own /api/forms), so the merge adds nothing; usage is measured cookielessly by Cloudflare Web
    // Analytics at the edge, so no analytics origin appears in the client CSP either.
    csp: {
      mode: "hash",
      directives: mergeRegistryCsp(BASE_CSP),
    },
    alias: {
      $data: "../../data",
      $docs: "../../docs",
    },
    // App version, surfaced via $app/environment `version` and the $service-worker cache name
    // (how2vote-<version>). CI injects the computed semver as APP_VERSION at build time
    // (scripts/next-version.mjs); local builds fall back to a dev marker.
    version: {
      name: process.env.APP_VERSION ?? "0.0.0-dev",
    },
  },
};

export default config;
