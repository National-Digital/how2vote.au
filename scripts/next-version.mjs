#!/usr/bin/env node
// Compute the next semantic version from (a) the most recent v-tag and (b) the conventional-commit
// type of the commit that triggered the run. On main after a squash merge, that commit's subject
// IS the merged PR's title, so PR titles must be conventional (see CONTRIBUTING.md).
//
//   type!: / BREAKING      -> major bump   (X.Y.Z -> (X+1).0.0) — a deliberate breaking release
//   feat[...]              -> minor bump   (X.Y.Z -> X.(Y+1).0)
//   fix|chore|docs|...     -> patch bump   (X.Y.Z -> X.Y.(Z+1))
//   anything non-conventional -> patch bump (safe default)
//
// A MAJOR bump requires an explicit breaking-change marker (`!` after the type/scope, or a
// `BREAKING CHANGE` note) on the commit/PR-title that triggers the run — it never happens by
// accident. MAJOR_FLOOR is the floor when no v-tag exists yet; once tags exist the latest wins and
// the marker carries the major forward from there.
//
// Usage:
//   node scripts/next-version.mjs                 # subject from `git log -1`
//   node scripts/next-version.mjs "feat: thing"   # explicit subject
//   node scripts/next-version.mjs --print-current # just echo the current base version
// Prints the bare version (e.g. 2.1.0) to stdout; diagnostics go to stderr.
import { execSync } from "node:child_process";

// Major floor: the app version numbering starts at v1. Before the first v-tag is pushed the script
// carries this forward; once tags exist the latest tag wins.
const MAJOR_FLOOR = 1;

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

function latestTag() {
  let tags = [];
  try {
    tags = sh('git tag --list "v*.*.*"').split("\n").filter(Boolean);
  } catch {
    /* no tags */
  }
  const parsed = tags
    .map((t) => t.replace(/^v/, "").split(".").map(Number))
    .filter((p) => p.length === 3 && p.every((n) => Number.isInteger(n)))
    .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
  return parsed[0] || [MAJOR_FLOOR, 0, 0];
}

function bumpType(subject) {
  const m = subject.match(/^\s*([a-zA-Z]+)(\([^)]*\))?(!)?:/);
  if (!m) return "patch"; // not conventional -> safe patch
  if (m[3] || /BREAKING[ -]CHANGE/.test(subject)) return "major"; // `type!:` or BREAKING note
  return m[1].toLowerCase() === "feat" ? "minor" : "patch";
}

const args = process.argv.slice(2);
let [major, minor, patch] = latestTag();

if (args.includes("--print-current")) {
  process.stdout.write(`${major}.${minor}.${patch}`);
  process.exit(0);
}

const subject = args.find((a) => !a.startsWith("--")) || sh("git log -1 --pretty=%s");
const type = bumpType(subject);
if (type === "major") {
  major += 1;
  minor = 0;
  patch = 0;
} else if (type === "minor") {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

console.error(
  `base v${latestTag().join(".")} + "${subject}" (${type}) -> ${major}.${minor}.${patch}`,
);
process.stdout.write(`${major}.${minor}.${patch}`);
