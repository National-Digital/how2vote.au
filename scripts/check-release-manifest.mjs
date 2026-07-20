#!/usr/bin/env node
/**
 * @fileoverview Fail-closed verification of the release manifest.
 *
 * Given a manifest (built by scripts/build-release-manifest.mjs) this proves:
 *   - every required field is present and well-formed;
 *   - the recorded hashes match the on-disk operator record, legal-review record and control
 *     register — a stale manifest (built against different files) is rejected;
 *   - in PRODUCTION mode, the `pending` set is empty — no not-yet-implemented control may ship.
 *
 * In DRAFT mode (the default, used on every PR while the programme is in flight) pending fields are
 * allowed but reported. When the last producing control lands, deploy flips to production mode and
 * the manifest must be complete.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-release-manifest.mjs <manifest.json> [--mode draft|production]
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL_STATUS = ["planned", "in-progress", "partial", "implemented", "verified"];
const COMPLETE_STATUS = ["implemented", "verified"];

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * @param {unknown} manifest  parsed release manifest
 * @param {{ mode?: "draft" | "production", actualHashes?: Record<string,string|null>,
 *           actualControls?: {id:string,status:string}[], requiredControls?: string[],
 *           profile?: string }} [options]
 *   actualHashes: freshly computed { legalReviewHash, operatorHash, controlRegisterHash, … } from disk.
 *   actualControls: the register's { id, status } list (sorted), for the control-enumeration staleness check.
 *   requiredControls: control ids that MUST be implemented/verified regardless of mode (a release
 *     profile's legally-material subset — the fail-closed middle ground between draft and production).
 *   profile: the profile name, for messages only.
 * @returns {{ ok: boolean, errors: string[], mode: string }}
 */
export function verdict(manifest, options = {}) {
  const errors = [];
  const mode = options.mode ?? "draft";
  const actual = options.actualHashes ?? null;
  const actualControls = options.actualControls ?? null;
  const requiredControls = Array.isArray(options.requiredControls) ? options.requiredControls : [];
  const profile = options.profile ?? null;
  const push = (m) => errors.push(m);

  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return { ok: false, errors: ["manifest: not a JSON object"], mode };
  }
  if (manifest.schemaVersion !== 1) {
    push(`manifest: schemaVersion must be 1, got ${JSON.stringify(manifest.schemaVersion)}`);
  }

  for (const key of ["gitCommit", "appVersion", "consentVersion", "legalReviewVersion"]) {
    if (!isNonEmptyString(manifest[key])) push(`manifest: missing ${key}`);
  }
  for (const key of [
    "legalReviewHash",
    "operatorHash",
    "controlRegisterHash",
    "controlPlaneHash",
    "rightsManifestHash",
    "productBoundaryHash",
    "ballotVerificationHash",
    "infrastructureHash",
    "publicStatsHash",
  ]) {
    if (!SHA256.test(manifest[key] ?? "")) push(`manifest: ${key} must be a sha256 hex digest`);
  }

  const dv = manifest.dataVersions;
  if (typeof dv !== "object" || dv === null || Array.isArray(dv) || Object.keys(dv).length === 0) {
    push("manifest: dataVersions must be a non-empty object");
  } else {
    for (const [id, v] of Object.entries(dv)) {
      if (!isNonEmptyString(v)) push(`manifest: dataVersions.${id} is empty`);
    }
  }

  // Control enumeration: every control's version/status is recorded and, in
  // production mode, must be implemented/verified — a partial / not-yet-signed-off control fails
  // closed rather than shipping behind a green build.
  if (!isNonEmptyString(manifest.controlRegisterVersion)) {
    push("manifest: missing controlRegisterVersion");
  }
  const controls = Array.isArray(manifest.controls) ? manifest.controls : null;
  if (!controls || controls.length === 0) {
    push("manifest: controls must be a non-empty array (every control's status)");
  } else {
    for (const [i, c] of controls.entries()) {
      if (!c || typeof c !== "object" || !isNonEmptyString(c.id)) {
        push(`manifest: controls[${i}] missing id`);
        continue;
      }
      if (!CONTROL_STATUS.includes(c.status)) {
        push(`manifest: controls[${i}] (${c.id}) has invalid status ${JSON.stringify(c.status)}`);
      }
      if (mode === "production" && !COMPLETE_STATUS.includes(c.status)) {
        push(
          `manifest: production release blocked — control ${c.id} is "${c.status}", not implemented/verified`,
        );
      }
    }
    // Release-profile overlay: the profile's legally-material controls must be implemented/verified
    // regardless of mode. This is the fail-closed middle ground — the wider programme may still carry
    // pending controls, but a release under this profile cannot ship while a named material control is
    // incomplete (or absent from the manifest).
    if (requiredControls.length > 0) {
      const byId = new Map(controls.filter((c) => c && c.id).map((c) => [c.id, c]));
      for (const id of requiredControls) {
        const c = byId.get(id);
        if (!c) {
          push(
            `manifest: profile "${profile}" requires control ${id}, which is absent from the manifest`,
          );
        } else if (!COMPLETE_STATUS.includes(c.status)) {
          push(
            `manifest: profile "${profile}" release blocked — required control ${id} is "${c.status}", not implemented/verified`,
          );
        }
      }
    }
    // Staleness: the recorded control list must match the register on disk (built against the same tree).
    if (actualControls) {
      const rec = JSON.stringify(controls.map((c) => [c.id, c.status]));
      const disk = JSON.stringify(actualControls.map((c) => [c.id, c.status]));
      if (rec !== disk) {
        push(
          "manifest: controls enumeration is stale (does not match the control register on disk)",
        );
      }
    }
  }

  // Staleness: the recorded hashes must match the current on-disk artefacts. Inert in the
  // build-then-verify wiring (same tree), where it earns nothing; it earns its keep only when a
  // PERSISTED manifest is verified against a possibly-different tree (a committed manifest, or a
  // deploy that reuses an earlier build) — which is why the missing-artefact case below must fail
  // closed rather than skip.
  if (actual) {
    for (const key of [
      "legalReviewHash",
      "operatorHash",
      "controlRegisterHash",
      "controlPlaneHash",
      "rightsManifestHash",
      "productBoundaryHash",
      "ballotVerificationHash",
      "infrastructureHash",
      "publicStatsHash",
    ]) {
      if (!SHA256.test(manifest[key] ?? "")) continue; // already flagged by the format check above
      if (!actual[key]) {
        push(`manifest: ${key} cannot be verified — the on-disk artefact is missing or unreadable`);
      } else if (actual[key] !== manifest[key]) {
        push(
          `manifest: ${key} is stale (recorded ${short(manifest[key])}, on-disk ${short(actual[key])})`,
        );
      }
    }
  }

  const pending = manifest.pending;
  if (typeof pending !== "object" || pending === null || Array.isArray(pending)) {
    push("manifest: pending must be an object (may be empty)");
  } else if (mode === "production") {
    const keys = Object.keys(pending);
    if (keys.length > 0) {
      push(
        `manifest: production release blocked — ${keys.length} field(s) still pending: ${keys.join(", ")}`,
      );
    }
  }

  return { ok: errors.length === 0, errors, mode };
}

const short = (h) => (typeof h === "string" ? h.slice(0, 8) : String(h));

/* c8 ignore start -- CLI/fs plumbing */
function sha256File(url) {
  try {
    return createHash("sha256").update(readFileSync(url)).digest("hex");
  } catch {
    return null;
  }
}

/** Mirror of build-release-manifest.mjs: SHA-256 over the per-election ballot-verification records. */
function ballotVerificationHash(root) {
  try {
    const elections = JSON.parse(readFileSync(new URL("data/dist/elections.json", root), "utf8"));
    const h = createHash("sha256");
    for (const id of elections.map((e) => e.id).sort()) {
      h.update(readFileSync(new URL(`data/source/${id}/ballot-verification.json`, root)));
    }
    return h.digest("hex");
  } catch {
    return null;
  }
}

/** Mirror of build-release-manifest.mjs: SHA-256 over the infrastructure config, in a fixed order. */
function infrastructureHash(root) {
  try {
    const h = createHash("sha256");
    for (const p of [
      "infra/providers/cloudflare/config-policy.json",
      "infra/providers/cloudflare/migration-registry.json",
      "apps/web/wrangler.toml",
    ]) {
      h.update(readFileSync(new URL(p, root)));
    }
    return h.digest("hex");
  } catch {
    return null;
  }
}

/** Mirror of build-release-manifest.mjs: SHA-256 over the committed k-suppressed stats release files. */
function publicStatsHash(root) {
  try {
    const dir = new URL("apps/web/static/stats/", root);
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

function main() {
  const args = process.argv.slice(2);
  let path = null;
  let mode = "draft";
  let profileName = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mode") mode = args[++i];
    else if (args[i] === "--profile") profileName = args[++i];
    else path = args[i];
  }
  if (!path) {
    console.error(
      "::error::release-manifest: usage: check-release-manifest.mjs <manifest.json> [--mode ...]",
    );
    process.exit(1);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`::error::release-manifest: cannot read ${path}: ${err.message}`);
    process.exit(1);
  }
  const root = new URL("..", import.meta.url);
  const actualHashes = {
    legalReviewHash: sha256File(new URL("docs/legal/legal-review.json", root)),
    operatorHash: sha256File(new URL("apps/web/src/lib/operator.json", root)),
    controlRegisterHash: sha256File(new URL("docs/legal/control-register.json", root)),
    controlPlaneHash: sha256File(new URL("data/governance/control-plane.json", root)),
    rightsManifestHash: sha256File(new URL("data/rights/rights-classes.json", root)),
    productBoundaryHash: sha256File(new URL("data/legal/product-boundary.json", root)),
    ballotVerificationHash: ballotVerificationHash(root),
    infrastructureHash: infrastructureHash(root),
    publicStatsHash: publicStatsHash(root),
  };
  let actualControls = null;
  try {
    const register = JSON.parse(
      readFileSync(new URL("docs/legal/control-register.json", root), "utf8"),
    );
    actualControls = (register.controls ?? [])
      .map((c) => ({ id: c.id, status: c.status }))
      .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  } catch {
    // Leave null: the missing-artefact path is already covered by controlRegisterHash verification.
  }
  let requiredControls = [];
  if (profileName) {
    try {
      const profiles = JSON.parse(
        readFileSync(new URL("docs/legal/release-profiles.json", root), "utf8"),
      );
      const p = profiles.profiles?.[profileName];
      if (!p || !Array.isArray(p.requiredControls)) {
        console.error(`::error::release-manifest: unknown release profile "${profileName}"`);
        process.exit(1);
      }
      requiredControls = p.requiredControls;
    } catch (err) {
      console.error(`::error::release-manifest: cannot read release-profiles.json: ${err.message}`);
      process.exit(1);
    }
  }
  const result = verdict(manifest, {
    mode,
    actualHashes,
    actualControls,
    requiredControls,
    profile: profileName,
  });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::release-manifest: ${e}`);
    console.error(`release manifest (${mode}): ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  const pendingCount = Object.keys(manifest.pending ?? {}).length;
  if (mode === "draft" && pendingCount === 0) {
    // Tripwire: nothing is pending, so the production gate would now pass — the deploy/CI mode
    // should flip to --mode production rather than silently staying in draft.
    console.error(
      "::warning::release-manifest: pending set is empty — flip verification to --mode production",
    );
  }
  console.info(
    `release manifest OK (${mode}${profileName ? `, profile ${profileName}` : ""})${
      pendingCount ? ` — ${pendingCount} field(s) pending` : ""
    }`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
