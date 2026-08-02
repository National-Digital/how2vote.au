#!/usr/bin/env node
/**
 * @fileoverview CI guard: AGPL corresponding-source + supply-chain integrity.
 *
 * Four fail-closed assertions bind the deployed application to its lawful, reproducible source:
 *   - action-pinning: every third-party GitHub Action referenced from a workflow or a composite
 *     action must be pinned to an immutable digest — a mutable tag/branch ref (@v4, @main) is a
 *     supply-chain hole and fails the build. The rule itself lives in check-action-pinning.mjs;
 *     this guard applies it so the AGPL/supply-chain control cannot pass while pinning is broken.
 *   - SBOM validity/completeness: the CycloneDX bill of materials (built in-memory from the
 *     lockfile) must be well-formed and non-empty — this is the machine-readable dependency
 *     manifest AGPL corresponding-source requires.
 *   - deployed-source link: a non-empty https://github.com/… source-repo URL must be published,
 *     proving the AGPL corresponding-source offer resolves to a real repository.
 *   - tool provisioning: a tool fetched inside a `run:` step must be pinned as tightly as an
 *     action — registry installs name an exact version (pip in hash-checking mode), and a
 *     downloaded artifact has its digest checked in the same step. An unpinned `pip install x`
 *     runs whatever the index serves that day, which no review can cover.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/git/CLI plumbing only runs
 * when the script is executed directly.
 *
 * Usage:
 *   node scripts/check-supply-chain.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSbom } from "./build-sbom.mjs";
// The pinning rule has one implementation, owned by the guard whose subject it is; a second copy
// here would be free to disagree with it about what counts as pinned.
import { gatherActionFiles, scanText, usesRef } from "./check-action-pinning.mjs";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * Every `run:` script in a workflow, with the line it starts on. Block scalars are collected by
 * indentation; a one-line `run:` is its own script. A dependency-free line scan: this guard must
 * run in CI with no install step of its own.
 *
 * @param {string} text
 * @returns {{ line: number, script: string }[]}
 */
export function extractRunScripts(text) {
  const lines = String(text).split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s*)?run:(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length + (/^\s*-\s/.test(lines[i]) ? 2 : 0);
    const rest = m[2].trim();
    if (rest !== "" && rest !== "|" && rest !== ">" && !/^[|>][-+]?\d*$/.test(rest)) {
      out.push({ line: i + 1, script: rest });
      continue;
    }
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "") {
        body.push("");
        continue;
      }
      const lead = /^\s*/.exec(lines[j])[0].length;
      if (lead <= indent) break;
      body.push(lines[j].trim());
    }
    out.push({ line: i + 1, script: body.join("\n") });
  }
  return out;
}

/**
 * Package-manager invocations that fetch a tool from a public registry at build time. `firstOnly`
 * marks the forms where the tokens after the package spec are that tool's own arguments
 * (`pnpm dlx <pkg> <args…>`) rather than more packages to install.
 */
const REGISTRY_INSTALLS = [
  { re: /(?:^|\s)(?:python3?\s+-m\s+)?pip3?\s+install\s+([^\n]*)/g, kind: "pip", firstOnly: false },
  {
    re: /(?:^|\s)npm\s+(?:install|i|add)\s+(?:-g|--global)\s+([^\n]*)/g,
    kind: "npm",
    firstOnly: false,
  },
  { re: /(?:^|\s)pnpm\s+add\s+(?:-g|--global)\s+([^\n]*)/g, kind: "pnpm", firstOnly: false },
  { re: /(?:^|\s)pnpm\s+dlx\s+([^\n]*)/g, kind: "pnpm dlx", firstOnly: true },
  { re: /(?:^|\s)gem\s+install\s+([^\n]*)/g, kind: "gem", firstOnly: true },
];

/**
 * Tool provisioning inside a workflow step: a build-time fetch of an unpinned tool is the same hole
 * as a mutable action ref — what runs is whatever upstream serves that day. Registry installs must
 * name an exact version (pip via a `--require-hashes` requirements file, or `pkg==x.y.z`), and a
 * downloaded artifact must have its digest checked in the same script.
 *
 * @param {string} script one run block
 * @param {string} where path:line for the message
 * @param {(m: string) => void} push
 */
function checkToolProvisioning(script, where, push) {
  // Comments carry example commands and prose; only executable lines are judged.
  const code = script
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");

  for (const { re, kind, firstOnly } of REGISTRY_INSTALLS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      const args = m[1].trim();
      let tokens = args.split(/\s+/).filter((t) => t !== "" && !t.startsWith("-"));
      if (firstOnly) tokens = tokens.slice(0, 1);
      if (kind === "pip" && /(?:^|\s)-r(?:\s|$)/.test(args)) {
        // A requirements file may hold the pins, but only hash-checking mode enforces them.
        if (!/--require-hashes/.test(code)) {
          push(
            `${where}: "pip install -r …" without --require-hashes — pip would accept whatever the ` +
              `index serves; pin every requirement with a --hash`,
          );
        }
        continue;
      }
      for (const token of tokens) {
        const pinned =
          kind === "pip"
            ? /==\S/.test(token)
            : kind === "gem"
              ? /(?:^|\s)(?:-v|--version)\s/.test(args)
              : /@\S/.test(token.replace(/^@/, ""));
        if (!pinned) {
          push(
            `${where}: ${kind} installs "${token}" unpinned — name the exact version, so the build ` +
              `cannot pick up a different tool than the one that was reviewed`,
          );
        }
      }
    }
  }

  // A download written to disk is executed or trusted later in the job, so its digest must be
  // checked here, where the expected value sits committed next to the URL. Piping a response
  // straight to stdout is not a download: nothing persists to be run later.
  //   curl  — writes only with -O or -o/--output <path>
  //   wget  — writes BY DEFAULT; only "-O -" (stdout) does not
  // The optional group must END in whitespace, so the flag is still matched when it is the first
  // argument (`curl -O url`).
  const curlWrote = /(?:^|\s)curl\s+(?:[^\n]*?\s)?(?:-O\b|(?:-o|--output)[= ]\s*(\S+))/m;
  const wgetToStdout = /(?:^|\s)wget\s[^\n]*?(?:-O\s*-(?:\s|$)|-\w*O-)/m;
  const wgetPresent = /(?:^|\s)wget\s/m;

  const curlMatch = curlWrote.exec(code);
  const target = curlMatch?.[1];
  const downloads =
    (curlMatch !== null && target !== "/dev/null" && target !== "-") ||
    (wgetPresent.test(code) && !wgetToStdout.test(code));

  if (downloads && !/sha256sum|shasum|sha256:/.test(code)) {
    push(
      `${where}: downloads ${target ? `"${target}"` : "a file"} with no digest check — verify it ` +
        `with sha256sum against a committed checksum in the same step`,
    );
  }
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
      for (const line of wf.text.split("\n")) {
        if (usesRef(line) !== null) usesSeen++;
      }
      for (const v of scanText(wf.path, wf.text)) {
        push(`${v.file}:${v.line}: action "${v.ref}" — ${v.reason}`);
      }
    }
    if (usesSeen === 0) push("workflows: no action references found (fail-closed)");

    let runsSeen = 0;
    for (const wf of workflows) {
      if (!wf || typeof wf.text !== "string" || !isNonEmptyString(wf.path)) continue;
      for (const { line, script } of extractRunScripts(wf.text)) {
        runsSeen++;
        checkToolProvisioning(script, `${wf.path}:${line}`, push);
      }
    }
    if (runsSeen === 0) push("workflows: no run steps found (fail-closed)");
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
  const workflows = gatherActionFiles();
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
