#!/usr/bin/env node
/**
 * @fileoverview Generate the public "Security controls" wording in SECURITY.md from the machine-
 * readable security register.
 *
 * The register (docs/legal/security-register.json) carries a tested/evidenced publicStatement for
 * each control. Rather than hand-maintain the public wording (which could overstate what is actually
 * enforced), this generator renders it from the register between two markers in SECURITY.md:
 *   `--write` rewrites the block in place; `--check` (default, run in CI) fails if the committed
 *   block has drifted from what the register would produce.
 *
 * Everything outside the marked block (reporting channel, scope, promises) is authored by hand and
 * preserved byte-for-byte.
 *
 * The pure renderer is exported as renderBlock()/compose() for unit tests; fs/CLI runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/generate-security-md.mjs            # check (fail on drift)
 *   node scripts/generate-security-md.mjs --write    # rewrite the generated block from the register
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const BEGIN =
  "<!-- BEGIN GENERATED SECURITY CONTROLS (scripts/generate-security-md.mjs) -->";
export const END = "<!-- END GENERATED SECURITY CONTROLS -->";

/**
 * Render the generated Markdown block (including the BEGIN/END markers) from the register.
 * @param {any} register parsed docs/legal/security-register.json
 * @returns {string}
 */
export function renderBlock(register) {
  const out = [];
  const p = (s = "") => out.push(s);

  p(BEGIN);
  p("");
  p(
    "_Generated from `docs/legal/security-register.json` — do not edit by hand. Run `pnpm security:generate`; CI fails if this drifts from the register._",
  );
  p("");
  p("The following security controls are enforced or evidenced for this project:");
  p("");
  for (const c of register.controls ?? []) {
    p(`- **${c.title}.** ${c.publicStatement}`);
  }
  p("");
  const sev = (register.vulnerabilityPolicy?.blockSeverities ?? []).join(" or ");
  p(
    `Dependency vulnerabilities at ${sev || "high or critical"} severity block deployment; the block ` +
      "can only be waived by a signed, time-limited risk acceptance recorded in the register, and an " +
      "expired or missing acceptance fails closed.",
  );
  p("");
  p(END);
  return out.join("\n");
}

/** Compose the full SECURITY.md: preserve everything outside the markers, replace the block. */
export function compose(register, existing) {
  const begin = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      "SECURITY.md is missing the generated-block markers (BEGIN/END GENERATED SECURITY CONTROLS)",
    );
  }
  const before = existing.slice(0, begin);
  const after = existing.slice(end + END.length);
  return before + renderBlock(register) + after;
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);
const FILE = new URL("SECURITY.md", root);
const REGISTER = new URL("docs/legal/security-register.json", root);

function main() {
  const write = process.argv.includes("--write");
  let register, existing;
  try {
    register = JSON.parse(readFileSync(REGISTER, "utf8"));
    existing = readFileSync(FILE, "utf8");
  } catch (err) {
    console.error(`::error::security-md: cannot read inputs: ${err.message}`);
    process.exit(1);
    return;
  }
  let next;
  try {
    next = compose(register, existing);
  } catch (err) {
    console.error(`::error::security-md: ${err.message}`);
    process.exit(1);
    return;
  }
  if (write) {
    writeFileSync(FILE, next);
    console.info("SECURITY.md security-controls block regenerated from the security register");
    return;
  }
  if (next !== existing) {
    console.error(
      "::error::security-md: SECURITY.md is out of date with docs/legal/security-register.json — run `pnpm security:generate`",
    );
    process.exit(1);
    return;
  }
  console.info("SECURITY.md is in sync with the security register");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
