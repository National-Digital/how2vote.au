#!/usr/bin/env node
/**
 * @fileoverview CI guard: the vendor / third-party control framework is complete, fresh and
 * enforced.
 *
 * The registry (apps/web/src/lib/privacy/third-party-services.json) declares every external service
 * the project loads or contacts. This guard proves:
 *   - every infrastructure vendor (Cloudflare, GitHub, They Vote For You / OpenAustralia Foundation)
 *     carries the required vendor-control fields — role, data processing, retention, subprocessors,
 *     data location, and a DPA/contract record referencing external evidence by ID;
 *   - contract review dates are fresh — an overdue nextReviewDate, or contract.status "expired",
 *     fails the build so expired evidence cannot reach deploy (fail-closed);
 *   - the anti-abuse posture is ACCESSIBLE — at least one accessible mechanism exists and no
 *     registered mechanism is an inaccessible interactive challenge without an accessible alternative;
 *   - cost-completeness — every vendor has a matching electoral-expenditure record (a $0 record
 *     counts), so no vendor escapes the funding/expenditure register;
 *   - no prod code contacts an UNREGISTERED host — the browser CSP is derived purely from the
 *     registry (the base policy hardcodes no external origin) and every host a server-runtime
 *     (Cloudflare Pages) function contacts is in the generated network allowlist.
 *
 * DPAs/contracts are EXTERNAL evidence held in the restricted legal records; the registry references
 * them by ID and marks them "pending" until they are reviewed and filed. Pending is allowed
 * (partial-passing) — this guard never invents an approval — but "expired" fails closed.
 *
 * The build-time data pipeline (packages/*) is maintainer/CI ETL, not production runtime, and its
 * data-source egress (AEC, TVFY) is governed by the provenance/source-record controls;
 * those hosts are still catalogued in the registry allowlist for completeness.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/git/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-vendor-registry.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { deriveNetworkAllowlist } from "./generate-vendor-allowlist.mjs";

const REGISTRY_REL = "apps/web/src/lib/privacy/third-party-services.json";
const EXPENDITURE_REL = "docs/legal/electoral-expenditure.json";
const SVELTE_CONFIG_REL = "apps/web/svelte.config.js";
const CONTRACT_EVIDENCE_ID = "EV-VENDOR-CONTRACT-REVIEW";

/** Infrastructure vendors the framework requires to be present. */
const REQUIRED_INFRA_IDS = ["cloudflare", "github", "tvfy"];
const CONTRACT_STATUS = ["pending", "current", "expired"];

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/** @param {unknown} v @returns {number | null} */
function parseIsoDate(v) {
  if (!isNonEmptyString(v)) return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) {
    return null;
  }
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/** Extract host authorities from every http(s) URL literal in `text`. */
export function hostsInText(text) {
  const out = [];
  const re = /https?:\/\/([^/\s"'`)]+)/gi;
  let m;
  while ((m = re.exec(String(text))) !== null) out.push(m[1]);
  return out;
}

/** Does `host` match an allowlist entry (exact, or a "*.suffix" wildcard)? */
export function hostAllowed(host, allowlist) {
  for (const entry of allowlist) {
    if (entry === host) return true;
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1); // ".google-analytics.com"
      if (host.endsWith(suffix)) return true;
    }
  }
  return false;
}

/**
 * A vendor is cost-covered when some expenditure record's supplier or category matches its name or
 * id (case-insensitive, substring, either direction). Mirrors the expenditure guard's matcher.
 */
function vendorIsCosted(vendor, records) {
  const needles = [vendor.name, vendor.id].filter(isNonEmptyString).map((s) => s.toLowerCase());
  if (needles.length === 0) return false;
  for (const r of records) {
    if (!r || typeof r !== "object") continue;
    const hay = [r.supplier, r.category].filter(isNonEmptyString).map((s) => s.toLowerCase());
    for (const h of hay) for (const n of needles) if (h.includes(n) || n.includes(h)) return true;
  }
  return false;
}

/** Validate one infrastructure vendor entry; push errors with a label prefix. */
function checkInfraVendor(v, at, now, push) {
  for (const key of [
    "id",
    "name",
    "provider",
    "role",
    "dataProcessing",
    "retention",
    "dataLocation",
    "privacyPolicyUrl",
  ]) {
    if (!isNonEmptyString(v[key])) push(`${at}: missing ${key}`);
  }
  if (v.surface !== "infrastructure") push(`${at}: surface must be "infrastructure"`);
  if (!Array.isArray(v.egressHosts) || v.egressHosts.some((h) => !isNonEmptyString(h))) {
    push(`${at}: egressHosts must be an array of hostnames (may be empty)`);
  }
  // Subprocessors: an array; if empty, the vendor must point to a published list or explain its absence.
  if (!Array.isArray(v.subprocessors)) {
    push(`${at}: subprocessors must be an array`);
  } else if (
    v.subprocessors.length === 0 &&
    !isNonEmptyString(v.subprocessorsUrl) &&
    !isNonEmptyString(v.subprocessorsNote)
  ) {
    push(
      `${at}: subprocessors is empty and neither subprocessorsUrl nor subprocessorsNote is provided`,
    );
  } else {
    for (const [i, s] of v.subprocessors.entries()) {
      if (
        !s ||
        typeof s !== "object" ||
        !isNonEmptyString(s.name) ||
        !isNonEmptyString(s.purpose)
      ) {
        push(`${at}: subprocessors[${i}] must have a name and purpose`);
      }
    }
  }
  // Contract / DPA evidence.
  const c = v.contract;
  if (!c || typeof c !== "object") {
    push(`${at}: missing contract record`);
    return;
  }
  if (!isNonEmptyString(c.type)) push(`${at}: contract.type is required`);
  if (c.evidenceId !== CONTRACT_EVIDENCE_ID) {
    push(`${at}: contract.evidenceId must be "${CONTRACT_EVIDENCE_ID}"`);
  }
  if (!CONTRACT_STATUS.includes(c.status)) {
    push(`${at}: contract.status must be one of ${CONTRACT_STATUS.join(", ")}`);
  }
  if (c.status === "expired") {
    push(`${at}: contract evidence is expired and must be renewed before deploy (fail-closed)`);
  }
  if (parseIsoDate(c.reviewDate) === null) push(`${at}: contract.reviewDate must be an ISO date`);
  const next = parseIsoDate(c.nextReviewDate);
  if (next === null) push(`${at}: contract.nextReviewDate must be an ISO date`);
  else if (now > next) {
    push(
      `${at}: vendor review overdue (contract.nextReviewDate ${c.nextReviewDate}) — fail-closed`,
    );
  }
}

/**
 * Validate the whole vendor-control framework.
 *
 * @param {unknown} registry parsed third-party-services.json
 * @param {{
 *   now?: number,
 *   expenditure?: unknown,
 *   svelteConfig?: string,
 *   functionSources?: { path: string, text: string }[],
 * }} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(registry, options = {}) {
  const errors = [];
  const now = options.now ?? Date.now();
  const push = (m) => errors.push(m);

  if (typeof registry !== "object" || registry === null || Array.isArray(registry)) {
    return { ok: false, errors: ["vendor registry: not a JSON object"] };
  }

  // Infrastructure vendors
  const infra = Array.isArray(registry.infrastructure) ? registry.infrastructure : null;
  if (infra === null) {
    push("infrastructure: must be an array");
  } else {
    const ids = new Set();
    for (const [i, v] of infra.entries()) {
      if (!v || typeof v !== "object") {
        push(`infrastructure[${i}]: not an object`);
        continue;
      }
      const at = isNonEmptyString(v.id) ? `vendor ${v.id}` : `infrastructure[${i}]`;
      checkInfraVendor(v, at, now, push);
      if (isNonEmptyString(v.id)) ids.add(v.id);
    }
    for (const id of REQUIRED_INFRA_IDS) {
      if (!ids.has(id)) push(`infrastructure: required vendor "${id}" is missing`);
    }
  }

  // Anti-abuse accessibility
  const known = new Set();
  for (const s of registry.services ?? []) if (s && isNonEmptyString(s.id)) known.add(s.id);
  for (const v of infra ?? []) if (v && isNonEmptyString(v.id)) known.add(v.id);

  const antiAbuse = Array.isArray(registry.antiAbuse) ? registry.antiAbuse : null;
  if (antiAbuse === null) {
    push("antiAbuse: must be an array");
  } else if (antiAbuse.length === 0) {
    push("antiAbuse: at least one anti-abuse mechanism must be registered");
  } else {
    const byId = new Map();
    for (const a of antiAbuse) if (a && isNonEmptyString(a.id)) byId.set(a.id, a);
    let accessibleCount = 0;
    for (const [i, a] of antiAbuse.entries()) {
      if (!a || typeof a !== "object") {
        push(`antiAbuse[${i}]: not an object`);
        continue;
      }
      const at = isNonEmptyString(a.id) ? `antiAbuse ${a.id}` : `antiAbuse[${i}]`;
      for (const key of ["id", "service", "mechanism", "note"]) {
        if (!isNonEmptyString(a[key])) push(`${at}: missing ${key}`);
      }
      if (typeof a.interactive !== "boolean") push(`${at}: interactive must be a boolean`);
      if (typeof a.accessible !== "boolean") push(`${at}: accessible must be a boolean`);
      if (isNonEmptyString(a.service) && !known.has(a.service)) {
        push(`${at}: service "${a.service}" is not a registered service or vendor`);
      }
      if (a.accessible === true && a.interactive === false) accessibleCount++;
      // The core accessibility rule: no inaccessible / interactive challenge without an accessible
      // alternative.
      const needsAlternative = a.accessible === false || a.interactive === true;
      if (needsAlternative) {
        const alt = a.accessibleAlternative;
        const altOk =
          isNonEmptyString(alt) &&
          byId.get(alt)?.accessible === true &&
          byId.get(alt)?.interactive === false;
        if (!altOk) {
          push(
            `${at}: an inaccessible or interactive anti-abuse challenge must name an accessible, non-interactive accessibleAlternative`,
          );
        }
      }
    }
    if (accessibleCount === 0) {
      push(
        "antiAbuse: no accessible, non-interactive mechanism is registered (accessibility barrier)",
      );
    }
  }

  // Cost-completeness. The expenditure register (schemaVersion 3) nests its records per
  // reporting period; the flat records array is the pre-v3 shape, still accepted.
  if (options.expenditure) {
    const exp = options.expenditure;
    const records =
      exp && typeof exp === "object"
        ? Array.isArray(exp.periods)
          ? exp.periods.flatMap((p) => (Array.isArray(p?.records) ? p.records : []))
          : Array.isArray(exp.records)
            ? exp.records
            : null
        : null;
    if (records === null || records.length === 0) {
      push("expenditure: malformed (expected an object with period records)");
    } else {
      const vendors = [...(registry.services ?? []), ...(infra ?? [])];
      for (const vendor of vendors) {
        if (!vendor || typeof vendor !== "object") continue;
        if (!vendorIsCosted(vendor, records)) {
          const name = isNonEmptyString(vendor.name) ? vendor.name : (vendor.id ?? "(unnamed)");
          push(`cost-completeness: vendor "${name}" has no matching electoral-expenditure record`);
        }
      }
    }
  }

  // Host enforcement: no prod code contacts an unregistered host
  const allowlist = deriveNetworkAllowlist(registry);

  // Browser: the CSP must be derived from the registry, and the base policy must hardcode no external
  // origin (otherwise a host could reach the browser without ever being registered).
  if (typeof options.svelteConfig === "string") {
    const cfg = options.svelteConfig;
    if (!cfg.includes("mergeRegistryCsp(")) {
      push(
        "svelte.config.js: CSP no longer merges the registry (mergeRegistryCsp) — browser hosts must come from the registry",
      );
    }
    const baseMatch = /const BASE_CSP\s*=\s*\{([\s\S]*?)\n\};/.exec(cfg);
    if (!baseMatch) {
      push(
        "svelte.config.js: could not locate the BASE_CSP block to verify it declares no external origin",
      );
    } else if (/https?:\/\//i.test(baseMatch[1])) {
      push(
        "svelte.config.js: BASE_CSP hardcodes an external origin — every external origin must come from the registry",
      );
    }
    // Also scan the executable config (comments stripped) for any hardcoded origin OUTSIDE the
    // registry — this covers channel-specific additions (e.g. the native connect-src), not just
    // BASE_CSP. The site's OWN canonical origin is first-party (the WebView origin is local, so the
    // native shell's call to our own API is cross-origin to us) and is the only permitted literal;
    // every third-party host must still come from the registry.
    const FIRST_PARTY_ORIGIN = "https://how2vote.au";
    // Strip block comments, then line comments — but only where the `//` is NOT preceded by `:`,
    // so the `//` inside `https://` URLs is never mistaken for a comment.
    const codeOnly = cfg.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const external = [...(codeOnly.match(/https?:\/\/[a-z0-9.-]+/gi) ?? [])].filter(
      (o) => o.toLowerCase() !== FIRST_PARTY_ORIGIN,
    );
    if (external.length > 0) {
      push(
        `svelte.config.js: hardcodes external origin(s) ${[...new Set(external)].join(", ")} outside the registry — every external origin must come from the registry`,
      );
    }
  }

  // Server runtime (Cloudflare Pages Functions): every host a function contacts must be allowlisted.
  for (const { path, text } of options.functionSources ?? []) {
    for (const host of hostsInText(text)) {
      if (!hostAllowed(host, allowlist)) {
        push(`${path}: contacts unregistered host "${host}" — add the vendor to the registry`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/git/fs plumbing, exercised via CI not unit tests */
const ROOT = new URL("..", import.meta.url);

function safeReadJson(rel) {
  return JSON.parse(readFileSync(new URL(rel, ROOT), "utf8"));
}

/** Server-runtime function sources to scan (Cloudflare Pages Functions), excluding tests. */
function gatherFunctionSources(root) {
  let listed;
  try {
    listed = execFileSync("git", ["ls-files", "apps/web/functions"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    })
      .split("\n")
      .filter((p) => /\.(ts|js|mjs)$/.test(p) && !/\.test\.(ts|js|mjs)$/.test(p));
  } catch {
    listed = [];
  }
  return listed.map((rel) => {
    let text;
    try {
      text = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
    } catch {
      text = "";
    }
    return { path: rel, text };
  });
}

function main() {
  let registry, expenditure, svelteConfig;
  try {
    registry = safeReadJson(REGISTRY_REL);
    expenditure = safeReadJson(EXPENDITURE_REL);
    svelteConfig = readFileSync(new URL(SVELTE_CONFIG_REL, ROOT), "utf8");
  } catch (err) {
    console.error(`::error::vendor-registry: cannot read inputs: ${err.message}`);
    process.exit(1);
    return;
  }
  const functionSources = gatherFunctionSources(fileURLToPath(ROOT));
  const result = verdict(registry, { expenditure, svelteConfig, functionSources });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::vendor-registry: ${e}`);
    console.error(`vendor registry: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  const n = (registry.infrastructure ?? []).length + (registry.services ?? []).length;
  console.info(`vendor registry OK — ${n} vendors, anti-abuse accessible, no unregistered host`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
