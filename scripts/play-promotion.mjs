#!/usr/bin/env node
/**
 * @fileoverview Whether the promote job should move this build to Play production.
 *
 * fastlane's promote sends a track update carrying only the new release. In an update Play reads
 * `releases` as the desired change, and the release that last completed stays in place beneath a
 * new staged one. The new staged release is expected to replace an older one still rolling out
 * (users who already have that build keep it, and the new release goes to the same group of users
 * first); how Play treats an older `halted` release in that case is not documented. With Managed
 * publishing on, the committed change waits in the console to be published.
 *
 * What the update cannot express is "this build is stale", so this reads the production and
 * internal tracks first, in a throwaway edit that is always deleted, and decides:
 *
 *   promote  the build is on the internal track and neither track holds a newer one.
 *   skip     production already holds this build, or either track holds a newer one: a later
 *            release reached Play, and its own run promotes it.
 *   fail     the build is not on the internal track, and nothing newer explains why.
 *
 * Usage:
 *   BUILD_NUMBER=105000123 PLAY_SERVICE_ACCOUNT_JSON='{...}' node scripts/play-promotion.mjs
 *   # writes `promote=true|false` and `reason` to $GITHUB_OUTPUT; exits 1 on fail
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { accessToken, API, loadKey, PACKAGE } from "./play-auth.mjs";

/**
 * @typedef {{ status?: string, versionCodes?: (string|number)[], userFraction?: number,
 *   name?: string }} Release
 * @typedef {{ action: "promote" | "skip" | "fail", reason: string, supersedes?: string }} Decision
 */

const codes = (r) => (r?.versionCodes ?? []).map(Number).filter(Number.isFinite);

/**
 * @param {{ code: string, production: Release[], internal: Release[] }} input
 * @returns {Decision}
 */
export function decidePromotion({ code, production, internal }) {
  const target = Number(code);
  const describe = (r) =>
    `${r.name || codes(r).join(",")} (${r.status}${r.userFraction ? ` ${Math.round(r.userFraction * 100)}%` : ""})`;
  const already = production.find((r) => codes(r).includes(target));
  if (already) return { action: "skip", reason: `production already holds ${describe(already)}` };
  const newer = production.find((r) => codes(r).some((c) => c > target));
  if (newer)
    return {
      action: "skip",
      reason: `production holds a newer build: ${describe(newer)}; promote the newest run or re-dispatch it`,
    };
  const uploaded = internal.find((r) => codes(r).some((c) => c > target));
  if (uploaded) {
    return {
      action: "skip",
      reason: `the internal track holds a newer build: ${describe(uploaded)}; promote the newest run or re-dispatch it`,
    };
  }
  if (!internal.some((r) => codes(r).includes(target))) {
    return { action: "fail", reason: `build ${code} is not on the internal track` };
  }
  const staged = production.find((r) => r.status === "inProgress" || r.status === "halted");
  if (staged) {
    return {
      action: "promote",
      reason: `promoting ${code}; it replaces the staged rollout of ${describe(staged)}`,
      supersedes: describe(staged),
    };
  }
  return { action: "promote", reason: `promoting ${code}` };
}

/**
 * The production and internal releases, read in an edit that is always deleted.
 * @param {(url: string, init?: object) => Promise<Response>} fetchImpl
 * @param {string} token
 * @returns {Promise<{ production: Release[], internal: Release[] }>}
 */
export async function readTracks(fetchImpl, token) {
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const app = `${API}/applications/${PACKAGE}`;
  const edit = await (await fetchImpl(`${app}/edits`, { method: "POST", headers: H })).json();
  if (!edit?.id)
    throw new Error(`Play refused to open an edit: ${edit?.error?.message ?? "no id"}`);
  try {
    const track = async (name) => {
      const res = await fetchImpl(`${app}/edits/${edit.id}/tracks/${name}`, { headers: H });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`${name} track unreadable: ${res.status}`);
      return (await res.json()).releases ?? [];
    };
    return { production: await track("production"), internal: await track("internal") };
  } finally {
    await fetchImpl(`${app}/edits/${edit.id}`, { method: "DELETE", headers: H }).catch(() => {});
  }
}

/* c8 ignore start -- network/CLI plumbing, exercised in CI not unit tests */
async function main() {
  const code = process.env["BUILD_NUMBER"] ?? "";
  if (!/^\d+$/.test(code)) throw new Error("BUILD_NUMBER must be set");
  const key = loadKey();
  if (!key) throw new Error("no Play service-account credential configured");
  const decision = decidePromotion({ code, ...(await readTracks(fetch, await accessToken(key))) });
  const out = process.env["GITHUB_OUTPUT"];
  if (out)
    appendFileSync(out, `promote=${decision.action === "promote"}\nreason=${decision.reason}\n`);
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file) appendFileSync(file, `### Play production\n- ${decision.reason}\n`);
  if (decision.action === "fail") throw new Error(decision.reason);
  if (decision.action === "skip") console.info(`::notice::Not promoted: ${decision.reason}.`);
  else console.info(decision.reason);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
/* c8 ignore stop */
