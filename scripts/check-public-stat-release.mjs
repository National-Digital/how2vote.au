#!/usr/bin/env node
/**
 * @fileoverview CI guard: DB-layer k-threshold + disclosure control for the public research stats
 * (ADR-0008).
 *
 * The ONLY public surface for the research counters is the static, k-suppressed release files
 * (apps/web/static/stats/*.json). This guard proves, fail-closed, that a cell below k can never
 * become public:
 *
 *  (a) DB VIEW k-GATE — every published cross-tab is aggregated and thresholded IN THE DATABASE.
 *      apps/web/migrations/0001_research.sql must define exactly the allowlisted
 *      `v_public_*` views, and every DISCLOSIVE one must carry `HAVING SUM(n) >= k` with k equal to
 *      MIN_CELL in packages/data-pipeline/src/stats.ts. A new `v_public_*` view (a new published
 *      cross-tab) that is not on the reviewed allowlist fails — this extends the aggregate-table
 *      allowlist to the published-view surface.
 *
 *  (b) GENERATOR READS ONLY VIEWS — packages/data-pipeline/src/bin/generate-stats.ts must SELECT
 *      exclusively from the allowlisted `v_public_*` views and never from a base counter table, so a
 *      sub-k cell is never pulled out of the database in the first place. JavaScript filtering is not
 *      the gate; the view is.
 *
 *  (c) NO RAW-COUNTER ENDPOINT — no Cloudflare Pages Function under apps/web/functions/api/** may
 *      read a counter table or a public view (the counters are write-only at runtime; they leave the
 *      database only through the build-time generator into the suppressed release files).
 *
 *  (d) SIGNED, IMMUTABLE RELEASE FILES — every committed stats/<id>.json records its k, the
 *      suppression rules applied, a content-addressed release id and the release date, and states
 *      minCell == k. The whole file is bound into the deploy's release manifest (publicStatsHash in
 *      scripts/build-release-manifest.mjs), so tampering is detectable end-to-end.
 *
 *  (e) MANIFEST BINDING — build-release-manifest.mjs emits publicStatsHash and check-release-manifest
 *      verifies it, and neither still lists publicStatsRelease as a pending field.
 *
 * Pure decision logic is exported as verdict()/verify* for unit tests; the fs/git/CLI plumbing runs
 * only when executed directly.
 *
 * Usage: node scripts/check-public-stat-release.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AGGREGATE_ALLOWLIST } from "./check-aggregate-only.mjs";

/**
 * The reviewed set of public views. `gated` views MUST carry `HAVING SUM(n) >= k`; the ungated
 * denominator view (response totals — a bare count, not a disclosive cross-tab) must NOT gate. A new
 * disclosive cross-tab requires adding it here AND passing review.
 */
export const PUBLIC_VIEW_ALLOWLIST = {
  v_public_demographic_national: { gated: true },
  v_public_demographic_state: { gated: true },
  v_public_proposition_national: { gated: true },
  v_public_response_total: { gated: false },
};

/** The base counter tables (from the aggregate allowlist) — none may be read publicly or by
 *  the generator directly, nor served at runtime. */
const COUNTER_TABLES = new Set(AGGREGATE_ALLOWLIST);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RELEASE_ID = /^rel-.+-[0-9a-f]{16}$/;

/** Strip SQL line comments so `FROM`/`HAVING` scans ignore commented-out code. */
function stripSqlComments(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** Extract `CREATE VIEW <name> AS <body>` blocks (body up to the terminating ';'). */
function createViews(sql) {
  const clean = stripSqlComments(sql);
  const views = [];
  const re = /CREATE\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s+AS\b([\s\S]*?);/gi;
  let m;
  while ((m = re.exec(clean)) !== null) views.push({ name: m[1], body: m[2] });
  return views;
}

/** All `FROM <ident>` / `JOIN <ident>` targets in raw SQL (comments stripped). */
function fromTargets(src) {
  const clean = stripSqlComments(src);
  const targets = [];
  const re = /\b(?:FROM|JOIN)\s+["'`]?(\w+)["'`]?/gi;
  let m;
  while ((m = re.exec(clean)) !== null) targets.push(m[1]);
  return targets;
}

/**
 * `FROM`/`JOIN` targets read from the SQL embedded in a JS/TS source. Only string and template
 * literals that actually contain a SQL SELECT are scanned, so a JS `import … from "…"` (or prose in
 * a comment) can never be mistaken for a table read.
 */
function fromTargetsInCode(src) {
  const targets = [];
  const literals = src.match(/`[^`]*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g) ?? [];
  for (const lit of literals) {
    const body = lit.slice(1, -1);
    if (/\bSELECT\b/i.test(body)) targets.push(...fromTargets(body));
  }
  return targets;
}

/**
 * (a) The migration-defined public views: allowlist membership + the k-gate on disclosive views.
 * @param {string} migrationsSql  concatenation of all migration files
 * @param {number} k  MIN_CELL from stats.ts
 * @returns {string[]} errors
 */
export function verifyViews(migrationsSql, k) {
  const errors = [];
  const views = createViews(migrationsSql);
  const seen = new Map(views.map((v) => [v.name, v.body]));

  // Every declared v_public_* view must be on the allowlist (a new cross-tab needs review).
  for (const { name } of views) {
    if (name.startsWith("v_public_") && !(name in PUBLIC_VIEW_ALLOWLIST)) {
      errors.push(
        `migration view "${name}" is not on the public-view allowlist — a new published cross-tab must be reviewed`,
      );
    }
  }

  for (const [name, spec] of Object.entries(PUBLIC_VIEW_ALLOWLIST)) {
    const body = seen.get(name);
    if (body === undefined) {
      errors.push(`public view "${name}" is missing from the migrations (fail closed)`);
      continue;
    }
    const having = /HAVING\s+SUM\(\s*n\s*\)\s*>=\s*(\d+)/i.exec(body);
    if (spec.gated) {
      if (!having) {
        errors.push(
          `public view "${name}" must gate at the database layer with "HAVING SUM(n) >= ${k}"`,
        );
      } else if (Number(having[1]) !== k) {
        errors.push(
          `public view "${name}" gates at k=${having[1]} but MIN_CELL is ${k} — the DB k-threshold must equal MIN_CELL`,
        );
      }
    } else if (having) {
      errors.push(
        `public view "${name}" is the denominator view and must not carry a HAVING k-gate (it is not a disclosive cross-tab)`,
      );
    }
    // A public view must read only from counter tables (never from another view or an ad-hoc table).
    for (const t of fromTargets(body)) {
      if (!COUNTER_TABLES.has(t)) {
        errors.push(`public view "${name}" reads FROM "${t}" which is not a base counter table`);
      }
    }
  }
  return errors;
}

/**
 * (b) The stats generator must SELECT only from allowlisted public views, never a base counter table.
 * @param {string} generatorSrc
 * @returns {string[]} errors
 */
export function verifyGeneratorReads(generatorSrc) {
  const errors = [];
  const targets = fromTargetsInCode(generatorSrc);
  const readsAView = targets.some((t) => t in PUBLIC_VIEW_ALLOWLIST);
  for (const t of targets) {
    if (COUNTER_TABLES.has(t)) {
      errors.push(
        `generate-stats.ts reads FROM base counter table "${t}" — it must read only k-gated v_public_* views so a sub-k cell never leaves the database`,
      );
    } else if (!(t in PUBLIC_VIEW_ALLOWLIST)) {
      errors.push(`generate-stats.ts reads FROM "${t}" which is not an allowlisted public view`);
    }
  }
  if (!readsAView) {
    errors.push(
      "generate-stats.ts does not read any v_public_* view — cannot confirm the DB k-gate is in the read path (fail closed)",
    );
  }
  return errors;
}

/**
 * (c) No Pages Function may read a counter table or a public view at runtime.
 * @param {{ path: string, text: string }[]} apiSources
 * @returns {string[]} errors
 */
export function verifyNoRawEndpoint(apiSources) {
  const errors = [];
  for (const { path, text } of apiSources) {
    if (typeof text !== "string") continue;
    for (const t of fromTargetsInCode(text)) {
      if (COUNTER_TABLES.has(t) || t in PUBLIC_VIEW_ALLOWLIST) {
        errors.push(
          `${path} reads FROM "${t}" — the research counters must never be served by an endpoint; the only public path is the static k-suppressed release files`,
        );
      }
    }
  }
  return errors;
}

/**
 * (d) Every committed stats release file carries a valid, immutable disclosure-control record.
 * @param {{ name: string, json: unknown }[]} statsFiles  each <id>.json (index.json excluded)
 * @param {number} k  MIN_CELL from stats.ts
 * @returns {string[]} errors
 */
export function verifyReleaseFiles(statsFiles, k) {
  const errors = [];
  if (statsFiles.length === 0) {
    return ["no committed stats release files found (apps/web/static/stats/*.json) — fail closed"];
  }
  for (const { name, json } of statsFiles) {
    const at = `stats/${name}`;
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      errors.push(`${at}: not a JSON object`);
      continue;
    }
    if (json.schemaVersion !== 3) errors.push(`${at}: schemaVersion must be 3`);
    if (json.minCell !== k)
      errors.push(`${at}: minCell must equal MIN_CELL (${k}), got ${json.minCell}`);
    const r = json.release;
    if (typeof r !== "object" || r === null) {
      errors.push(`${at}: missing release block (k, suppressionRules, releaseId, date)`);
      continue;
    }
    if (r.k !== k) errors.push(`${at}: release.k must equal MIN_CELL (${k}), got ${r.k}`);
    if (typeof r.releaseId !== "string" || !RELEASE_ID.test(r.releaseId)) {
      errors.push(`${at}: release.releaseId must match rel-<id>-<16 hex>`);
    }
    if (typeof r.date !== "string" || !ISO_DATE.test(r.date)) {
      errors.push(`${at}: release.date must be an ISO date (YYYY-MM-DD)`);
    }
    if (
      !Array.isArray(r.suppressionRules) ||
      r.suppressionRules.length === 0 ||
      !r.suppressionRules.every((s) => typeof s === "string" && s.trim().length > 0)
    ) {
      errors.push(`${at}: release.suppressionRules must be a non-empty array of strings`);
    }
  }
  return errors;
}

/**
 * (e) The release manifest binds the public stats (publicStatsHash) and no longer treats them as
 * pending.
 * @param {string} buildSrc  build-release-manifest.mjs source
 * @param {string} checkSrc  check-release-manifest.mjs source
 * @returns {string[]} errors
 */
export function verifyManifestBinding(buildSrc, checkSrc) {
  const errors = [];
  if (!/publicStatsHash/.test(buildSrc)) {
    errors.push(
      "build-release-manifest.mjs must emit publicStatsHash to bind the k-suppressed release files",
    );
  }
  if (/publicStatsRelease/.test(buildSrc)) {
    errors.push(
      "build-release-manifest.mjs still lists publicStatsRelease as pending — the control has landed",
    );
  }
  if (!/publicStatsHash/.test(checkSrc)) {
    errors.push("check-release-manifest.mjs must verify publicStatsHash");
  }
  return errors;
}

/**
 * @param {{ migrationsSql: string, k: number, generatorSrc: string, apiSources: {path:string,text:string}[], statsFiles: {name:string,json:unknown}[], buildSrc: string, checkSrc: string }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input) {
  const errors = [];
  if (!Number.isInteger(input.k) || input.k < 1) {
    return {
      ok: false,
      errors: ["could not read a positive MIN_CELL from stats.ts (fail closed)"],
    };
  }
  errors.push(...verifyViews(input.migrationsSql, input.k));
  errors.push(...verifyGeneratorReads(input.generatorSrc));
  errors.push(...verifyNoRawEndpoint(input.apiSources));
  errors.push(...verifyReleaseFiles(input.statsFiles, input.k));
  errors.push(...verifyManifestBinding(input.buildSrc, input.checkSrc));
  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- fs/git/CLI plumbing, exercised via CI not unit tests */
const root = new URL("../", import.meta.url);
const rel = (p) => new URL(p, root);

function readMinCell() {
  const src = readFileSync(rel("packages/data-pipeline/src/stats.ts"), "utf8");
  const m = /export\s+const\s+MIN_CELL\s*=\s*(\d+)/.exec(src);
  return m ? Number(m[1]) : NaN;
}

function loadMigrations() {
  const dir = rel("apps/web/migrations/");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(new URL(f, dir), "utf8"))
    .join("\n;\n");
}

function loadApiSources() {
  const listed = execFileSync("git", ["ls-files", "apps/web/functions/api"], {
    cwd: fileURLToPath(root),
    encoding: "utf8",
  })
    .split("\n")
    .filter((p) => /\.(ts|js|mjs)$/.test(p) && !/\.test\.(ts|js|mjs)$/.test(p));
  return listed.map((p) => ({ path: p, text: readFileSync(rel(p), "utf8") }));
}

function loadStatsFiles() {
  const dir = rel("apps/web/static/stats/");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .sort()
    .map((f) => ({
      name: f,
      json: JSON.parse(readFileSync(new URL(f, dir), "utf8")),
    }));
}

function main() {
  let input;
  try {
    input = {
      migrationsSql: loadMigrations(),
      k: readMinCell(),
      generatorSrc: readFileSync(rel("packages/data-pipeline/src/bin/generate-stats.ts"), "utf8"),
      apiSources: loadApiSources(),
      statsFiles: loadStatsFiles(),
      buildSrc: readFileSync(rel("scripts/build-release-manifest.mjs"), "utf8"),
      checkSrc: readFileSync(rel("scripts/check-release-manifest.mjs"), "utf8"),
    };
  } catch (err) {
    console.error(`::error::public-stat-release: cannot gather inputs: ${err.message}`);
    process.exit(1);
  }
  const result = verdict(input);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::public-stat-release: ${e}`);
    console.error(`public-stat release: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info(
    `public-stat release OK — DB k-gate (k=${input.k}), views allowlisted, generator reads views only, no raw-counter endpoint, ${input.statsFiles.length} signed release file(s)`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
