#!/usr/bin/env node
/**
 * @fileoverview CI guard: the research store is AGGREGATE-ONLY (ADR-0008).
 *
 * No per-person record may be created or stored. This guard fails the build (and, in --live mode,
 * a deploy) if that could stop being true. It enforces four things:
 *
 *  (a) SOURCE SCAN — no operational source/data/config file references a row-level research table
 *      (`submission` / `submission_answer`) via DML, nor the removed one-off stale-recovery /
 *      backfill machinery (backfill-counters, submissionToIncrements, data:backfill, stats:backfill,
 *      research-backfill, counter_delta). Documentation (docs/) may narrate the history; test files
 *      may assert the ABSENCE of these tokens; both are out of scope, as is this guard + its test.
 *
 *  (b) SCHEMA REPLAY — the committed migrations (apps/web/migrations) are replayed
 *      (CREATE / ALTER ADD|DROP COLUMN / DROP TABLE) to the FINAL schema. Every SURVIVING table
 *      must be on the aggregate allowlist, and no surviving table may carry a participant /
 *      submission / answer / IP / user-agent / fine-grained-timestamp field. A CREATE TABLE for a
 *      row-level table is allowed only if a later migration drops it (net effect must be clean),
 *      which is exactly how 0001/0003's per-person tables are retired by 0005.
 *
 *  (c) PROVENANCE — the public aggregate-provenance record (docs/research/aggregate-provenance.json)
 *      is present and well-formed: cohort model, schema + consent versions, aggregation method,
 *      verification date, counter-export hash (a real hash or an explicit pending evidence
 *      reference), and an explicit `noPersonLevelSourceRetained: true` assertion; its
 *      aggregateTables list must equal the schema allowlist.
 *
 *  (d) LIVE SCHEMA (deploy, --live-tables) — the production D1 schema must contain no table outside
 *      the aggregate allowlist (plus the platform's own sqlite_/d1_/_cf_ internals). Fails closed:
 *      an empty/absent table list is treated as "could not verify" and rejected.
 *
 * Pure decision logic is exported for unit tests; the fs/git/CLI plumbing runs only when executed
 * directly.
 *
 * Usage:
 *   node scripts/check-aggregate-only.mjs
 *   node scripts/check-aggregate-only.mjs --live-tables "response_total,demographic_count,..."
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The only tables allowed to exist in the research store. Everything else is a per-person leak
 *  risk and fails closed. Keep in step with migration 0001 and the analysis plan. */
export const AGGREGATE_ALLOWLIST = [
  "response_total",
  "demographic_count",
  "proposition_count",
  "proposition_party_count",
  "weighting_frame_count",
  "consent_count",
  "collection_period_count",
  "geography_count",
];

/** Platform-owned tables that legitimately exist in a live D1 database alongside our schema. */
const LIVE_INTERNAL_TABLE = /^(sqlite_|d1_|_cf_)/i;

/** Column-name patterns that make a table person-level. Checked against every SURVIVING table. */
export const PROHIBITED_COLUMN_RULES = [
  { label: "a participant field", re: /participant/i },
  // "submission"/"submission_id" (a per-person row / its FK) but NOT "submissions" (a bare count).
  { label: "a submission field", re: /^submission(_\w+)?$/i },
  { label: "an answer field", re: /answer/i },
  { label: "an IP-address field", re: /^(client_|remote_|peer_)?ip(v[46])?(_?addr(ess)?)?$/i },
  { label: "a user-agent field", re: /^ua$|user[_-]?agent/i },
  {
    label: "a fine-grained-timestamp field",
    re: /^ts$|_at$|(^|_)(created_at|updated_at|modified_at|inserted_at|timestamp|datetime|epoch|millis?|msec|nanos?|time|clock)($|_)/i,
  },
];

/** Tokens that must not reappear in operational source/data/config (docs + tests excluded). */
export const PROHIBITED_SOURCE_RULES = [
  { label: "the row-level submission_answer table", re: /\bsubmission_answer\b/i },
  {
    label: "DML against the row-level submission table",
    re: /\b(from|into|join|update)\s+submission\b/i,
  },
  { label: "the removed submissionToIncrements backfill helper", re: /\bsubmissionToIncrements\b/ },
  { label: "the removed backfill-counters tool", re: /\bbackfill-counters\b/ },
  { label: "the removed data:backfill command", re: /\bdata:backfill\b/ },
  { label: "the removed stats:backfill command", re: /\bstats:backfill\b/ },
  { label: "the removed research-backfill workflow", re: /\bresearch-backfill\b/ },
  { label: "the rejected per-cell delta log", re: /\bcounter_delta\b/ },
];

/** Split a column-definition body on TOP-LEVEL commas (ignoring commas inside parentheses). */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

const TABLE_CONSTRAINT = /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|KEY)\b/i;

/** Extract column names from a CREATE TABLE body (skipping table-level constraints). */
function columnsOf(body) {
  const cols = [];
  for (const raw of splitTopLevel(body)) {
    const item = raw.trim();
    if (!item || TABLE_CONSTRAINT.test(item)) continue;
    const m = /^["'`]?(\w+)["'`]?/.exec(item);
    if (m) cols.push(m[1]);
  }
  return cols;
}

/** Strip SQL line comments and split into statements on ';'. */
function statementsOf(sql) {
  const noComments = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return noComments
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Replay ordered migrations to the final schema.
 * @param {{ name: string, sql: string }[]} migrations  ordered by filename
 * @returns {Map<string, { columns: string[] }>} surviving tables → their columns
 */
export function parseMigrations(migrations) {
  /** @type {Map<string, { columns: string[] }>} */
  const tables = new Map();
  for (const { sql } of migrations) {
    for (const stmt of statementsOf(sql)) {
      let m;
      if (
        (m =
          /^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?([\s\S]*)$/i.exec(
            stmt,
          ))
      ) {
        // Register EVERY created table by name so the allowlist always sees it, even for forms the
        // column parser can't read (trailing table options after the ')', `CREATE TABLE … AS
        // SELECT`, etc.). Extract columns only when a parenthesised body is present.
        const body = /^\s*\(([\s\S]*)\)/.exec(m[2]);
        tables.set(m[1], { columns: body ? columnsOf(body[1]) : [] });
      } else if ((m = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`]?(\w+)["'`]?/i.exec(stmt))) {
        tables.delete(m[1]);
      } else if (
        (m = /^ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+ADD\s+(?:COLUMN\s+)?["'`]?(\w+)["'`]?/i.exec(
          stmt,
        ))
      ) {
        const t = tables.get(m[1]);
        if (t) t.columns.push(m[2]);
      } else if (
        (m = /^ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+DROP\s+(?:COLUMN\s+)?["'`]?(\w+)["'`]?/i.exec(
          stmt,
        ))
      ) {
        const t = tables.get(m[1]);
        if (t) t.columns = t.columns.filter((c) => c.toLowerCase() !== m[2].toLowerCase());
      }
      // CREATE/DROP INDEX and everything else: irrelevant to the table allowlist.
    }
  }
  return tables;
}

/**
 * (b) Verify the replayed final schema: allowlist + no person-level columns.
 * @param {Map<string, { columns: string[] }>} tables
 * @returns {string[]} errors
 */
export function verifySchema(tables) {
  const errors = [];
  const allow = new Set(AGGREGATE_ALLOWLIST);
  for (const [name, def] of tables) {
    if (!allow.has(name)) {
      errors.push(
        `committed schema: table "${name}" is not on the aggregate allowlist — the research store must be aggregate-only`,
      );
    }
    for (const col of def.columns) {
      for (const { label, re } of PROHIBITED_COLUMN_RULES) {
        if (re.test(col)) {
          errors.push(
            `committed schema: table "${name}" column "${col}" is ${label} — no person-level field may survive`,
          );
        }
      }
    }
  }
  return errors;
}

/**
 * (a) Scan operational sources for prohibited row-level / stale-recovery tokens.
 * @param {{ path: string, text: string }[]} sources
 * @returns {string[]} errors
 */
export function verifySources(sources) {
  const errors = [];
  for (const { path, text } of sources) {
    if (typeof text !== "string") continue;
    for (const { label, re } of PROHIBITED_SOURCE_RULES) {
      if (re.test(text)) {
        errors.push(`${path}: contains ${label} — the research store is aggregate-only`);
      }
    }
  }
  return errors;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PENDING_HASH = /^pending:[A-Z0-9-]+$/;

/**
 * (c) Validate the public aggregate-provenance record and cross-check its table list.
 * @param {unknown} rec  parsed docs/research/aggregate-provenance.json
 * @returns {string[]} errors
 */
export function verifyProvenance(rec) {
  const errors = [];
  const at = "aggregate-provenance";
  if (typeof rec !== "object" || rec === null || Array.isArray(rec)) {
    return [`${at}: not a JSON object`];
  }
  const isStr = (v) => typeof v === "string" && v.trim().length > 0;

  if (!Number.isInteger(rec.researchPayloadSchemaVersion) || rec.researchPayloadSchemaVersion < 1) {
    errors.push(`${at}: researchPayloadSchemaVersion must be a positive integer`);
  }
  if (
    !Array.isArray(rec.consentVersions) ||
    rec.consentVersions.length === 0 ||
    !rec.consentVersions.every(isStr)
  ) {
    errors.push(`${at}: consentVersions must be a non-empty array of strings`);
  }
  const cm = rec.cohortModel;
  if (typeof cm !== "object" || cm === null || !isStr(cm.description)) {
    errors.push(`${at}: cohortModel.description is required`);
  }
  if (!cm || !Array.isArray(cm.cohorts) || cm.cohorts.length === 0 || !cm.cohorts.every(isStr)) {
    errors.push(`${at}: cohortModel.cohorts must be a non-empty array of strings`);
  }
  const am = rec.aggregationMethod;
  if (typeof am !== "object" || am === null || !isStr(am.summary)) {
    errors.push(`${at}: aggregationMethod.summary is required`);
  }

  const cv = rec.conversionVerification;
  if (typeof cv !== "object" || cv === null) {
    errors.push(`${at}: conversionVerification is required`);
  } else {
    if (!ISO_DATE.test(cv.verifiedDate ?? "")) {
      errors.push(`${at}: conversionVerification.verifiedDate must be an ISO date (YYYY-MM-DD)`);
    }
    // A real counter-export hash (hex) or an explicit pending evidence reference. Never absent.
    const h = cv.counterExportHash;
    if (!isStr(h) || !(PENDING_HASH.test(h) || /^[0-9a-f]{64}$/i.test(h))) {
      errors.push(
        `${at}: conversionVerification.counterExportHash must be a sha256 hex digest or "pending:<EVIDENCE-ID>"`,
      );
    }
  }

  if (rec.noPersonLevelSourceRetained !== true) {
    errors.push(
      `${at}: noPersonLevelSourceRetained must be exactly true (assert no person-level source is retained)`,
    );
  }
  if (!isStr(rec.noPersonLevelSourceRetainedStatement)) {
    errors.push(`${at}: noPersonLevelSourceRetainedStatement is required`);
  }

  // The declared aggregate tables must be exactly the allowlist.
  const declared = Array.isArray(rec.aggregateTables) ? rec.aggregateTables : [];
  const allow = new Set(AGGREGATE_ALLOWLIST);
  for (const t of declared) {
    if (!allow.has(t))
      errors.push(`${at}: aggregateTables lists "${t}" which is not on the allowlist`);
  }
  for (const t of AGGREGATE_ALLOWLIST) {
    if (!declared.includes(t))
      errors.push(`${at}: aggregateTables is missing allowlist table "${t}"`);
  }
  return errors;
}

/**
 * (d) Verify a live production table list contains nothing outside the allowlist. Fails closed on
 * an empty list (means "could not read the schema").
 * @param {string[]} tableNames
 * @returns {string[]} errors
 */
export function verifyLiveTables(tableNames) {
  if (!Array.isArray(tableNames) || tableNames.length === 0) {
    return ["live schema: no tables reported — cannot verify the production schema (fail closed)"];
  }
  const errors = [];
  const allow = new Set(AGGREGATE_ALLOWLIST);
  for (const raw of tableNames) {
    const name = String(raw).trim();
    if (!name || LIVE_INTERNAL_TABLE.test(name) || allow.has(name)) continue;
    errors.push(
      `live schema: production table "${name}" is not on the aggregate allowlist — refusing to deploy`,
    );
  }
  return errors;
}

/**
 * Combine every applicable section into one verdict.
 * @param {{ migrations?: {name:string,sql:string}[], sources?: {path:string,text:string}[], provenance?: unknown, liveTables?: string[] }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input) {
  const errors = [];
  if (input.migrations) errors.push(...verifySchema(parseMigrations(input.migrations)));
  if (input.sources) errors.push(...verifySources(input.sources));
  if (input.provenance !== undefined) errors.push(...verifyProvenance(input.provenance));
  if (input.liveTables !== undefined) errors.push(...verifyLiveTables(input.liveTables));
  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- fs/git/CLI plumbing, exercised via CI not unit tests */
const SELF = /scripts\/check-aggregate-only\.(mjs|test\.mjs)$/;
const SCANNED_EXT = /\.(ts|tsx|js|mjs|cjs|svelte|json|ya?ml|toml)$/;
const MIGRATIONS_DIR = new URL("../apps/web/migrations/", import.meta.url);
const PROVENANCE_PATH = new URL("../docs/research/aggregate-provenance.json", import.meta.url);

function loadMigrations() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((name) => ({ name, sql: readFileSync(new URL(name, MIGRATIONS_DIR), "utf8") }));
}

function gatherSources(root) {
  const listed = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(
      (p) =>
        SCANNED_EXT.test(p) &&
        !p.startsWith("docs/") && // docs may narrate the history
        !p.startsWith("apps/web/migrations/") && // migrations governed by the schema replay
        !/\.test\.(ts|tsx|js|mjs|cjs)$/.test(p) && // tests may assert absence of these tokens
        !p.endsWith("pnpm-lock.yaml") &&
        !SELF.test(p),
    );
  return listed.map((rel) => ({ path: rel, text: safeRead(root, rel) }));
}

function safeRead(root, rel) {
  try {
    return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const out = { liveTables: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--live-tables") {
      out.liveTables = (argv[++i] ?? "")
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return out;
}

function main() {
  const { liveTables } = parseArgs(process.argv.slice(2));
  const root = fileURLToPath(new URL("..", import.meta.url));

  /** @type {Parameters<typeof verdict>[0]} */
  const input = { migrations: loadMigrations(), sources: gatherSources(root) };
  try {
    input.provenance = JSON.parse(readFileSync(PROVENANCE_PATH, "utf8"));
  } catch (err) {
    console.error(`::error::aggregate-only: cannot read aggregate-provenance.json: ${err.message}`);
    process.exit(1);
  }
  if (liveTables !== undefined) input.liveTables = liveTables;

  const result = verdict(input);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::aggregate-only: ${e}`);
    console.error(`aggregate-only: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info(
    `aggregate-only OK — committed schema, sources and provenance are aggregate-only${liveTables ? " (incl. live schema)" : ""}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
