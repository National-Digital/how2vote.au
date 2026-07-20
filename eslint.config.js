// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import tsdoc from "eslint-plugin-tsdoc";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.svelte-kit/**",
      "**/coverage/**",
      "**/node_modules/**",
      "data/raw/**",
      "**/.claude/**",
      "**/playwright-report/**",
      "**/test-results/**",
      // svelte-eslint-parser cannot parse the `{@html `…<script>…</script>`}` JSON-LD injection
      // pattern (inline </script> inside a template literal confuses its script-block split). These
      // three files use exactly that pattern; every other .svelte file is linted.
      "apps/web/src/lib/components/JsonLd.svelte",
      "apps/web/src/lib/components/StructuredData.svelte",
      "apps/web/src/routes/insights/+page.svelte",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Parse .svelte files so the core JS/TS rules (unused vars, eqeqeq, no-console, …) reach component
  // <script> blocks, which were previously unparsed and so entirely unlinted. We register the Svelte
  // parser + plugin but deliberately do NOT adopt the full `svelte/recommended` ruleset: it is largely
  // opinionated SvelteKit style guidance (e.g. no-navigation-without-resolve) rather than correctness,
  // and would swamp the signal. Real bugs (undefined refs, unused code) are what we want caught here.
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    plugins: { svelte },
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      // svelte-check + tsc are the reference/type checkers for components (and tseslint disables
      // no-undef for .ts for the same reason); leaving it on here only flags browser globals
      // (window, navigator, KeyboardEvent, …) as false positives.
      "no-undef": "off",
    },
  },
  {
    // Node scripts (build/CI tooling) run in the Node runtime.
    files: ["**/*.mjs", "**/*.cjs", "**/scripts/**/*.js"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        Buffer: "readonly",
      },
    },
  },
  // ── Module boundaries (modular-monolith / functional-core enforcement) ──────────────────────────
  // The package layer has crisp, deliberate interfaces: data-schema is a leaf domain package; the
  // engine is a pure functional core over it; the data-pipeline is build-time only; the web app is the
  // imperative shell. These no-restricted-imports zones make those seams mechanical instead of
  // conventional. (no-restricted-imports matches the literal import specifier, so it enforces the
  // layering without a module resolver — unlike eslint-plugin-boundaries, which cannot resolve the
  // pnpm-workspace `@how2vote/*` graph or the SvelteKit `$lib` alias without a native-build resolver
  // that the repo's supply-chain policy (onlyBuiltDependencies) deliberately blocks.)

  // Keep the functional core pure: the engine must take explicit inputs and do no I/O. No node
  // built-ins, no app-shell aliases, no data-pipeline — only @how2vote/data-schema + sibling modules.
  {
    files: ["packages/engine/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "node:*",
                "fs",
                "fs/*",
                "path",
                "@how2vote/data-pipeline",
                "$lib/*",
                "$app/*",
                "$data/*",
              ],
              message:
                "The engine is a pure functional core: no I/O, node built-ins, app-shell or data-pipeline imports. It may import only @how2vote/data-schema and sibling engine modules.",
            },
          ],
        },
      ],
    },
  },
  // data-schema is a leaf: it must not reach up into other workspace packages or the app.
  {
    files: ["packages/data-schema/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@how2vote/engine", "@how2vote/data-pipeline", "$lib/*", "$app/*", "$data/*"],
              message:
                "data-schema is a leaf domain package; it must not import other workspace packages or the app.",
            },
          ],
        },
      ],
    },
  },
  // The web app is the imperative shell; it must never pull the build-time data pipeline into a bundle.
  {
    files: ["apps/web/**/*.{ts,js,svelte}"],
    ignores: ["**/*.test.*", "**/*.spec.*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@how2vote/data-pipeline", "@how2vote/data-pipeline/*"],
              message:
                "The web app must not import the build-time data pipeline (Node/fs tooling). Import compiled data from $data/dist, or the @how2vote/data-schema / @how2vote/engine public APIs.",
            },
          ],
        },
      ],
    },
  },
  // Doc comments follow the TSDoc standard (tsdoc.org). This lints only that the /** */ blocks we
  // write are well-formed TSDoc — it never requires a comment to be present, so it does not
  // manufacture the boilerplate this project deliberately avoids. Scoped to TypeScript source; the
  // .mjs build/CI scripts use Closure-style @fileoverview headers, a separate established convention.
  {
    files: ["**/*.ts", "**/*.svelte.ts"],
    plugins: { tsdoc },
    rules: {
      "tsdoc/syntax": "warn",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
  },
);
