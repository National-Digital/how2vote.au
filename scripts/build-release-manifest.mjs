#!/usr/bin/env node
/**
 * @fileoverview Assemble the fail-closed release manifest (*).
 *
 * The manifest binds a deploy to the exact versions/hashes of the artefacts that make it lawful —
 * git commit, app/data/consent versions, and hashes of the operator record, legal-review record and
 * control register. Fields whose producing control has not landed yet are listed under `pending`
 * with the PR that will fill them; production promotion is refused while any remain (see
 * scripts/check-release-manifest.mjs). The manifest is a build/deploy artefact — it is emitted into
 * the site output at deploy time, not committed (so it never trips the deterministic-dataset gate).
 *
 * Usage:
 * node scripts/build-release-manifest.mjs [--out <path>] # default: stdout
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);
const rel = (p) => new URL(p, root);

/** SHA-256 (hex) of a file's exact bytes, or null if unreadable. */
function sha256File(p) {
  try {
    return createHash("sha256")
      .update(readFileSync(rel(p)))
      .digest("hex");
  } catch {
    return null;
  }
}

function readJson(p) {
  return JSON.parse(readFileSync(rel(p), "utf8"));
}

/**
 * SHA-256 over the per-election ballot-verification records, in election order, or null
 * if any is unreadable. Binds the deploy to the exact two-person verification state it ships.
 */
function ballotVerificationHash() {
  try {
    const elections = readJson("data/dist/elections.json");
    const h = createHash("sha256");
    for (const id of elections.map((e) => e.id).sort()) {
      h.update(readFileSync(rel(`data/source/${id}/ballot-verification.json`)));
    }
    return h.digest("hex");
  } catch {
    return null;
  }
}

/**
 * SHA-256 binding the deploy to the exact infrastructure config it ships: the
 * Cloudflare config-policy register, the migration checksum registry and the wrangler config, hashed
 * in a fixed order. Null if any is unreadable (the verifier then fails closed). check-release-
 * manifest.mjs mirrors this computation for the staleness check.
 */
function infrastructureHash() {
  try {
    const h = createHash("sha256");
    for (const p of [
      "infra/providers/cloudflare/config-policy.json",
      "infra/providers/cloudflare/migration-registry.json",
      "apps/web/wrangler.toml",
    ]) {
      h.update(readFileSync(rel(p)));
    }
    return h.digest("hex");
  } catch {
    return null;
  }
}

/**
 * SHA-256 over the committed, k-suppressed public-stat release files — index.json then
 * every stats/<id>.json in filename order — or null if the directory is unreadable. Binds the deploy
 * to the exact disclosure-controlled release files it ships, so any tampering (a re-added below-k
 * cell, an altered k, a stripped release block) changes the hash and is caught at deploy.
 */
function publicStatsHash() {
  try {
    const dir = rel("apps/web/static/stats/");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    if (files.length === 0) return null;
    const h = createHash("sha256");
    for (const f of files) h.update(readFileSync(new URL(f, dir)));
    return h.digest("hex");
  } catch {
    return null;
  }
}

/** The live kill-switch state, read straight from the signed control plane (no logic duplication):
 *  the integrity digest and the count of currently-active suspensions. Emitted into the manifest so
 *  the post-deploy smoke can assert the deployed control plane over HTTP. */
function governanceState() {
  try {
    const cp = readJson("data/governance/control-plane.json");
    return {
      controlPlaneIntegrity: typeof cp.integrity === "string" ? cp.integrity : null,
      activeSuspensions: Array.isArray(cp.suspensions)
        ? cp.suspensions.filter((s) => s && !s.liftedAt).length
        : null,
    };
  } catch {
    return { controlPlaneIntegrity: null, activeSuspensions: null };
  }
}

/** Best-effort git commit: CI provides GITHUB_SHA; otherwise ask git; else "unknown". */
function gitCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** RESEARCH_CONSENT_VERSION is a plain exported const; read it without importing TS. It is defined in
 * research/consent.ts (survey.ts only re-exports it since), so read the definition file first
 * and fall back to survey.ts. A miss returns null and the verifier fails closed. */
function consentVersion() {
  for (const f of ["apps/web/src/lib/research/consent.ts", "apps/web/src/lib/survey.ts"]) {
    try {
      const src = readFileSync(rel(f), "utf8");
      // Tolerant of single/double quotes; only an actual `= "..."` assignment matches (not a re-export).
      const m = /RESEARCH_CONSENT_VERSION\s*=\s*["']([^"']+)["']/.exec(src);
      if (m) return m[1];
    } catch {
      // try the next candidate location
    }
  }
  return null;
}

export function buildManifest({ now, appVersion, commit } = {}) {
  const elections = readJson("data/dist/elections.json");
  const dataVersions = {};
  for (const e of elections) dataVersions[e.id] = e.dataVersion;

  const review = readJson("docs/legal/legal-review.json");

  // Enumerate every control's version/status from the register. Production
  // promotion (check-release-manifest.mjs --mode production) fails closed if any control is missing
  // from this list or is not implemented/verified, so a partial / not-yet-signed-off control can
  // never ride out to production. controlRegisterVersion binds the enumeration to the exact register.
  const register = readJson("docs/legal/control-register.json");
  const controls = (register.controls ?? [])
    .map((c) => ({ id: c.id, status: c.status }))
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));

  return {
    schemaVersion: 1,
    generatedAt: now ?? new Date().toISOString(),
    gitCommit: commit ?? gitCommit(),
    appVersion: appVersion ?? process.env.APP_VERSION ?? "0.0.0-dev",
    dataVersions,
    consentVersion: consentVersion(),
    legalReviewVersion: review.approvalRef ?? null,
    legalReviewHash: sha256File("docs/legal/legal-review.json"),
    operatorHash: sha256File("apps/web/src/lib/operator.json"),
    controlRegisterHash: sha256File("docs/legal/control-register.json"),
    // The control register's version + every control's status. Bound to the deploy
    // so production promotion can fail closed on any control that is not implemented/verified.
    controlRegisterVersion: register.updated ?? null,
    controls,
    // The signed runtime kill-switch control plane — binds the deploy to the exact
    // suspension state + integrity digest it ships, so a tampered control plane is detectable here too.
    controlPlaneHash: sha256File("data/governance/control-plane.json"),
    // The live kill-switch STATE, emitted so the post-deploy smoke can assert the deployed control
    // plane over HTTP (scripts/smoke-live.mjs) instead of reading the local checkout: the signed
    // integrity digest and the count of currently-active suspensions.
    governance: governanceState(),
    // The rights-classes register — LICENSE-DATA.md is generated from it and CI drift-gates
    // that, so this hash binds the deploy to the exact rights terms it ships.
    rightsManifestHash: sha256File("data/rights/rights-classes.json"),
    // The machine-readable product boundary — the externally-determined
    // legal state (printMode, researchEnabled, candidateScorePlacement, pending determinations). Bound
    // so a deploy is pinned to the exact boundary it shipped under; check-product-boundary.mjs proves
    // it agrees with the control plane, and this hash detects any post-build tampering.
    productBoundaryHash: sha256File("data/legal/product-boundary.json"),
    // The two-person ballot-verification records.
    ballotVerificationHash: ballotVerificationHash(),
    // The Cloudflare infrastructure config (config-policy + migration registry + wrangler) — binds
    // the deploy to the exact infra assurance it ships.
    infrastructureHash: infrastructureHash(),
    // The k-suppressed public-stat release files — every published stats file with
    // its k, suppression rules and content-addressed release id, bound so tampering is detectable.
    publicStatsHash: publicStatsHash(),
    // Fields whose producing control has not landed yet. Production promotion is blocked while any
    // remain (check-release-manifest.mjs, production mode). Value = the PR that will supply it.
    pending: {
      ciAttestation: "CI (deploy)",
    },
  };
}

/* c8 ignore start -- CLI plumbing */
function main() {
  const args = process.argv.slice(2);
  let out = null;
  for (let i = 0; i < args.length; i++) if (args[i] === "--out") out = args[++i];
  const manifest = buildManifest();
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  if (out) {
    writeFileSync(out, json);
    console.info(`release manifest written to ${out} (commit ${manifest.gitCommit.slice(0, 8)})`);
  } else {
    process.stdout.write(json);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
