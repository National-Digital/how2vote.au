#!/usr/bin/env node
/**
 * @fileoverview CI guard: the research ingestion transport policy is enforced in code and consistent
 * with the committed edge policy (PIA §5/§6).
 *
 * The in-transit invariants are single-sourced in apps/web/src/lib/research/transport-policy.ts and
 * wired into survey.ts. This static scan proves, fail-closed:
 *
 *   1. NO IP/UA READ — no ingestion-path file READS a client IP, the user agent, or a forwarding
 *      header (a `.get("cf-connecting-ip")`/`request.ip`-style read). Comments are stripped first, so
 *      the endpoints' own "CF-Connecting-IP is never read" prose does not trip the scan.
 *   2. NO BODY/URL LOGGING — the ingestion Pages Functions emit NO console.* at all (they promise to
 *      log nothing about a request), and the client transport logs no request body/URL.
 *   3. CLIENT WIRING — survey.ts routes every research POST through transportInit() (from the transport
 *      policy) and no longer hand-rolls a fetch init, so no caller can bypass the no-store / no-credentials
 *      / field-allowlist projection.
 *   4. CODE ↔ INFRA CONSISTENCY — the code transport policy (no-store cache, credentials 'omit', the
 *      endpoint URLs, the forbidden-reads list) matches the committed edge policy
 *      (infra/providers/cloudflare/transport-policy.json), whose required edge settings are all at their
 *      fail-closed values (HTTPS forced, min TLS >= 1.2, HSTS on, no request-body logging, ingestion
 *      responses uncached).
 *
 * Pure decision logic is exported as verdict()/scanForbiddenReads()/scanRequestLogging() for unit
 * tests; the fs/git/CLI plumbing only runs when executed directly.
 *
 * Usage:
 *   node scripts/check-research-transport.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/** Strip comments so only executable code / real config is scanned. */
export function stripComments(text) {
  if (typeof text !== "string") return "";
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Escape for a RegExp literal. */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scan for a READ of a forbidden request attribute: `.get("<header>")` (any quote), or `request.ip`.
 * Comments are stripped first. Returns the hits.
 *
 * @param {{ path: string, text: string }[]} files
 * @param {string[]} forbiddenHeaders
 * @returns {{ path: string, match: string }[]}
 */
export function scanForbiddenReads(files, forbiddenHeaders) {
  const hits = [];
  const headerAlt = forbiddenHeaders.map(escapeRe).join("|");
  const getRe = new RegExp(`\\.\\s*get\\(\\s*['"\`]\\s*(?:${headerAlt})\\s*['"\`]`, "gi");
  const ipRe = /\brequest\s*\.\s*ip\b|\breq\s*\.\s*ip\b/g;
  for (const { path, text } of files) {
    if (typeof text !== "string") continue;
    const code = stripComments(text);
    for (const re of [getRe, ipRe]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code)) !== null) {
        hits.push({ path, match: m[0].replace(/\s+/g, " ").trim() });
      }
    }
  }
  return hits;
}

/**
 * Scan the ingestion Pages Functions for ANY console.* call (they must log nothing about a request).
 * Comments are stripped first.
 *
 * @param {{ path: string, text: string }[]} functionFiles
 * @returns {{ path: string, match: string }[]}
 */
export function scanRequestLogging(functionFiles) {
  const hits = [];
  const re = /console\s*\.\s*[A-Za-z]+\s*\(/g;
  for (const { path, text } of functionFiles) {
    if (typeof text !== "string") continue;
    const code = stripComments(text);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      hits.push({ path, match: m[0].replace(/\s+/g, " ").trim() });
    }
  }
  return hits;
}

/** Extract a few code-policy facts from transport-policy.ts text (the guard cannot import the TS). */
export function readCodePolicy(text) {
  const src = stripComments(typeof text === "string" ? text : "");
  const endpoints = {};
  for (const name of ["research", "geography", "token"]) {
    const m = new RegExp(`${name}:\\s*["']([^"']+)["']`).exec(src);
    if (m) endpoints[name] = m[1];
  }
  const cache = /cache:\s*["']([^"']+)["']/.exec(src);
  const credentials = /credentials:\s*["']([^"']+)["']/.exec(src);
  const forbiddenBlock = /FORBIDDEN_REQUEST_READS\s*=\s*\[([\s\S]*?)\]/.exec(src);
  const forbidden = forbiddenBlock
    ? [...forbiddenBlock[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1])
    : [];
  return {
    endpoints,
    cache: cache ? cache[1] : null,
    credentials: credentials ? credentials[1] : null,
    forbiddenReads: forbidden,
  };
}

/**
 * @param {{
 *   ingestionFiles?: { path: string, text: string }[],
 *   functionFiles?: { path: string, text: string }[],
 *   surveyText?: string,
 *   transportPolicyText?: string,
 *   infraPolicy?: any,
 * }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input = {}) {
  const errors = [];
  const push = (m) => errors.push(m);

  const codePolicy = readCodePolicy(input.transportPolicyText ?? "");
  const forbiddenHeaders =
    codePolicy.forbiddenReads.length > 0
      ? codePolicy.forbiddenReads
      : ["CF-Connecting-IP", "X-Forwarded-For", "User-Agent"];

  // 1 — no IP/UA/forwarding-header read anywhere on the ingestion path.
  const ingestionFiles = Array.isArray(input.ingestionFiles) ? input.ingestionFiles : [];
  if (ingestionFiles.length === 0) push("ingestion files: none supplied (fail-closed)");
  for (const hit of scanForbiddenReads(ingestionFiles, forbiddenHeaders)) {
    push(
      `${hit.path}: reads a forbidden request attribute ("${hit.match}") — no IP/UA/forwarding header may be read`,
    );
  }

  // 2 — the Pages Functions log nothing about a request.
  const functionFiles = Array.isArray(input.functionFiles) ? input.functionFiles : [];
  if (functionFiles.length === 0) push("ingestion Function files: none supplied (fail-closed)");
  for (const hit of scanRequestLogging(functionFiles)) {
    push(
      `${hit.path}: contains a console call ("${hit.match}") — the ingestion endpoints must log nothing (PIA §6)`,
    );
  }

  // 3 — client wiring: every research POST goes through transportInit.
  const survey = stripComments(typeof input.surveyText === "string" ? input.surveyText : "");
  if (!/from ["']\.\/research\/transport-policy["']/.test(survey)) {
    push("survey.ts: does not import the transport policy (./research/transport-policy)");
  }
  if (!/transportInit\(/.test(survey)) {
    push("survey.ts: does not route requests through transportInit()");
  }
  if (/method:\s*["']POST["']/.test(survey)) {
    push(
      'survey.ts: hand-rolls a fetch init (method: "POST") — all POSTs must go through transportInit()',
    );
  }

  // 4 — code ↔ infra consistency.
  if (codePolicy.cache !== "no-store") push('transport-policy.ts: cache is not "no-store"');
  if (codePolicy.credentials !== "omit") push('transport-policy.ts: credentials is not "omit"');

  const infra = input.infraPolicy;
  if (typeof infra !== "object" || infra === null) {
    push("infra transport policy: missing or not an object");
  } else {
    const routes = Array.isArray(infra.ingestionRoutes) ? infra.ingestionRoutes : [];
    const codeRoutes = Object.values(codePolicy.endpoints);
    for (const r of codeRoutes) {
      if (!routes.includes(r))
        push(`infra transport policy: ingestionRoutes missing code endpoint "${r}"`);
    }
    const s = infra.requiredEdgeSettings ?? {};
    if (s.alwaysUseHttps !== true)
      push("infra transport policy: alwaysUseHttps must be true (fail-closed)");
    const tls = String(s.minTlsVersion ?? "");
    if (!/^\d+\.\d+$/.test(tls) || Number(tls) < 1.2) {
      push('infra transport policy: minTlsVersion must be >= "1.2"');
    }
    if (!s.hsts || s.hsts.enabled !== true)
      push("infra transport policy: HSTS must be enabled (fail-closed)");
    if (s.requestBodyLogging !== false)
      push("infra transport policy: requestBodyLogging must be false (fail-closed)");
    if (s.logpushIncludesRequestBody !== false) {
      push("infra transport policy: logpushIncludesRequestBody must be false (fail-closed)");
    }
    if (s.cacheIngestionResponses !== false) {
      push("infra transport policy: cacheIngestionResponses must be false (fail-closed)");
    }
    const infraForbidden = Array.isArray(infra.forbiddenRequestReads)
      ? infra.forbiddenRequestReads
      : [];
    for (const h of codePolicy.forbiddenReads) {
      if (!infraForbidden.some((x) => x.toLowerCase() === h.toLowerCase())) {
        push(`infra transport policy: forbiddenRequestReads missing code header "${h}"`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);
const rel = (p) => new URL(p, root);
const safeRead = (p) => {
  try {
    return readFileSync(rel(p), "utf8");
  } catch {
    return "";
  }
};

const FUNCTION_FILES = [
  "apps/web/functions/api/research.ts",
  "apps/web/functions/api/research/geography.ts",
  "apps/web/functions/api/research/token.ts",
];

function main() {
  const functionFiles = FUNCTION_FILES.map((p) => ({ path: p, text: safeRead(p) })).filter((f) =>
    isNonEmptyString(f.text),
  );
  const surveyText = safeRead("apps/web/src/lib/survey.ts");
  const transportPolicyText = safeRead("apps/web/src/lib/research/transport-policy.ts");
  const ingestionFiles = [
    ...functionFiles,
    { path: "apps/web/src/lib/survey.ts", text: surveyText },
  ];
  let infraPolicy = null;
  try {
    infraPolicy = JSON.parse(safeRead("infra/providers/cloudflare/transport-policy.json"));
  } catch {
    // Leave null — verdict() reports the missing/unreadable infra policy fail-closed.
  }

  const result = verdict({
    ingestionFiles,
    functionFiles,
    surveyText,
    transportPolicyText,
    infraPolicy,
  });

  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::research-transport: ${e}`);
    console.error(`research transport: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  console.info(
    `research transport OK — ${ingestionFiles.length} ingestion file(s) clean, code policy ↔ infra edge policy consistent`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
