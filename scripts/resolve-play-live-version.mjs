#!/usr/bin/env node
/**
 * @fileoverview The app version Play is actually serving, for the Android freshness badge.
 *
 * The badge answers "which build do users have, and how old is the candidate data inside it".
 * Only Play knows the first half — the repo runs ahead of the store, because every merge to main
 * mints a release while a store build reaches users only after a promote and a review. Reporting
 * the repo's version there would describe a build nobody has installed.
 *
 * Play exposes no read-only "current version" call: the production track is readable only inside
 * an edit, so this opens a throwaway edit, reads the track and discards the edit. Nothing is
 * staged and nothing is committed.
 *
 * Play returns versionCodes, not version names, so the answer is decoded with the shared semver
 * encoding (generate-app-version.mjs) rather than a second copy of the formula.
 *
 * FAILS OPEN, unlike check-play-permission.mjs. That probe guards releases and a silent pass would
 * hide a broken publish path; this one decorates a README badge, and no badge is worth failing a
 * deploy over. Every failure prints a warning and emits an empty version, which
 * generate-store-badges.mjs renders as a grey "not published" — visibly absent, never wrong.
 *
 * Usage:
 *   PLAY_SERVICE_ACCOUNT_JSON='{...}' node scripts/resolve-play-live-version.mjs
 *   # writes `android=<semver>` to $GITHUB_OUTPUT when set, and prints the version to stdout
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeVersionCode } from "./generate-app-version.mjs";
import { accessToken, API, loadKey, PACKAGE } from "./play-auth.mjs";

/**
 * Release states that are in front of users. A staged rollout leaves two releases serving at once,
 * so the newest is reported: the badge's data comparison is about whether the store build has
 * caught up with the website, and the newest live build is the one that answers that.
 */
const LIVE_STATUSES = new Set(["completed", "inProgress"]);

/**
 * The highest versionCode among the releases currently serving on a track.
 * @param {{releases?: {status?: string, versionCodes?: (string|number)[]}[]}} track
 * @returns {number|null}
 */
export function liveVersionCode(track) {
  const codes = (track?.releases ?? [])
    .filter((r) => LIVE_STATUSES.has(r?.status ?? ""))
    .flatMap((r) => r?.versionCodes ?? [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  return codes.length ? Math.max(...codes) : null;
}

/**
 * The version Play is serving on the production track, or null when it cannot be determined.
 * @param {(url: string, init?: object) => Promise<Response>} fetchImpl
 * @param {string} token
 * @returns {Promise<string|null>}
 */
export async function productionVersion(fetchImpl, token) {
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const app = `${API}/applications/${PACKAGE}`;
  const insert = await fetchImpl(`${app}/edits`, { method: "POST", headers: H });
  const edit = await insert.json();
  if (!edit?.id)
    throw new Error(`could not open an edit: ${edit?.error?.message ?? insert.status}`);
  try {
    const res = await fetchImpl(`${app}/edits/${edit.id}/tracks/production`, { headers: H });
    if (!res.ok) throw new Error(`production track unreadable: ${res.status}`);
    const code = liveVersionCode(await res.json());
    return code === null ? null : decodeVersionCode(code);
  } finally {
    // Always discard, including on an unexpected throw — an abandoned edit would block later ones.
    await fetchImpl(`${app}/edits/${edit.id}`, { method: "DELETE", headers: H }).catch(
      () => undefined,
    );
  }
}

/* c8 ignore start -- credential/CLI plumbing, exercised in CI not unit tests */
function emit(version) {
  const out = process.env["GITHUB_OUTPUT"];
  if (out) appendFileSync(out, `android=${version ?? ""}\n`);
  if (version) console.info(`Play production is serving ${version}.`);
  process.stdout.write(`${version ?? ""}\n`);
}

async function main() {
  try {
    const key = loadKey();
    if (!key) {
      console.warn(
        "::warning::No Play credential configured — the Android badge stays unpublished.",
      );
      return emit(null);
    }
    const version = await productionVersion(fetch, await accessToken(key));
    if (!version) console.warn("::warning::No live release on the Play production track.");
    return emit(version);
  } catch (error) {
    console.warn(`::warning::Could not read the live Play version: ${error.message}`);
    return emit(null);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
/* c8 ignore stop */
