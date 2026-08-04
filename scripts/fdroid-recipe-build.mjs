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
 *   node scripts/fdroid-recipe-build.mjs init     --version 9.9.9 --code 90909000
 *   node scripts/fdroid-recipe-build.mjs prebuild --version 9.9.9 --code 90909000
 *   node scripts/fdroid-recipe-build.mjs build    --version 9.9.9 --code 90909000
 *   node scripts/fdroid-recipe-build.mjs build --print   # show the shell line, run nothing
 *   node scripts/fdroid-recipe-build.mjs signing-keys   # digests the recipe pins, one per line
 */

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECIPE_REL = "docs/fdroid/au.how2vote.app.yml";
export const PHASES = ["init", "prebuild", "build"];

/**
 * The repos behind the recipe's srclibs, mirroring fdroiddata's srclibs/<name>.yml (which is
 * where fdroidserver reads them from — a srclib used here must exist there under the same name).
 * fdroidserver clones each at the pinned ref and substitutes $$<name>$$ with the checkout path;
 * materialiseSrclibs() below does the same into build/srclib/, fdroidserver's own layout.
 *
 * @type {Record<string, string>}
 */
export const SRCLIB_REPOS = {
  esbuild: "https://github.com/evanw/esbuild.git",
  rollup: "https://github.com/rollup/rollup.git",
};

/**
 * Extracts one build-block phase's commands. Deliberately a small line scanner rather than a YAML
 * dependency: this must read the same file the submitted recipe is generated from, in CI, with no
 * install step of its own.
 *
 * @param {string} recipe recipe file contents
 * @param {string} phase `init`, `prebuild` or `build`
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
 * The signer certificate digests the recipe pins. The release build asserts the APK it signs
 * matches one of these, so the recipe stays the single source for the published binary's identity.
 *
 * @param {string} recipe
 * @returns {string[]} lower-case 64-hex digests, in declaration order
 */
export function signingKeys(recipe) {
  // fdroidserver canonicalises a one-key list to a scalar, so both forms are valid input and the
  // submitted copy will use whichever `fdroid rewritemeta` emits.
  const scalar = recipe.match(/^AllowedAPKSigningKeys:[ \t]+([0-9a-fA-F]{64})[ \t]*$/m);
  if (scalar) return [scalar[1].toLowerCase()];
  const lines = recipe.split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === "AllowedAPKSigningKeys:");
  if (start === -1) return [];
  /** @type {string[]} */
  const keys = [];
  for (const line of lines.slice(start + 1)) {
    const item = line.match(/^\s+-\s+([0-9a-fA-F]{64})\s*$/);
    if (!item) break;
    keys.push(item[1].toLowerCase());
  }
  return keys;
}

/**
 * The recipe's srclib pins. Reuses the phase scanner: `srclibs:` is a list at the same indent as
 * the command phases, just with `name@ref` entries instead of commands.
 *
 * @param {string} recipe
 * @returns {{name: string, ref: string}[]}
 */
export function srclibRefs(recipe) {
  return phaseCommands(recipe, "srclibs").map((entry) => {
    const at = entry.indexOf("@");
    return { name: entry.slice(0, at), ref: entry.slice(at + 1) };
  });
}

/**
 * @param {string[]} cmds
 * @param {{version: string, code: string, srclibs?: Record<string, string>}} subs
 * @returns {string} the single shell line fdroidserver would execute
 */
export function shellLine(cmds, { version, code, srclibs = {} }) {
  let line = cmds.join("; ").replaceAll("$$VERSION$$", version).replaceAll("$$VERCODE$$", code);
  for (const [name, dir] of Object.entries(srclibs)) {
    line = line.replaceAll(`$$${name}$$`, dir);
  }
  return line;
}

/* c8 ignore start -- git/network plumbing, exercised via CI not unit tests */
/**
 * Clones each srclib a phase references at its pinned ref, exactly where fdroidserver would
 * (build/srclib/<name>, gitignored). Idempotent: a checkout already at the pin is reused; one at
 * anything else is re-cloned, so a pin bump in the recipe just works.
 *
 * @param {{name: string, ref: string}[]} libs
 * @returns {Record<string, string>} srclib name → absolute checkout path
 */
function materialiseSrclibs(libs) {
  /** @type {Record<string, string>} */
  const paths = {};
  for (const { name, ref } of libs) {
    const repo = SRCLIB_REPOS[name];
    if (repo === undefined) {
      console.error(
        `✗ srclib "${name}" has no repo mapping — add it to SRCLIB_REPOS (and make sure ` +
          `fdroiddata's srclibs/${name}.yml exists; the buildserver reads it from there)`,
      );
      process.exit(1);
    }
    const dir = join(ROOT, "build", "srclib", name);
    const at = spawnSync("git", ["-C", dir, "describe", "--tags", "--exact-match"], {
      encoding: "utf8",
    });
    if (at.status === 0 && at.stdout.trim() === ref) {
      paths[name] = dir;
      continue;
    }
    rmSync(dir, { recursive: true, force: true });
    console.info(`▶ srclib ${name}: cloning ${repo} at ${ref}`);
    const clone = spawnSync("git", ["clone", "--depth", "1", "--branch", ref, repo, dir], {
      stdio: "inherit",
    });
    if (clone.status !== 0) {
      console.error(`✗ srclib ${name}: clone of ${repo} at ${ref} failed`);
      process.exit(clone.status ?? 1);
    }
    paths[name] = dir;
  }
  return paths;
}
/* c8 ignore stop */

/* c8 ignore start -- CLI/process plumbing */
function main() {
  const [phase] = process.argv.slice(2);
  if (phase === "signing-keys") {
    const keys = signingKeys(readFileSync(join(ROOT, RECIPE_REL), "utf8"));
    if (keys.length === 0) {
      console.error(`✗ ${RECIPE_REL}: no AllowedAPKSigningKeys pinned`);
      process.exit(1);
    }
    console.info(keys.join("\n"));
    return;
  }
  if (!PHASES.includes(phase)) {
    console.error(
      `usage: fdroid-recipe-build.mjs <${PHASES.join("|")}|signing-keys> [--version v] [--code c]`,
    );
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
  // Only the srclibs this phase actually references are materialised — and --print substitutes
  // their (deterministic) paths without cloning anything.
  const referenced = srclibRefs(recipe).filter(({ name }) =>
    cmds.some((c) => c.includes(`$$${name}$$`)),
  );
  const srclibs = process.argv.includes("--print")
    ? Object.fromEntries(referenced.map(({ name }) => [name, join(ROOT, "build", "srclib", name)]))
    : materialiseSrclibs(referenced);
  const line = shellLine(cmds, {
    version: arg("version", "9.9.9"),
    code: arg("code", "90909000"),
    srclibs,
  });
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
