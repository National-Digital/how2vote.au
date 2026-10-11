#!/usr/bin/env node
/**
 * @fileoverview Reads the rollout markers from a GitHub release's notes.
 *
 *   [staged-rollout]  Play: 10% staged rollout, ramped by hand. App Store: unchanged (phased).
 *   [full-rollout]    Play: every user (the default anyway). App Store: phased release off.
 *                     Wins over [staged-rollout].
 *
 * deploy.yml generates the notes from the merged pull requests, one line per pull request
 * ("* <title> by @<author> in https://github.com/<owner>/<repo>/pull/<n>"). A marker counts only
 * in a pull request TITLE on such a line, standing on its own (not in backticks, not joined to a
 * word), or alone on a line of its own, as a person editing the notes would add it. A marker
 * quoted in prose, or in a title that merely mentions it in backticks, is ignored, and reported:
 * an ignored `[staged-rollout]` fails the Play promotion (a release meant to be staged must not go
 * to every user by mistake); an ignored `[full-rollout]` is a warning.
 *
 * Usage:
 *   BODY="$(gh release view v1.5.0 --json body --jq .body)" node scripts/rollout-markers.mjs play
 *   # writes fraction=1|0.1 to $GITHUB_OUTPUT
 *   BODY=… node scripts/rollout-markers.mjs ios
 *   # writes phased=true|false to $GITHUB_OUTPUT
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasMarker } from "./store-release-scope.mjs";

export const FULL = "[full-rollout]";
export const STAGED = "[staged-rollout]";

const PR_LINE =
  /^\s*[*-]\s+(.+?)\s+by\s+@[\w-]+(?:\[bot\])?\s+in\s+https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\s*$/;

/**
 * The text a marker may appear in: generated pull request titles and whole lines.
 * @param {string} body
 * @returns {{ titles: string[], lines: string[] }}
 */
function places(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  return {
    titles: lines.map((l) => PR_LINE.exec(l)?.[1]).filter(Boolean),
    lines: lines.map((l) => l.trim().toLowerCase()),
  };
}

/**
 * @param {string} body release notes
 * @returns {{ full: boolean, staged: boolean }}
 */
export function markers(body) {
  const { titles, lines } = places(body);
  const has = (m) => lines.includes(m) || titles.some((t) => hasMarker(t, m));
  return { full: has(FULL), staged: has(STAGED) };
}

/**
 * Markers whose text appears in the notes (any case) but that `markers` did not count.
 * @param {string} body
 * @returns {{ full: boolean, staged: boolean }}
 */
export function ignoredMarkers(body) {
  const text = String(body ?? "").toLowerCase();
  const counted = markers(body);
  return {
    full: text.includes(FULL) && !counted.full,
    staged: text.includes(STAGED) && !counted.staged,
  };
}

/** @param {string} body */
export function playFraction(body) {
  const m = markers(body);
  return m.full || !m.staged ? "1" : "0.1";
}

/** @param {string} body */
export function iosPhased(body) {
  return !markers(body).full;
}

/* c8 ignore start -- CLI plumbing, exercised in CI */
function main() {
  const mode = process.argv[2];
  const body = process.env["BODY"] ?? "";
  const out = process.env["GITHUB_OUTPUT"];
  const write = (line) => (out ? appendFileSync(out, `${line}\n`) : console.info(line));
  const m = markers(body);
  const ignored = ignoredMarkers(body);
  const where = "a pull request title or alone on a line of its own";
  if (ignored.full) {
    console.info(
      `::warning::${FULL} appears in the release notes but not in ${where}, so it was ignored.`,
    );
  }
  if (mode === "play") {
    if (ignored.staged) {
      throw new Error(
        `${STAGED} appears in the release notes but not in ${where}. Put it alone on a line of the ` +
          "release notes to stage this release, or remove it to roll out to every user, then re-run this job",
      );
    }
    const fraction = playFraction(body);
    write(`fraction=${fraction}`);
    if (m.full) console.info(`${FULL} marker present: promoting to every user.`);
    else if (fraction !== "1") {
      console.info(
        `::warning::${STAGED} marker present: 10% rollout. Nothing ramps it automatically; increase or halt it in Play Console.`,
      );
    } else console.info("Full rollout: every user.");
    return;
  }
  if (mode === "ios") {
    const phased = iosPhased(body);
    write(`phased=${phased}`);
    console.info(
      phased
        ? "Phased release: Apple's 7-day schedule. Pause in App Store Connect if needed."
        : `::warning::${FULL} marker present: phased release OFF (all auto-updaters at once).`,
    );
    return;
  }
  throw new Error("usage: rollout-markers.mjs play|ios");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
/* c8 ignore stop */
