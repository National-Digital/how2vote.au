#!/usr/bin/env node
/**
 * @fileoverview CI guard: AGPL corresponding-source + supply-chain integrity.
 *
 * Three fail-closed assertions bind the deployed application to its lawful, reproducible source:
 *   - action-pinning: every third-party GitHub Action referenced from a workflow must be pinned
 *     to a full 40-hex commit SHA — a mutable tag/branch ref (@v4, @main) is a supply-chain hole
 *     and fails the build. Only LOCAL (`./…`) composite actions and reusable workflows are exempt;
 *     a remote reusable workflow is still required to be SHA-pinned.
 *   - SBOM validity/completeness: the CycloneDX bill of materials (built in-memory from the
 *     lockfile) must be well-formed and non-empty — this is the machine-readable dependency
 *     manifest AGPL corresponding-source requires.
 *   - deployed-source link: a non-empty https://github.com/… source-repo URL must be published,
 *     proving the AGPL corresponding-source offer resolves to a real repository.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/git/CLI plumbing only runs
 * when the script is executed directly.
 *
 * Usage:
 *   node scripts/check-supply-chain.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSbom } from "./build-sbom.mjs";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * Extract every `uses:` reference from a workflow's YAML text. A dependency-free line scan is
 * sufficient — `uses:` values are single tokens on their own line.
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractUses(text) {
  const out = [];
  for (const raw of String(text).split("\n")) {
    const m = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(raw);
    if (m) {
      let ref = m[1];
      if (
        (ref.startsWith('"') && ref.endsWith('"')) ||
        (ref.startsWith("'") && ref.endsWith("'"))
      ) {
        ref = ref.slice(1, -1);
      }
      out.push(ref);
    }
  }
  return out;
}

/**
 * Validate supply-chain integrity.
 *
 * @param {{
 *   workflows: { path: string, text: string }[],
 *   sbom: unknown,
 *   sourceRepoUrl: unknown,
 * }} input
 * @param {object} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input) {
  const errors = [];
  const push = (m) => errors.push(m);

  const workflows = Array.isArray(input?.workflows) ? input.workflows : null;
  if (workflows === null || workflows.length === 0) {
    // A repo with CI always has at least one workflow; an empty list means the gather step found
    // nothing, so treat it as a failure rather than a vacuous pass.
    push("workflows: none found (fail-closed)");
  } else {
    let usesSeen = 0;
    for (const wf of workflows) {
      if (!wf || typeof wf.text !== "string" || !isNonEmptyString(wf.path)) {
        push("workflow: malformed entry (expected { path, text })");
        continue;
      }
      for (const ref of extractUses(wf.text)) {
        usesSeen++;
        // Local (`./…`) composite actions and reusable workflows are trusted (same repo). A REMOTE
        // reusable workflow (owner/repo/.github/workflows/x.yml@ref) is still required to be pinned.
        if (ref.startsWith("./")) continue;
        const at = ref.lastIndexOf("@");
        if (at < 0) {
          push(`${wf.path}: action "${ref}" is not pinned to a commit SHA`);
          continue;
        }
        const version = ref.slice(at + 1);
        if (!SHA_RE.test(version)) {
          push(
            `${wf.path}: action "${ref}" must be pinned to a 40-hex commit SHA, not "${version}"`,
          );
        }
      }
    }
    if (usesSeen === 0) push("workflows: no action references found (fail-closed)");
  }

  // SBOM validity/completeness.
  const sbom = input?.sbom;
  if (typeof sbom !== "object" || sbom === null || Array.isArray(sbom)) {
    push("sbom: not an object (fail-closed)");
  } else {
    if (sbom.bomFormat !== "CycloneDX") {
      push(`sbom: bomFormat must be "CycloneDX", got ${JSON.stringify(sbom.bomFormat)}`);
    }
    if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
      push("sbom: components must be a non-empty array");
    }
  }

  // Deployed-source link (AGPL corresponding-source offer resolves to a real repo).
  const url = input?.sourceRepoUrl;
  if (!isNonEmptyString(url)) {
    push("sourceRepoUrl: missing (AGPL corresponding-source link is required)");
  } else if (!/^https:\/\/github\.com\/[^\s]+$/.test(url.trim())) {
    push(`sourceRepoUrl: must be an https://github.com/… URL, got ${JSON.stringify(url)}`);
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);
const rel = (p) => new URL(p, root);

function gatherWorkflows() {
  const listed = execFileSync("git", ["ls-files", ".github/workflows"], {
    cwd: fileURLToPath(root),
    encoding: "utf8",
  })
    .split("\n")
    .filter((p) => /\.ya?ml$/.test(p));
  return listed.map((p) => ({ path: p, text: readFileSync(rel(p), "utf8") }));
}

/** Read the exported SOURCE_REPO_URL literal without importing the TS module. */
function readSourceRepoUrl() {
  try {
    const src = readFileSync(rel("apps/web/src/lib/structured-data.ts"), "utf8");
    const m = /SOURCE_REPO_URL\s*=\s*["']([^"']+)["']/.exec(src);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function main() {
  const workflows = gatherWorkflows();
  let sbom;
  try {
    sbom = buildSbom({ lockText: readFileSync(rel("pnpm-lock.yaml"), "utf8") });
  } catch (err) {
    console.error(`::error::supply-chain: ${err.message}`);
    process.exit(1);
  }
  const sourceRepoUrl = readSourceRepoUrl();

  const result = verdict({ workflows, sbom, sourceRepoUrl });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::supply-chain: ${e}`);
    console.error(`supply chain: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info(
    `supply chain OK — ${workflows.length} workflow(s) pinned, SBOM ${sbom.components.length} components, source ${sourceRepoUrl}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
