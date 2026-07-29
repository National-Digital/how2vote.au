#!/usr/bin/env node
/**
 * @fileoverview Post-deploy LIVE smoke tests that block promotion on drift.
 *
 * Run against the just-deployed target. It SKIPS gracefully (exit 0, logs "skipped: no live target")
 * when no deploy URL is configured, so CI without deploy creds stays green — but it FAILS on a real
 * drift when a target IS present (mirrors scripts/verify-aec-archive.mjs: absent → skip,
 * present-but-wrong → fail).
 *
 * With SMOKE_URL set it verifies, at the live surface:
 *   - the deployed release manifest (/release-manifest.json) is present, well-formed, and — when
 *     EXPECTED_COMMIT / EXPECTED_APP_VERSION are supplied — pins the commit/version just deployed;
 *   - the governance kill-switch surface (apps/web/src/lib/governance.ts) exports EXPORTS_ENABLED so
 *     the emergency comparison-only lever is reachable;
 *   - the research endpoint enforces its logging-exclusion + uniform-reply contract: a probe POST to
 *     /api/research returns 204 with an empty body (route bound, nothing leaked) — gated on
 *     SMOKE_RESEARCH=1 because the static Pages build does not always ship the Functions.
 *
 * The live production D1 schema (aggregate allowlist) and the applied-migration set are verified in
 * deploy.yml with the D1-scoped credentials; this script covers the HTTP surface.
 *
 * Pure decision logic is exported for unit tests; the fetch/CLI plumbing runs only when executed
 * directly.
 *
 * Usage:
 *   SMOKE_URL=https://how2vote.au node scripts/smoke-live.mjs
 */

import { fileURLToPath } from "node:url";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * Verify a fetched /release-manifest.json response.
 * @param {{ status: number, body: unknown }} res
 * @param {{ expectedCommit?: string, expectedAppVersion?: string }} [expect]
 * @returns {string[]} errors
 */
export function verifyManifestResponse(res, expect = {}) {
  const errors = [];
  if (!res || res.status !== 200) {
    return [
      `release-manifest: expected HTTP 200, got ${res?.status ?? "no response"} (fail closed)`,
    ];
  }
  const m = res.body;
  if (typeof m !== "object" || m === null || Array.isArray(m)) {
    return ["release-manifest: response body is not a JSON object"];
  }
  if (m.schemaVersion !== 1) errors.push("release-manifest: schemaVersion must be 1");
  if (!isNonEmptyString(m.gitCommit)) errors.push("release-manifest: missing gitCommit");
  if (!isNonEmptyString(m.appVersion)) errors.push("release-manifest: missing appVersion");
  if (isNonEmptyString(expect.expectedCommit) && m.gitCommit !== expect.expectedCommit) {
    errors.push(
      `release-manifest: deployed commit ${short(m.gitCommit)} != expected ${short(expect.expectedCommit)} (stale deploy?)`,
    );
  }
  if (isNonEmptyString(expect.expectedAppVersion) && m.appVersion !== expect.expectedAppVersion) {
    errors.push(
      `release-manifest: deployed appVersion ${m.appVersion} != expected ${expect.expectedAppVersion}`,
    );
  }
  return errors;
}

/**
 * The governance kill-switch state must be present AT THE LIVE SURFACE — asserted from the DEPLOYED
 * release manifest fetched over HTTP, not from the local checkout. Proves the running deployment
 * publishes its signed control-plane integrity digest and current suspension count; when an expected
 * integrity digest is supplied, a drifted/stale control plane fails closed.
 * @param {unknown} manifestBody  the parsed /release-manifest.json body
 * @param {{ expectedControlPlaneIntegrity?: string }} [expect]
 * @returns {string[]} errors
 */
export function verifyGovernanceState(manifestBody, expect = {}) {
  const errors = [];
  const g =
    manifestBody && typeof manifestBody === "object" && !Array.isArray(manifestBody)
      ? manifestBody.governance
      : null;
  if (!g || typeof g !== "object") {
    return [
      "governance: deployed manifest carries no governance block (kill-switch state unreachable)",
    ];
  }
  if (!/^sha256-[0-9a-f]{64}$/.test(g.controlPlaneIntegrity ?? "")) {
    errors.push("governance: deployed control-plane integrity digest missing or malformed");
  }
  if (!Number.isInteger(g.activeSuspensions) || g.activeSuspensions < 0) {
    errors.push("governance: deployed active-suspension count missing or invalid");
  }
  if (
    isNonEmptyString(expect.expectedControlPlaneIntegrity) &&
    g.controlPlaneIntegrity !== expect.expectedControlPlaneIntegrity
  ) {
    errors.push(
      `governance: deployed control plane ${short(g.controlPlaneIntegrity)} != expected ${short(expect.expectedControlPlaneIntegrity)} (stale/drifted control plane)`,
    );
  }
  return errors;
}

/**
 * The research endpoint's uniform-reply + no-leak contract: 204 with an empty body.
 * @param {{ status: number, bodyText: string }} res
 * @returns {string[]} errors
 */
export function verifyResearchProbe(res) {
  const errors = [];
  if (!res || res.status !== 204) {
    errors.push(
      `research probe: expected HTTP 204, got ${res?.status ?? "no response"} (route not bound / not uniform)`,
    );
  }
  if (res && isNonEmptyString(res.bodyText)) {
    errors.push(
      "research probe: response carried a body — the endpoint must reply uniformly with no body (no leak)",
    );
  }
  return errors;
}

const short = (h) => (isNonEmptyString(h) ? h.slice(0, 8) : String(h));

/* c8 ignore start -- fetch/CLI plumbing, exercised via CI/deploy not unit tests */
async function fetchJson(url) {
  const r = await fetch(url, { redirect: "follow" });
  let body;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  return { status: r.status, body };
}

async function main() {
  const base = process.env.SMOKE_URL;
  if (!isNonEmptyString(base)) {
    console.info("smoke: skipped: no live target (SMOKE_URL unset)");
    return; // skip cleanly — CI without deploy creds stays green
  }
  const origin = base.replace(/\/+$/, "");
  const errors = [];

  // 1 — deployed release manifest, and 2 — the governance kill-switch STATE it publishes, both
  // asserted from the SAME live HTTP response (no local-file read).
  //
  // Polled with backoff: the Pages alias can lag the upload by a minute or two, so a single
  // immediate fetch reads the PREVIOUS deployment and reports drift that is not real. Real drift
  // persists past the whole window and still fails.
  const RETRY_DELAYS_S = [0, 5, 10, 20, 30, 45, 60];
  let manifestErrors = [];
  for (const [attempt, delayS] of RETRY_DELAYS_S.entries()) {
    if (delayS > 0) await new Promise((resolve) => setTimeout(resolve, delayS * 1000));
    manifestErrors = [];
    let res = null;
    try {
      res = await fetchJson(`${origin}/release-manifest.json`);
    } catch (err) {
      manifestErrors = [`release-manifest: fetch failed: ${err.message}`];
    }
    if (res !== null) {
      manifestErrors.push(
        ...verifyManifestResponse(res, {
          expectedCommit: process.env.EXPECTED_COMMIT || process.env.GITHUB_SHA,
          expectedAppVersion: process.env.EXPECTED_APP_VERSION || process.env.APP_VERSION,
        }),
      );
      manifestErrors.push(
        ...verifyGovernanceState(res.body, {
          expectedControlPlaneIntegrity: process.env.EXPECTED_CONTROL_PLANE_INTEGRITY,
        }),
      );
    }
    if (manifestErrors.length === 0) break;
    if (attempt < RETRY_DELAYS_S.length - 1) {
      console.info(
        `smoke: manifest not settled (attempt ${attempt + 1}/${RETRY_DELAYS_S.length}) — retrying`,
      );
    }
  }
  errors.push(...manifestErrors);

  // 3 — research endpoint uniform-reply contract (only when the Functions are live).
  if (process.env.SMOKE_RESEARCH === "1") {
    try {
      const r = await fetch(`${origin}/api/research`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ smoke: true }),
      });
      const bodyText = await r.text();
      errors.push(...verifyResearchProbe({ status: r.status, bodyText }));
    } catch (err) {
      errors.push(`research probe: request failed: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`::error::smoke: ${e}`);
    console.error(`smoke: ${errors.length} live drift problem(s) — blocking promotion`);
    process.exit(1);
    return;
  }
  console.info(`smoke OK — live target ${origin} passed all post-deploy checks`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
/* c8 ignore stop */
