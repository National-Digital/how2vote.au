#!/usr/bin/env node
/**
 * @fileoverview Deploy the SvelteKit static build to Cloudflare Pages.
 *
 * The build output (apps/web/build) already carries its own _headers file
 * (security headers + Cache-Control) and the per-page CSP <meta> tags emitted
 * by SvelteKit, so there is no edge Worker, no _redirects generation and no
 * header injection to do here. This script just points wrangler at the
 * finished build.
 *
 *   CF_PAGES_BRANCH=main   -> production deploy (the live site, how2vote.au)
 *   CF_PAGES_BRANCH=pr-123 -> isolated preview at pr-123.how2vote-au.pages.dev
 *
 * wrangler is a pinned devDependency of tools/deploy (kept out of the app-build
 * closures the F-Droid buildserver installs), so the locked version is run via
 * tools/deploy's own bin dir and fails fast if it is missing — never a floating
 * version silently fetched from the registry with the CF token in env.
 *
 * Environment:
 *   CLOUDFLARE_ACCOUNT_ID  (required)
 *   CLOUDFLARE_API_TOKEN   (required — scoped token with "Cloudflare Pages: Edit")
 *   CF_PAGES_PROJECT       (default: how2vote-au)
 *   CF_PAGES_BRANCH        (default: main)
 *
 * Usage:
 *   pnpm build && pnpm deploy:cloudflare               # production (main)
 *   CF_PAGES_BRANCH=pr-123 pnpm deploy:cloudflare      # a preview
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const WEB_DIR = join(REPO_ROOT, "apps", "web");
const BUILD_DIR = join(WEB_DIR, "build");
// wrangler lives in tools/deploy, outside the app-build closures, so it is addressed by its own
// bin path — `pnpm exec` from apps/web cannot see another workspace package's binaries.
const WRANGLER = join(REPO_ROOT, "tools", "deploy", "node_modules", ".bin", "wrangler");

const project = process.env.CF_PAGES_PROJECT || "how2vote-au";
const branch = process.env.CF_PAGES_BRANCH || "main";

function main() {
  if (!existsSync(BUILD_DIR)) {
    console.error("❌ apps/web/build not found — run `pnpm build` first.");
    process.exit(1);
  }
  if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.error("❌ CLOUDFLARE_ACCOUNT_ID is not set.");
    process.exit(1);
  }

  // Production (branch "main") deploys FROM apps/web so wrangler reads wrangler.toml
  // (pages_build_output_dir = "build") and ships BOTH the static build AND the adjacent functions/
  // directory with its D1 + KV bindings — the earlier repo-root deploy of the bare build/ dir shipped
  // only static assets, leaving /api/research unreachable. The real D1/KV ids are injected into
  // wrangler.toml from CI variables just before this step (the infra-config gate enforces they are not
  // placeholders on production).
  //
  // PR PREVIEWS (branch "pr-<n>") deploy the static build ONLY, from the repo root with NO config:
  // preview builds carry placeholder binding ids in the committed wrangler.toml (the id-injection step
  // is production-only), and wrangler would reject those — and a preview does not need the research
  // functions. This mirrors the original static-only preview behaviour.
  const isProduction = branch === "main";
  console.info(
    `→ deploying to Cloudflare Pages (project: ${project}, branch: ${branch}, ${
      isProduction ? "with functions + bindings" : "static only"
    })`,
  );
  const args = isProduction
    ? [
        "pages",
        "deploy",
        "build",
        "--project-name",
        project,
        "--branch",
        branch,
        "--commit-dirty=true",
      ]
    : [
        "pages",
        "deploy",
        BUILD_DIR,
        "--project-name",
        project,
        "--branch",
        branch,
        "--commit-dirty=true",
      ];
  if (!existsSync(WRANGLER)) {
    console.error(`❌ ${WRANGLER} not found — run pnpm install (tools/deploy holds wrangler).`);
    process.exit(1);
  }
  execFileSync(WRANGLER, args, {
    stdio: "inherit",
    // Production reads wrangler.toml (functions + bindings) from apps/web; a preview deploys the build
    // dir from the repo root with no config, so no wrangler.toml is picked up.
    cwd: isProduction ? WEB_DIR : REPO_ROOT,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
}

// Only deploy when run directly; importing (e.g. tests) just gets the module.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
