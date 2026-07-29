#!/usr/bin/env node
/**
 * @fileoverview Runs a phase of the F-Droid recipe the way fdroidserver runs it.
 *
 * fdroidserver joins a phase's command list with "; " and executes the result as ONE shell, with
 * the working directory set to the recipe's `subdir`:
 *
 *   bash -e -u -o pipefail -x -c -- "<cmd>; <cmd>"   (cwd = <checkout>/<subdir>)
 *
 * The commands are read out of docs/fdroid/au.how2vote.app.yml, never restated here: running them
 * separately, from the repo root, or with a toolchain the recipe does not install verifies nothing.
 *
 * `sudo` is not run: it provisions the Node toolchain, which the CI runner already provides.
 * check-fdroid-ready.mjs asserts the version it would install matches .nvmrc.
 *
 * Usage:
 *   node scripts/fdroid-recipe-build.mjs prebuild --version 9.9.9 --code 90909000
 *   node scripts/fdroid-recipe-build.mjs build    --version 9.9.9 --code 90909000
 *   node scripts/fdroid-recipe-build.mjs build --print   # show the shell line, run nothing
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECIPE_REL = "docs/fdroid/au.how2vote.app.yml";
export const PHASES = ["prebuild", "build"];

/**
 * Extracts one build-block phase's commands. Deliberately a small line scanner rather than a YAML
 * dependency: this must read the same file the submitted recipe is generated from, in CI, with no
 * install step of its own.
 *
 * @param {string} recipe recipe file contents
 * @param {string} phase `prebuild` or `build`
 * @returns {string[]} commands in declaration order, with YAML line folding undone
 */
export function phaseCommands(recipe, phase) {
  const lines = recipe.split("\n");
  // Compared as a string, never compiled: phase reaches here from argv.
  const header = `    ${phase}:`;
  const start = lines.findIndex((l) => l.trimEnd() === header);
  if (start === -1) return [];
  /** @type {string[]} */
  const cmds = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s{0,4}\S/.test(line)) break; // dedented to the next key
    if (/^\s*#/.test(line) || line.trim() === "") continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item) {
      cmds.push(item[1].trim());
    } else if (cmds.length > 0) {
      // Continuation of a folded scalar: YAML rejoins wrapped lines with a single space.
      cmds[cmds.length - 1] += ` ${line.trim()}`;
    }
  }
  return cmds;
}

/** @param {string} recipe @returns {string} the recipe's build subdir */
export function subdir(recipe) {
  return recipe.match(/^\s*subdir:\s*(\S+)\s*$/m)?.[1] ?? ".";
}

/**
 * @param {string[]} cmds
 * @param {{version: string, code: string}} pair
 * @returns {string} the single shell line fdroidserver would execute
 */
export function shellLine(cmds, { version, code }) {
  return cmds.join("; ").replaceAll("$$VERSION$$", version).replaceAll("$$VERCODE$$", code);
}

/* c8 ignore start -- CLI/process plumbing */
function main() {
  const [phase] = process.argv.slice(2);
  if (!PHASES.includes(phase)) {
    console.error(`usage: fdroid-recipe-build.mjs <${PHASES.join("|")}> [--version v] [--code c]`);
    process.exit(2);
  }
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? fallback : process.argv[i + 1];
  };
  const recipe = readFileSync(join(ROOT, RECIPE_REL), "utf8");
  const cmds = phaseCommands(recipe, phase);
  if (cmds.length === 0) {
    console.error(`✗ ${RECIPE_REL}: no commands in the ${phase} phase`);
    process.exit(1);
  }
  const line = shellLine(cmds, { version: arg("version", "9.9.9"), code: arg("code", "90909000") });
  const cwd = join(ROOT, subdir(recipe));
  if (process.argv.includes("--print")) {
    console.info(line);
    return;
  }
  console.info(`▶ ${phase} in ${subdir(recipe)}\n  ${line}`);
  const { status } = spawnSync("bash", ["-e", "-u", "-o", "pipefail", "-x", "-c", "--", line], {
    cwd,
    stdio: "inherit",
  });
  if (status !== 0) {
    console.error(
      `✗ recipe ${phase} failed (exit ${status}) — the F-Droid buildserver would fail here`,
    );
    process.exit(status ?? 1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
