#!/usr/bin/env node
// Compute the next semantic version from (a) the latest v-tag reachable from HEAD and (b) the
// conventional-commit types of every commit since that tag. On main each commit is a squash merge
// whose subject IS the merged PR's title, so PR titles must be conventional (see CONTRIBUTING.md).
// The highest bump wins, so a `feat` whose own release was skipped or blocked still moves the minor
// on the next one.
//
//   type!: / BREAKING      -> major bump   (X.Y.Z -> (X+1).0.0) — a deliberate breaking release
//   feat[...]              -> minor bump   (X.Y.Z -> X.(Y+1).0)
//   fix|chore|docs|...     -> patch bump   (X.Y.Z -> X.Y.(Z+1))
//   anything non-conventional -> patch bump (safe default)
//
// One release bumps at most one field once, however many commits it carries. A MAJOR bump
// requires an explicit breaking-change marker (`!` after the type/scope, or a `BREAKING CHANGE`
// note) in a subject — it never happens by accident. A HEAD that is already tagged keeps the
// tag's version, so a re-run never mints a second release for one commit. MAJOR_FLOOR is the base
// when no tag is reachable; then only the HEAD subject is considered, never the whole history.
//
// Usage:
//   node scripts/next-version.mjs                 # commits since the latest reachable v-tag
//   node scripts/next-version.mjs "feat: thing"   # bump from this subject alone (a PR title)
//   node scripts/next-version.mjs --print-current # just echo the current base version
// Prints the bare version (e.g. 2.1.0) to stdout; diagnostics go to stderr.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Major floor: the app version numbering starts at v1. Before the first v-tag is pushed the script
// carries this forward; once tags exist the latest tag wins.
export const MAJOR_FLOOR = 1;

const RANK = { patch: 0, minor: 1, major: 2 };

/**
 * The highest strict vMAJOR.MINOR.PATCH tag.
 * @param {string[]} tags
 * @returns {{ tag: string, version: number[] } | null}
 */
export function latestTag(tags) {
  const parsed = tags
    .map((tag) => ({ tag, version: tag.replace(/^v/, "").split(".").map(Number) }))
    .filter(({ version: p }) => p.length === 3 && p.every((n) => Number.isInteger(n)))
    .sort((a, b) => {
      const [x, y] = [a.version, b.version];
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    });
  return parsed[0] ?? null;
}

/** @param {string} subject @returns {"major"|"minor"|"patch"} */
export function bumpType(subject) {
  const m = subject.match(/^\s*([a-zA-Z]+)(\([^)]*\))?(!)?:/);
  if (!m) return "patch"; // not conventional -> safe patch
  if (m[3] || /BREAKING[ -]CHANGE/.test(subject)) return "major"; // `type!:` or BREAKING note
  return m[1].toLowerCase() === "feat" ? "minor" : "patch";
}

/**
 * The highest bump over the subjects, and the earliest-listed subject carrying that bump.
 * @param {string[]} subjects at least one
 */
export function highestBump(subjects) {
  let best = { type: /** @type {"major"|"minor"|"patch"} */ ("patch"), subject: subjects[0] };
  for (const subject of subjects) {
    const type = bumpType(subject);
    if (RANK[type] > RANK[best.type]) best = { type, subject };
  }
  return best;
}

/**
 * @param {number[]} version [major, minor, patch]
 * @param {"major"|"minor"|"patch"} type
 */
export function applyBump([major, minor, patch], type) {
  if (type === "major") return [major + 1, 0, 0];
  if (type === "minor") return [major, minor + 1, 0];
  return [major, minor, patch + 1];
}

/**
 * @param {{
 *   tags: string[],
 *   subjectsSince: (tag: string) => string[],
 *   headSubject: () => string,
 *   explicit?: string,
 * }} input tags are those reachable from HEAD
 */
export function nextVersion({ tags, subjectsSince, headSubject, explicit }) {
  const latest = latestTag(tags);
  const base = latest?.version ?? [MAJOR_FLOOR, 0, 0];
  let subjects;
  if (explicit) {
    subjects = [explicit];
  } else if (latest) {
    subjects = subjectsSince(latest.tag);
    if (subjects.length === 0) {
      return { base, next: base, type: "none", subject: null, count: 0 };
    }
  } else {
    subjects = [headSubject()];
  }
  const { type, subject } = highestBump(subjects);
  return { base, next: applyBump(base, type), type, subject, count: subjects.length };
}

/* c8 ignore start -- git/CLI plumbing, exercised by the integration tests and CI */
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function main() {
  const args = process.argv.slice(2);
  let tags = [];
  try {
    tags = git("tag", "--list", "--merged", "HEAD", "v*.*.*").split("\n").filter(Boolean);
  } catch {
    /* no tags */
  }

  if (args.includes("--print-current")) {
    process.stdout.write((latestTag(tags)?.version ?? [MAJOR_FLOOR, 0, 0]).join("."));
    return;
  }

  const { base, next, type, subject, count } = nextVersion({
    tags,
    // Every commit reachable from HEAD but not from the tag, merge commits and their merged-in
    // history included.
    subjectsSince: (tag) => git("log", "--format=%s", `${tag}..HEAD`).split("\n").filter(Boolean),
    headSubject: () => git("log", "-1", "--pretty=%s"),
    explicit: args.find((a) => !a.startsWith("--")),
  });
  console.error(
    count === 0
      ? `HEAD is already tagged v${base.join(".")} — keeping that version`
      : `base v${base.join(".")} + ${count} subject(s), highest "${subject}" (${type}) -> ${next.join(".")}`,
  );
  process.stdout.write(next.join("."));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
