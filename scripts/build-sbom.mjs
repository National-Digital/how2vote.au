#!/usr/bin/env node
/**
 * @fileoverview Generate a deterministic CycloneDX 1.5 SBOM from pnpm-lock.yaml
 * (AGPL corresponding-source + supply chain).
 *
 * AGPL-3.0 obliges us to convey the Corresponding Source of the deployed application, which
 * includes the exact versions of every bundled dependency. This SBOM is that machine-readable
 * bill of materials. It is derived by a dependency-free line parse of the lockfile's `packages:`
 * section (every resolved package appears there exactly once as `name@version`), so it needs no
 * third-party YAML parser and stays reproducible: components are sorted and no timestamp is
 * emitted, so regenerating from the same lockfile yields byte-identical output.
 *
 * Pure logic (parseLockPackages / buildSbom) is exported for unit tests and for the supply-chain
 * guard, which builds the SBOM in-memory; the fs/CLI plumbing only runs when executed directly.
 *
 * Usage:
 *   node scripts/build-sbom.mjs [--out <path>]      # default: stdout
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Parse the `packages:` section of a pnpm-lock.yaml (lockfileVersion 9) into a flat list of
 * resolved dependencies. Package keys sit at exactly two-space indent and end with `:`; each is
 * `name@version` (scoped names are `@scope/name@version`, optionally single-quoted). Sub-fields
 * (resolution, engines, peerDependencies, …) are more deeply indented and are ignored.
 *
 * @param {string} lockText  raw contents of pnpm-lock.yaml
 * @returns {{ name: string, version: string }[]}
 */
/** The pnpm lockfileVersion this parser is validated against. */
export const SUPPORTED_LOCKFILE_MAJOR = 9;

/** The integer major of a lockfile's `lockfileVersion:` header, or null if absent/unrecognised. */
export function lockfileMajor(lockText) {
  const m = /^lockfileVersion:\s*['"]?(\d+)/m.exec(String(lockText));
  return m ? Number(m[1]) : null;
}

export function parseLockPackages(lockText) {
  const lines = String(lockText).split("\n");
  const out = [];
  let inPackages = false;
  for (const line of lines) {
    if (!inPackages) {
      if (line === "packages:") inPackages = true;
      continue;
    }
    // A non-indented, non-blank line ends the section (e.g. `snapshots:`).
    if (line.trim() !== "" && !/^\s/.test(line)) break;
    // Package keys: exactly two-space indent, then a non-space, ending in `:`.
    const m = /^ {2}(?! )(.+):$/.exec(line);
    if (!m) continue;
    let key = m[1].trim();
    if (key.startsWith("'") && key.endsWith("'")) key = key.slice(1, -1);
    else if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1);
    // Split on the LAST '@' so scoped names keep their leading '@scope/'.
    const at = key.lastIndexOf("@");
    if (at <= 0) continue;
    const name = key.slice(0, at);
    const version = key.slice(at + 1);
    if (!name || !version) continue;
    out.push({ name, version });
  }
  return out;
}

/**
 * Build a CycloneDX 1.5 SBOM object from a pnpm-lock.yaml. Components are de-duplicated and sorted
 * (name, then version) so the output is deterministic; no timestamp is emitted for reproducibility.
 *
 * @param {{ lockText: string }} input
 * @returns {{ bomFormat: string, specVersion: string, version: number, components: object[] }}
 */
export function buildSbom({ lockText }) {
  // Fail closed on a lockfile-format bump: the two-space-key / split-on-last-@ parse is validated
  // only for lockfileVersion 9. A later format (e.g. peer-dep suffixes back in package keys) would
  // misparse silently into a non-empty but wrong SBOM, so refuse anything but v9.
  const major = lockfileMajor(lockText);
  if (major !== SUPPORTED_LOCKFILE_MAJOR) {
    throw new Error(
      `unsupported pnpm lockfileVersion ${major ?? "(unknown)"} — the SBOM parser is validated only for v${SUPPORTED_LOCKFILE_MAJOR}`,
    );
  }
  const byKey = new Map();
  for (const { name, version } of parseLockPackages(lockText)) {
    const key = `${name}@${version}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      type: "library",
      name,
      version,
      // purl spec: the "@" that introduces a scope must be percent-encoded (%40); the "/" and the
      // "@version" separator stay literal. e.g. @how2vote/engine → pkg:npm/%40how2vote/engine@1.0.0
      purl: `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`,
    });
  }
  // Locale-independent (code-unit) ordering so the SBOM is byte-identical on every host — a locale
  // aware localeCompare would reorder scoped names / punctuation differently across environments.
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const components = [...byKey.values()].sort(
    (a, b) => cmp(a.name, b.name) || cmp(a.version, b.version),
  );
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    components,
  };
}

/* c8 ignore start -- CLI plumbing, exercised via CI not unit tests */
const LOCK_PATH = new URL("../pnpm-lock.yaml", import.meta.url);

function main() {
  const args = process.argv.slice(2);
  let out = null;
  for (let i = 0; i < args.length; i++) if (args[i] === "--out") out = args[++i];

  let lockText;
  try {
    lockText = readFileSync(LOCK_PATH, "utf8");
  } catch (err) {
    console.error(`::error::cannot read pnpm-lock.yaml: ${err.message}`);
    process.exit(1);
  }
  const sbom = buildSbom({ lockText });
  const json = `${JSON.stringify(sbom, null, 2)}\n`;
  if (out) {
    writeFileSync(out, json);
    console.info(`SBOM written to ${out} (${sbom.components.length} components)`);
  } else {
    process.stdout.write(json);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
