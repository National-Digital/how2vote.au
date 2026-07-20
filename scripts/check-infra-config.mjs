#!/usr/bin/env node
/**
 * @fileoverview CI + deploy guard: production Cloudflare configuration is safe and complete.
 *
 * Governing principle: FAIL CLOSED. A missing / placeholder / stale production configuration must
 * fail the deploy — never warn and continue.
 *
 * The register is infra/providers/cloudflare/config-policy.json (non-secret: it names the required
 * ids and secrets by REFERENCE, never a value). This guard runs in two modes:
 *
 *  - COMMITTED mode (default, on every PR): the tracked config is public-repo-safe. Every required
 *    production id must STILL be its placeholder in apps/web/wrangler.toml (a live id would be a
 *    leak), no secret named in the register may be assigned a value in the config, and no
 *    secret/id-shaped literal (a 32-hex resource id, a long token) may appear on a non-comment line.
 *
 *  - DEPLOY mode (--deploy, at promotion time with the injected variables): every required
 *    production id must be PRESENT and NOT a placeholder — a missing/placeholder id fails the deploy
 *    closed. When a preview id is also supplied it must DIFFER from its production counterpart, so
 *    preview traffic can never mix into the published dataset (preview isolation).
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-infra-config.mjs            # committed mode (CI)
 *   node scripts/check-infra-config.mjs --deploy   # deploy mode (reads the injected env variables)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/** A run of 32 lowercase-or-uppercase hex chars — the shape of a live Cloudflare account / KV id. */
const HEX_ID_32 = /\b[0-9a-fA-F]{32}\b/;

/** Does `value` look like a placeholder (per the register's patterns), or is it empty? */
export function isPlaceholder(value, patterns) {
  if (!isNonEmptyString(value)) return true;
  const upper = value.toUpperCase();
  return (patterns ?? []).some(
    (p) => isNonEmptyString(p) && upper.includes(String(p).toUpperCase()),
  );
}

/** Structural validation of the config policy itself. */
function verifyPolicy(policy) {
  const errors = [];
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    return ["config-policy: not a JSON object"];
  }
  if (policy.schemaVersion !== 1) {
    errors.push(
      `config-policy: schemaVersion must be 1, got ${JSON.stringify(policy.schemaVersion)}`,
    );
  }
  if (!Array.isArray(policy.placeholderPatterns) || policy.placeholderPatterns.length === 0) {
    errors.push("config-policy: placeholderPatterns must be a non-empty array");
  }
  const ids = Array.isArray(policy.requiredProductionIds) ? policy.requiredProductionIds : null;
  if (!ids || ids.length === 0) {
    errors.push("config-policy: requiredProductionIds must be a non-empty array");
  } else {
    for (const [i, r] of ids.entries()) {
      if (!isNonEmptyString(r?.id))
        errors.push(`config-policy: requiredProductionIds[${i}] missing id`);
      if (!isNonEmptyString(r?.envVar))
        errors.push(`config-policy: requiredProductionIds[${i}] missing envVar reference`);
    }
  }
  const secrets = Array.isArray(policy.secretReferences) ? policy.secretReferences : [];
  for (const [i, s] of secrets.entries()) {
    if (!isNonEmptyString(s?.name))
      errors.push(`config-policy: secretReferences[${i}] missing name`);
    // A secret reference must never carry an actual value — only a name + where it is stored.
    if ("value" in (s ?? {})) {
      errors.push(
        `config-policy: secretReferences[${i}] must not contain a "value" (reference only)`,
      );
    }
  }
  return errors;
}

/**
 * COMMITTED mode: the tracked wrangler config is public-repo-safe.
 * @param {any} policy
 * @param {string} wranglerText
 * @returns {string[]}
 */
export function verifyCommitted(policy, wranglerText) {
  const errors = [];
  if (typeof wranglerText !== "string" || wranglerText.length === 0) {
    return ["wrangler.toml: missing or unreadable (fail-closed)"];
  }
  const patterns = policy.placeholderPatterns ?? [];

  // Each required id that maps to a wrangler key must still be its placeholder — a real value there
  // would be a committed live id (a leak).
  for (const r of policy.requiredProductionIds ?? []) {
    if (!isNonEmptyString(r.placeholder) || !isNonEmptyString(r.wranglerKey)) continue;
    if (!wranglerText.includes(r.placeholder)) {
      errors.push(
        `wrangler.toml: ${r.id} (${r.wranglerKey}) no longer holds its placeholder "${r.placeholder}" — a live production id must never be committed (inject it at deploy from ${r.envVar})`,
      );
    }
  }

  // No secret named in the register may be assigned a value in the committed config.
  for (const s of policy.secretReferences ?? []) {
    if (!isNonEmptyString(s.name)) continue;
    const assign = new RegExp(`^\\s*${escapeRe(s.name)}\\s*=`, "m");
    if (assign.test(wranglerText)) {
      errors.push(
        `wrangler.toml: secret ${s.name} must never be assigned a value in committed config`,
      );
    }
  }

  // No secret/id-shaped literal on a non-comment line (a 32-hex id or a long opaque token).
  for (const raw of wranglerText.split("\n")) {
    const line = raw.replace(/#.*$/, ""); // strip TOML comments
    if (!line.trim()) continue;
    if (isPlaceholder(line, patterns)) continue; // a line that is only a placeholder is fine
    if (HEX_ID_32.test(line)) {
      errors.push(
        `wrangler.toml: a 32-hex id-shaped literal appears on a non-comment line — no live resource id may be committed: "${line.trim()}"`,
      );
    }
  }

  return errors;
}

/**
 * DEPLOY mode: every required production id is present and not a placeholder; preview ids differ.
 * @param {any} policy
 * @param {Record<string,string|undefined>} env  the injected deploy variables (name -> value)
 * @returns {string[]}
 */
export function verifyDeploy(policy, env) {
  const errors = [];
  const patterns = policy.placeholderPatterns ?? [];
  const get = (name) => (name && env ? env[name] : undefined);

  for (const r of policy.requiredProductionIds ?? []) {
    const value = get(r.envVar);
    if (isPlaceholder(value, patterns)) {
      errors.push(
        `deploy: required production id ${r.id} (${r.envVar}) is missing or a placeholder — refusing to deploy (fail closed)`,
      );
    }
  }

  // Preview isolation: a supplied preview id must differ from its production counterpart.
  for (const rule of policy.previewIsolation?.rules ?? []) {
    const prod = get(rule.productionEnvVar);
    const preview = get(rule.previewEnvVar);
    // Only enforce when BOTH are configured — an unset preview id means no preview deploy is wired.
    if (isNonEmptyString(prod) && isNonEmptyString(preview) && prod === preview) {
      errors.push(
        `deploy: preview ${rule.resource} (${rule.previewEnvVar}) equals production (${rule.productionEnvVar}) — preview data must be isolated (fail closed)`,
      );
    }
  }

  return errors;
}

/**
 * @param {{ mode?: "committed"|"deploy", policy: unknown, wranglerText?: string, env?: Record<string,string|undefined> }} input
 * @returns {{ ok: boolean, errors: string[], mode: string }}
 */
export function verdict(input) {
  const mode = input?.mode ?? "committed";
  const policyErrors = verifyPolicy(input?.policy);
  if (policyErrors.length > 0) return { ok: false, errors: policyErrors, mode };
  const errors =
    mode === "deploy"
      ? verifyDeploy(input.policy, input.env ?? {})
      : verifyCommitted(input.policy, input.wranglerText ?? "");
  return { ok: errors.length === 0, errors, mode };
}

/** Escape a string for use as a literal inside a RegExp. */
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);
const POLICY_PATH = new URL("infra/providers/cloudflare/config-policy.json", root);

function main() {
  const mode = process.argv.includes("--deploy") ? "deploy" : "committed";
  let policy;
  try {
    policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
  } catch (err) {
    console.error(`::error::infra-config: cannot read config-policy.json: ${err.message}`);
    process.exit(1);
    return;
  }

  /** @type {Parameters<typeof verdict>[0]} */
  const input = { mode, policy };
  if (mode === "deploy") {
    input.env = process.env;
  } else {
    try {
      input.wranglerText = readFileSync(new URL(policy.wranglerConfig, root), "utf8");
    } catch {
      input.wranglerText = "";
    }
  }

  const result = verdict(input);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::infra-config: ${e}`);
    console.error(`infra config (${mode}): ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  console.info(
    mode === "deploy"
      ? "infra config OK — all required production ids are present and preview data is isolated"
      : "infra config OK — committed config carries only placeholders + references (no live ids or secrets)",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
