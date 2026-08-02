#!/usr/bin/env node
/**
 * @fileoverview CI guard: every GitHub Actions `uses:` reference is pinned to an immutable digest.
 *
 * Governing principle: FAIL CLOSED. A third-party action referenced by a mutable tag or branch
 * (`@v4`, `@main`) is a supply-chain hole — the owner (or anyone who compromises them) can move the
 * tag to malicious code that then runs with this repository's token. Pinning to a full commit SHA
 * makes the reference immutable: the code that ran when the pin was reviewed is the only code that
 * can ever run under it. Dependabot still proposes SHA bumps, so pinning does not freeze updates —
 * it just routes every update through review. This matters most for a PUBLIC repo, where forks and
 * drive-by PRs run these same workflows (see docs/self-hosting.md).
 *
 * Rules, per `uses:` reference:
 *   - `./path` local composite action .......... EXEMPT (its code is this repo, reviewed in the PR)
 *   - `docker://image@sha256:<digest>` .......... OK (digest-pinned container)
 *   - `owner/repo@<40-hex-sha>` .................. OK (commit-pinned action)
 *   - `owner/repo/sub/path@<40-hex-sha>` ......... OK (commit-pinned action subpath)
 *   - `owner/repo/.github/workflows/x.yml@<sha>`   OK (commit-pinned reusable workflow)
 *   - anything ending in a tag / branch / short sha .... FAIL (mutable — pin to the full SHA)
 *   - a reference built from a `${{ }}` expression ..... FAIL (cannot be statically verified)
 *
 * Pure decision logic is exported as scanText()/verdict() for unit tests; the fs/CLI plumbing runs
 * only when executed directly.
 *
 * Usage:
 *   node scripts/check-action-pinning.mjs        # scans .github/workflows + .github/actions
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A full git commit SHA: exactly 40 lowercase hex chars. Short shas and tags are rejected. */
const FULL_SHA = /^[0-9a-f]{40}$/;

/** A digest-pinned container reference, e.g. docker://alpine@sha256:<64-hex>. */
const DOCKER_DIGEST = /@sha256:[0-9a-f]{64}$/;

/**
 * Extract the `uses:` reference from a single workflow line, or null if the line is not a `uses:`.
 * Handles list-item (`- uses:`) and mapping (`uses:`) forms, optional quotes, and trailing
 * `# version` comments (the whole point of pinning is that the SHA carries a `# v4`-style comment).
 * @param {string} line
 * @returns {string|null}
 */
export function usesRef(line) {
  const m = /^\s*(?:-\s*)?uses:\s*(['"]?)([^'"#\s]+)\1/.exec(line);
  return m ? m[2] : null;
}

/**
 * Classify a single `uses:` reference.
 * @param {string} ref
 * @returns {{ ok: boolean, reason?: string }}
 */
export function classifyRef(ref) {
  // Local composite action — its code lives in this repo and is reviewed in the same PR.
  if (ref.startsWith("./") || ref.startsWith("../")) return { ok: true };

  // A reference assembled from an expression cannot be verified statically — reject it.
  if (ref.includes("${{")) {
    return {
      ok: false,
      reason: "built from a ${{ }} expression — cannot verify the pin statically",
    };
  }

  // Digest-pinned container image.
  if (ref.startsWith("docker://")) {
    return DOCKER_DIGEST.test(ref)
      ? { ok: true }
      : { ok: false, reason: "docker image is not pinned by @sha256:<digest>" };
  }

  const at = ref.lastIndexOf("@");
  if (at === -1) {
    return { ok: false, reason: "no version pin at all — pin to a full 40-char commit SHA" };
  }
  const pin = ref.slice(at + 1);
  if (FULL_SHA.test(pin)) return { ok: true };

  return {
    ok: false,
    reason: `pinned to "${pin}" (a tag/branch/short-sha, which is mutable) — pin to a full 40-char commit SHA`,
  };
}

/**
 * Scan one workflow file's text for unpinned `uses:` references.
 * @param {string} path  display path (for messages)
 * @param {string} text  file contents
 * @returns {Array<{ file: string, line: number, ref: string, reason: string }>}
 */
export function scanText(path, text) {
  const violations = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ref = usesRef(lines[i]);
    if (ref === null) continue;
    const verdictForRef = classifyRef(ref);
    if (!verdictForRef.ok) {
      violations.push({ file: path, line: i + 1, ref, reason: verdictForRef.reason });
    }
  }
  return violations;
}

/**
 * @param {Array<{ path: string, text: string }>} files
 * @returns {{ ok: boolean, violations: Array<{ file: string, line: number, ref: string, reason: string }> }}
 */
export function verdict(files) {
  const violations = files.flatMap((f) => scanText(f.path, f.text));
  return { ok: violations.length === 0, violations };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);

/**
 * Every file whose `uses:`/`run:` steps GitHub executes: the workflows AND the composite actions
 * they call. A composite action's steps run with the same token and privileges, so leaving them
 * out under-enforces every rule applied here. Tracked files only — an untracked local YAML is not
 * what CI runs. Shared with check-supply-chain.mjs so the two guards cannot scan different sets.
 *
 * @returns {Array<{ path: string, text: string }>}
 */
export function gatherActionFiles() {
  const listed = execFileSync("git", ["ls-files", ".github/workflows", ".github/actions"], {
    cwd: fileURLToPath(root),
    encoding: "utf8",
  })
    .split("\n")
    .filter((p) => /\.ya?ml$/.test(p));
  return listed.map((p) => ({ path: p, text: readFileSync(new URL(p, root), "utf8") }));
}

function main() {
  let files;
  try {
    files = gatherActionFiles();
  } catch (err) {
    console.error(
      `::error::action-pinning: cannot list .github workflow/action files: ${err.message}`,
    );
    process.exit(1);
    return;
  }

  const result = verdict(files);
  if (!result.ok) {
    for (const v of result.violations) {
      // GitHub renders file/line annotations from this format.
      console.error(`::error file=${v.file},line=${v.line}::${v.ref} — ${v.reason}`);
    }
    console.error(
      `action pinning: ${result.violations.length} unpinned action reference(s). ` +
        `Pin each to a full commit SHA (keep the # vX comment). See docs/self-hosting.md.`,
    );
    process.exit(1);
    return;
  }
  console.info(
    `action pinning OK — every uses: across ${files.length} workflow/action file(s) is ` +
      `digest/commit-pinned`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
