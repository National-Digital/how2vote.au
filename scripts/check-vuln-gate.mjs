#!/usr/bin/env node
/**
 * @fileoverview Deploy gate: block promotion on any high/critical dependency vulnerability that is
 * not covered by a signed, time-limited risk acceptance.
 *
 * `pnpm audit` already fails CI on a new high/critical advisory. This gate adds the ONLY sanctioned
 * escape hatch and makes it auditable: a high/critical advisory may pass ONLY if the security
 * register (docs/legal/security-register.json) carries a matching riskAcceptances[] entry that names
 * an approver, an acceptance date and a FUTURE expiry. A missing or expired acceptance fails closed —
 * the deploy is blocked, never silently allowed. The policy (which severities block, and that a
 * signed acceptance is required) is itself read from the register.
 *
 * Pure decision logic is exported as verdict() for unit tests; the audit/CLI plumbing only runs when
 * the script is executed directly.
 *
 * Usage:
 *   node scripts/check-vuln-gate.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/** Parse an ISO-8601 date to epoch ms, or null. */
function parseIsoDate(v) {
  if (!isNonEmptyString(v)) return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) {
    return null;
  }
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/** Does a risk acceptance cover this advisory? Match by GHSA id, numeric id or module name. */
function accepts(ra, advisory) {
  const ref = String(ra.advisory ?? "").trim();
  if (!ref) return false;
  return (
    ref === String(advisory.id ?? "") ||
    ref === String(advisory.ghsa ?? "") ||
    ref === String(advisory.module ?? "")
  );
}

/**
 * Decide whether the vulnerability posture permits a deploy.
 *
 * @param {{
 *   advisories: { id?: string|number, ghsa?: string, module?: string, severity: string, title?: string }[],
 *   riskAcceptances: { advisory?: string, acceptedBy?: string, acceptedAt?: string, expiresAt?: string, justification?: string }[],
 *   blockSeverities?: string[],
 *   now?: number,
 * }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input) {
  const errors = [];
  const push = (m) => errors.push(m);
  const now = input?.now ?? Date.now();

  const advisories = Array.isArray(input?.advisories) ? input.advisories : null;
  if (advisories === null) {
    return { ok: false, errors: ["advisories: expected an array (fail-closed)"] };
  }
  const block = new Set(
    (Array.isArray(input?.blockSeverities) ? input.blockSeverities : ["high", "critical"]).map(
      (s) => String(s).toLowerCase(),
    ),
  );
  const ras = Array.isArray(input?.riskAcceptances) ? input.riskAcceptances : [];

  for (const a of advisories) {
    if (!a || typeof a !== "object") continue;
    const severity = String(a.severity ?? "").toLowerCase();
    if (!block.has(severity)) continue;

    const label = `${severity} advisory ${a.ghsa ?? a.id ?? a.module ?? "(unknown)"}${
      a.module ? ` in ${a.module}` : ""
    }`;
    const ra = ras.find((r) => accepts(r, a));
    if (!ra) {
      push(`${label}: no signed risk acceptance — deploy blocked (fail-closed)`);
      continue;
    }
    if (!isNonEmptyString(ra.acceptedBy)) {
      push(`${label}: risk acceptance is unsigned (no acceptedBy)`);
    }
    if (!isNonEmptyString(ra.justification)) {
      push(`${label}: risk acceptance has no justification`);
    }
    if (parseIsoDate(ra.acceptedAt) === null) {
      push(`${label}: risk acceptance has no valid acceptedAt`);
    }
    const expires = parseIsoDate(ra.expiresAt);
    if (expires === null) {
      push(`${label}: risk acceptance has no valid expiresAt`);
    } else if (expires < now) {
      push(`${label}: risk acceptance expired at ${ra.expiresAt} — deploy blocked (fail-closed)`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Normalise pnpm/npm audit JSON into a flat advisory list. Fails CLOSED on format drift: if the
 *  output carries neither the `advisories` map nor a `metadata.vulnerabilities` summary, the shape is
 *  unrecognised (a pnpm output change) and we must NOT silently report "0 advisories" — a real
 *  high/critical could then ship behind a green gate. Mirrors build-sbom.mjs's lockfile guard. */
export function toAdvisories(audit) {
  const raw = audit?.advisories;
  const hasAdvisories = raw && typeof raw === "object";
  const hasSummary =
    audit?.metadata?.vulnerabilities && typeof audit.metadata.vulnerabilities === "object";
  if (!hasAdvisories && !hasSummary) {
    throw new Error(
      "pnpm audit output has no `advisories` map or `metadata.vulnerabilities` summary — unrecognised format (fail closed rather than report zero)",
    );
  }
  if (!hasAdvisories) {
    // Recognised format (summary present) but no advisories map: if the summary counts any
    // vulnerability, the shape drifted in a way we cannot enumerate — fail closed.
    const counts = Object.values(audit.metadata.vulnerabilities).filter(
      (n) => typeof n === "number",
    );
    const total = counts.reduce((a, b) => a + b, 0);
    if (total > 0) {
      throw new Error(
        `pnpm audit summary reports ${total} vulnerability(ies) but no enumerable advisories — unrecognised format (fail closed)`,
      );
    }
    return [];
  }
  return Object.values(raw).map((a) => ({
    id: a.id,
    ghsa: a.github_advisory_id,
    module: a.module_name,
    severity: a.severity,
    title: a.title,
  }));
}

/* c8 ignore start -- audit/CLI plumbing, exercised via CI not unit tests */
const REGISTER = new URL("../docs/legal/security-register.json", import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));

/** Run `pnpm audit --json` and return parsed JSON. pnpm exits non-zero when advisories exist, so we
 *  read stdout from the thrown error too. */
function runAudit() {
  let stdout;
  try {
    stdout = execFileSync("pnpm", ["audit", "--json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    stdout = err.stdout;
    if (!isNonEmptyString(stdout)) {
      throw new Error(`pnpm audit produced no output: ${err.message}`, { cause: err });
    }
  }
  return JSON.parse(stdout);
}

function main() {
  let register;
  try {
    register = JSON.parse(readFileSync(REGISTER, "utf8"));
  } catch (err) {
    console.error(`::error::vuln-gate: cannot read security register: ${err.message}`);
    process.exit(1);
    return;
  }
  let advisories;
  try {
    advisories = toAdvisories(runAudit());
  } catch (err) {
    console.error(`::error::vuln-gate: audit failed: ${err.message}`);
    process.exit(1);
    return;
  }
  const result = verdict({
    advisories,
    riskAcceptances: register.riskAcceptances ?? [],
    blockSeverities: register.vulnerabilityPolicy?.blockSeverities,
  });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::vuln-gate: ${e}`);
    console.error(`vulnerability gate: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  console.info(
    `vulnerability gate OK — ${advisories.length} advisory(ies) audited, none block deployment`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
