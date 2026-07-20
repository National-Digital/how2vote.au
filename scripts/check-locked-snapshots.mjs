#!/usr/bin/env node
/**
 * @fileoverview CI guard: locked TVFY snapshot versions are immutable (ADR 0005).
 *
 * Snapshots live at data/snapshots/tvfy/<electionId>/v<N>/ with an
 * election-level versions.json alongside. Once a version's meta.json says
 * `locked: true` on the base branch, that version directory is frozen — a PR
 * may not add, modify, rename, or delete anything under it. A verified factual
 * correction is a NEW version, never an edit to a locked one.
 *
 * versions.json itself is append-only: existing history entries must be
 * preserved verbatim (a null lockedAt may be filled in — that is the lock PR
 * landing), new entries may be appended, and `active` may move.
 *
 * The PR that *introduces* a lock passes because the rules are evaluated
 * against the merge-base: a version that was absent or unlocked at base is
 * fair game. One further exemption: a locked ORIGINAL snapshot (meta
 * `schemaVersion` other than 2 — the old Internet-Archive model) may be
 * replaced wholesale by the one-time direct-API migration;
 * schemaVersion-2 locked snapshots remain strictly immutable.
 *
 * Pure decision logic is exported as verdict() for unit tests; the git/fs
 * plumbing only runs when the script is executed directly.
 *
 * Usage (CI or local):
 *   node scripts/check-locked-snapshots.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SNAPSHOT_ROOT = "data/snapshots/tvfy/";

/** @param {unknown} value */
const isNullish = (value) => value === null || value === undefined;

/**
 * Deep equality for parsed-JSON values (objects compared by keys, arrays by
 * position). Sufficient here because both sides come from JSON.parse.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
  );
}

/**
 * Parse JSON, returning null on failure (callers decide what absence means).
 *
 * @param {string | null} text
 * @returns {unknown}
 */
function tryParse(text) {
  if (isNullish(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Classify a path under the snapshot root.
 *
 * @param {string} path
 * @returns {{kind: "outside" | "other"}
 *   | {kind: "versions"}
 *   | {kind: "version-file", versionDir: string, label: string}}
 */
function classify(path) {
  if (!path.startsWith(SNAPSHOT_ROOT)) return { kind: "outside" };
  const segments = path.slice(SNAPSHOT_ROOT.length).split("/");
  if (segments.length === 2 && segments[1] === "versions.json") return { kind: "versions" };
  if (segments.length >= 3 && /^v\d+$/.test(segments[1])) {
    return {
      kind: "version-file",
      versionDir: `${SNAPSHOT_ROOT}${segments[0]}/${segments[1]}`,
      label: `${segments[0]}/${segments[1]}`,
    };
  }
  return { kind: "other" };
}

/**
 * Expand renames into delete+add and reduce statuses to their first letter,
 * so the rest of the logic only sees A / M / D.
 *
 * @param {Array<{status: string, path: string, oldPath?: string}>} changedFiles
 * @returns {Array<{status: "A" | "M" | "D", path: string}>}
 */
function normalize(changedFiles) {
  const out = [];
  for (const change of changedFiles) {
    const status = (change.status || "")[0];
    if (status === "R") {
      out.push({ status: "D", path: change.oldPath });
      out.push({ status: "A", path: change.path });
    } else if (status === "C") {
      out.push({ status: "A", path: change.path });
    } else {
      out.push({ status, path: change.path });
    }
  }
  return out;
}

/** The election id embedded in a snapshot path (…/snapshots/tvfy/<id>/…), or null. */
function electionIdFromPath(p) {
  const m = /\/snapshots\/tvfy\/([^/]+)\//.exec(`/${p}`);
  return m ? m[1] : null;
}

/**
 * Is head history entry the same as base except a null lockedAt gained a
 * non-null value (the lock PR landing)?
 *
 * @param {unknown} baseEntry
 * @param {unknown} headEntry
 * @returns {boolean}
 */
function isLockedAtFill(baseEntry, headEntry) {
  if (
    typeof baseEntry !== "object" ||
    typeof headEntry !== "object" ||
    baseEntry === null ||
    headEntry === null
  ) {
    return false;
  }
  if (baseEntry.lockedAt !== null || isNullish(headEntry.lockedAt)) return false;
  for (const key of new Set([...Object.keys(baseEntry), ...Object.keys(headEntry)])) {
    if (key === "lockedAt") continue;
    if (!deepEqual(baseEntry[key], headEntry[key])) return false;
  }
  return true;
}

/**
 * Validate a change to an election-level versions.json: append-only history
 * (a null lockedAt may be filled), stable schemaVersion/electionId, `active`
 * free to move, never deleted once it exists.
 *
 * @param {{status: string, path: string}} change
 * @param {(p: string) => string | null | Promise<string | null>} readBase
 * @param {(p: string) => string | null | Promise<string | null>} readHead
 * @returns {Promise<string[]>} violations
 */
async function checkVersionsJson(change, readBase, readHead) {
  const { path, status } = change;
  const baseText = await readBase(path);
  if (status === "D") {
    return isNullish(baseText)
      ? []
      : [`${path}: deleted, but it existed at base — version history must be preserved (ADR 0005)`];
  }
  if (isNullish(baseText)) return []; // first snapshot for this election
  const head = tryParse(await readHead(path));
  if (head === null || typeof head !== "object") {
    return [`${path}: unparseable JSON at head — versions.json is guarded (ADR 0005)`];
  }
  const base = tryParse(baseText);
  if (base === null || typeof base !== "object") return []; // unparseable at base → treat as absent
  const violations = [];
  for (const key of ["schemaVersion", "electionId"]) {
    if (!deepEqual(base[key], head[key])) {
      violations.push(
        `${path}: "${key}" changed — it must stay identical across versions.json updates`,
      );
    }
  }
  const baseHistory = Array.isArray(base.history) ? base.history : [];
  const headHistory = Array.isArray(head.history) ? head.history : [];
  if (headHistory.length < baseHistory.length) {
    violations.push(
      `${path}: history entries removed (${baseHistory.length} at base → ${headHistory.length} at head) — history is append-only`,
    );
  }
  for (let i = 0; i < Math.min(baseHistory.length, headHistory.length); i += 1) {
    const baseEntry = baseHistory[i];
    const headEntry = headHistory[i];
    if (deepEqual(baseEntry, headEntry) || isLockedAtFill(baseEntry, headEntry)) continue;
    violations.push(
      `${path}: history[${i}] (version ${baseEntry?.version}) rewritten — existing entries are append-only; only a null lockedAt may be filled`,
    );
  }
  return violations;
}

/**
 * Decide whether a set of changed snapshot files respects ADR 0005.
 *
 * Pure apart from the injected readers, so tests can drive it with in-memory
 * maps. Readers may be sync or async; return the file content string, or null
 * if the file is absent on that side.
 *
 * @param {Array<{status: "A" | "M" | "D" | "R", path: string, oldPath?: string}>} changedFiles
 * @param {(p: string) => string | null | Promise<string | null>} readBase
 * @param {(p: string) => string | null | Promise<string | null>} readHead
 * @returns {Promise<{ok: boolean, violations: string[]}>}
 */
export async function verdict(changedFiles, readBase, readHead) {
  const violations = [];
  /** @type {Map<string, {label: string, changes: Array<{status: string, path: string}>}>} */
  const versionGroups = new Map();
  const versionsJsonChanges = [];

  for (const change of normalize(changedFiles)) {
    const kind = classify(change.path);
    if (kind.kind === "versions") {
      versionsJsonChanges.push(change);
    } else if (kind.kind === "version-file") {
      const group = versionGroups.get(kind.versionDir) ?? { label: kind.label, changes: [] };
      group.changes.push(change);
      versionGroups.set(kind.versionDir, group);
    }
    // "outside" and "other" paths are out of scope.
  }

  // Elections whose base snapshot is the original (schemaVersion 1, Internet-Archive) model: the
  // one-time migration to the direct-API model is permitted to replace them, so their
  // version files AND versions.json are exempt this once. schemaVersion-2 snapshots stay immutable.
  const migratingElections = new Set();

  for (const [versionDir, group] of versionGroups) {
    const baseMeta = tryParse(await readBase(`${versionDir}/meta.json`));
    // Absent or unparseable meta at base, or an unlocked version → any change
    // is allowed (this is how the snapshot/lock PR itself passes).
    if (baseMeta === null || typeof baseMeta !== "object" || baseMeta.locked !== true) continue;
    // Original pre-migration snapshot → exempt (one-time direct-API migration).
    if (baseMeta.schemaVersion !== 2) {
      const id = electionIdFromPath(`${versionDir}/meta.json`);
      if (id) migratingElections.add(id);
      continue;
    }

    for (const change of group.changes) {
      const verb =
        change.status === "D" ? "deleted from" : change.status === "A" ? "added to" : "modified in";
      violations.push(
        `${change.path}: ${verb} locked snapshot version ${group.label} — locked versions are immutable; create a new version instead (ADR 0005)`,
      );
    }
  }

  for (const change of versionsJsonChanges) {
    if (migratingElections.has(electionIdFromPath(change.path))) continue;
    violations.push(...(await checkVersionsJson(change, readBase, readHead)));
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Run a git command and return trimmed stdout, or null on failure.
 *
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {string | null}
 */
function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Resolve the base commit to compare against: PR merge-base in CI, the
 * pre-push SHA on branch pushes, or merge-base with origin/main locally.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
function resolveBase(env) {
  if (env.GITHUB_BASE_REF) {
    return git(["merge-base", `origin/${env.GITHUB_BASE_REF}`, "HEAD"]);
  }
  const before = env.GITHUB_EVENT_BEFORE;
  if (before && !/^0+$/.test(before)) {
    return git(["rev-parse", "--verify", `${before}^{commit}`]);
  }
  return git(["merge-base", "origin/main", "HEAD"]);
}

/**
 * Parse `git diff --name-status -z` output: `status\0path\0`, with renames
 * and copies emitting `Rxx\0old\0new\0`.
 *
 * @param {string} raw
 * @returns {Array<{status: string, path: string, oldPath?: string}>}
 */
function parseNameStatusZ(raw) {
  const tokens = raw.split("\0").filter((t) => t.length > 0);
  const changes = [];
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i];
    if (status.startsWith("R") || status.startsWith("C")) {
      changes.push({ status, oldPath: tokens[i + 1], path: tokens[i + 2] });
      i += 3;
    } else {
      changes.push({ status, path: tokens[i + 1] });
      i += 2;
    }
  }
  return changes;
}

async function main() {
  const base = resolveBase(process.env);
  if (!base) {
    // In CI a missing base is not "nothing to check" — it means the guard could not run, so a
    // post-lock edit would slip through unchecked. Fail closed under GitHub Actions; stay lenient
    // for local ad-hoc runs.
    if (process.env.GITHUB_ACTIONS) {
      console.error(
        "::error::locked-snapshot guard: could not resolve a base commit to diff against — refusing to pass in CI (fail-closed).",
      );
      process.exit(1);
    }
    console.info("✓ locked-snapshot guard: no base commit to compare against — nothing to check.");
    return;
  }
  const repoRoot = git(["rev-parse", "--show-toplevel"]);
  if (!repoRoot) {
    console.info("✓ locked-snapshot guard: not inside a git repository — nothing to check.");
    return;
  }

  const raw = git(["diff", "--name-status", "-z", `${base}...HEAD`, "--", SNAPSHOT_ROOT], repoRoot);
  const changedFiles = parseNameStatusZ(raw ?? "");

  const readBase = (p) => git(["show", `${base}:${p}`], repoRoot);
  const readHead = (p) => {
    try {
      return readFileSync(join(repoRoot, p), "utf8");
    } catch {
      return null;
    }
  };

  const result = await verdict(changedFiles, readBase, readHead);
  if (result.ok) {
    const detail =
      changedFiles.length === 0 ? "no snapshot files changed" : "all snapshot changes are allowed";
    console.info(`✓ locked-snapshot guard: ${detail} (base ${base.slice(0, 12)}).`);
    return;
  }
  for (const violation of result.violations) {
    console.error(`::error::${violation}`);
  }
  console.error(
    `❌ ${result.violations.length} locked-snapshot violation(s) — locked TVFY snapshot versions are immutable (ADR 0005).`,
  );
  process.exit(1);
}

// Only run when invoked directly; importing (e.g. tests) just gets verdict().
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}
