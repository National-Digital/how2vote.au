import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { ELECTIONS, type Dataset } from "@how2vote/data-schema";
import { electionPaths, readJson, REPO_ROOT, writeJson } from "../paths.js";
import {
  buildStats,
  MIN_CELL,
  SUPPRESSION_RULES,
  type CounterRows,
  type StatsFile,
  type StatsIndex,
  type StatsIndexEntry,
} from "../stats.js";
import { loadEnv } from "../env.js";
import { evaluateIntegrityAlert } from "../integrity.js";
import { evaluatePublicationSuspension } from "../control-plane.js";

const INTEGRITY_ALERT_PATH = resolve(REPO_ROOT, "docs/research/integrity-alert.json");
const CONTROL_PLANE_PATH = resolve(REPO_ROOT, "data/governance/control-plane.json");

/**
 * Fail-closed publication gates: refuse to regenerate/publish any stats when either
 *   - a research integrity alert is active (suspected ingestion poisoning), or
 *   - the runtime kill-switch control plane suspends the `publication` scope, or is
 *     unreadable/unsigned/tampered.
 * Either way a suspected-poisoned or withheld counter set is never baked into a published snapshot.
 * The committed files are left untouched. Exits non-zero so the publishing job stops visibly.
 */
async function assertRegenerationAllowed(): Promise<void> {
  let alert: unknown;
  try {
    alert = await readJson<unknown>(INTEGRITY_ALERT_PATH);
  } catch {
    alert = null; // unreadable → evaluated as fail-closed below
  }
  const alertVerdict = evaluateIntegrityAlert(alert);
  if (alertVerdict.suspended) {
    console.error(`Public-stat regeneration SUSPENDED: ${alertVerdict.reason}`);
    console.error(
      "No stats file was rewritten. Clear docs/research/integrity-alert.json to resume.",
    );
    process.exit(1);
  }

  let plane: unknown;
  try {
    plane = await readJson<unknown>(CONTROL_PLANE_PATH);
  } catch {
    plane = null; // unreadable → fail closed
  }
  const planeVerdict = evaluatePublicationSuspension(plane);
  if (planeVerdict.suspended) {
    console.error(`Public-stat regeneration SUSPENDED: ${planeVerdict.reason}`);
    console.error(
      "No stats file was rewritten. Lift the `publication` suspension in data/governance/control-plane.json (and re-sign) to resume.",
    );
    process.exit(1);
  }
}

/**
 * Build-time generator for the public research dashboard data (ADR-0007, ADR-0008). Reads the
 * AGGREGATE COUNTER tables from the research D1 database (via the D1 HTTP API — the store holds
 * no per-person rows; see docs/research/analysis-plan.md), derives the suppressed, cohort-aware
 * stats bundle per election, and writes them to the web app's static assets as `stats/<id>.json`
 * plus a lightweight `stats/index.json` the insights page reads first.
 *
 * DIFFERENCING GATE (ADR-0008): two published snapshots can be subtracted, so
 * an election's file is only rewritten when at least MIN_CELL new responses have accrued since
 * the file currently on disk — no pair of published snapshots ever differs by fewer than k
 * contributors. A shrinking or equal total also keeps the existing file (a shrink only happens
 * after a deliberate delta-log excision). Set STATS_FORCE=1 to override for a deliberate
 * regeneration, e.g. publishing the post-excision state.
 *
 * Run on a schedule (a regular rebuild+deploy). When the D1 credentials are absent (local dev, or
 * before the database is provisioned) the counters read as empty and the gate keeps whatever file
 * is already committed, so a creds-less build can never clobber published stats. Set ELECTION_ID
 * to restrict the run to a single election.
 *
 * Required env for a live read: CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_D1_API_TOKEN.
 */

const OUTPUT_DIR = resolve(REPO_ROOT, "apps/web/static/stats");

const FORCE = process.env.STATS_FORCE === "1";

const ELECTION_FILTER = process.env.ELECTION_ID;
if (ELECTION_FILTER !== undefined && !/^\d{4}$/.test(ELECTION_FILTER)) {
  throw new Error(`ELECTION_ID must be a four-digit year, got ${JSON.stringify(ELECTION_FILTER)}`);
}
const TARGET_ELECTIONS = ELECTIONS.filter((e) => !ELECTION_FILTER || e.id === ELECTION_FILTER);

type D1Row = Record<string, string | number | null>;

async function d1Query(sql: string): Promise<D1Row[]> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const databaseId = process.env.CF_D1_DATABASE_ID;
  const token = process.env.CF_D1_API_TOKEN;
  if (!accountId || !databaseId || !token) return [];

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) throw new Error(`D1 query failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { result?: { results?: D1Row[] }[]; success: boolean };
  return body.result?.[0]?.results ?? [];
}

/** Maps the counter tables' `''` "unknown" sentinel back to null for buildStats. */
const stateOrNull = (v: string | number | null | undefined): string | null =>
  typeof v === "string" && v !== "" ? v : null;

/**
 * Reads ONLY the k-gated public views (migration 0006), never the raw counter tables. Every cell
 * returned has already cleared the DB-layer `HAVING SUM(n) >= k` primary suppression, so no sub-k
 * cell can leave the database. scripts/check-public-stat-release.mjs statically enforces that this is
 * the only surface queried here.
 */
async function fetchCounters(electionId: string): Promise<CounterRows> {
  const [totals, demographicsNational, demographicsState, propositions] = await Promise.all([
    d1Query(`SELECT cohort, state_code, responses FROM v_public_response_total
              WHERE election_id = '${electionId}'`),
    d1Query(`SELECT cohort, dimension, bucket, party, n FROM v_public_demographic_national
              WHERE election_id = '${electionId}'`),
    d1Query(`SELECT cohort, state_code, dimension, bucket, party, n FROM v_public_demographic_state
              WHERE election_id = '${electionId}'`),
    d1Query(`SELECT cohort, proposition_id, stance, n FROM v_public_proposition_national
              WHERE election_id = '${electionId}'`),
  ]);

  return {
    responseTotals: totals.map((r) => ({
      cohort: String(r.cohort),
      stateCode: stateOrNull(r.state_code),
      responses: Number(r.responses),
    })),
    demographicsNational: demographicsNational.map((r) => ({
      cohort: String(r.cohort),
      dimension: String(r.dimension),
      bucket: String(r.bucket),
      party: String(r.party),
      n: Number(r.n),
    })),
    demographicsState: demographicsState.map((r) => ({
      cohort: String(r.cohort),
      stateCode: String(r.state_code),
      dimension: String(r.dimension),
      bucket: String(r.bucket),
      party: String(r.party),
      n: Number(r.n),
    })),
    propositions: propositions.map((r) => ({
      cohort: String(r.cohort),
      propositionId: Number(r.proposition_id),
      stance: String(r.stance),
      n: Number(r.n),
    })),
  };
}

const EMPTY_COUNTERS: CounterRows = {
  responseTotals: [],
  demographicsNational: [],
  demographicsState: [],
  propositions: [],
};

/**
 * Loads counters for one election, degrading to an empty set on any error (credentials absent,
 * database not yet migrated, transient failure). A stats build must never fail the deploy — an
 * unreadable database yields empty counters, and the gate below keeps the existing file.
 */
async function loadCounters(electionId: string): Promise<CounterRows> {
  try {
    return await fetchCounters(electionId);
  } catch (err) {
    console.warn(
      `Could not read research D1 for ${electionId} — treating as empty. ${String(err)}`,
    );
    return EMPTY_COUNTERS;
  }
}

async function generateElection(
  election: (typeof ELECTIONS)[number],
  generatedAt: string,
): Promise<StatsIndexEntry> {
  const counters = await loadCounters(election.id);
  let dataset: Dataset | null = null;
  try {
    dataset = await readJson<Dataset>(electionPaths(election.id).dist.dataset);
  } catch {
    // No compiled dataset for this election (not built) — fall through to an empty file below.
  }

  const candidate: StatsFile =
    dataset === null
      ? {
          schemaVersion: 3,
          generatedAt,
          electionId: election.id,
          electionLabel: election.label,
          minCell: MIN_CELL,
          release: {
            releaseId: `rel-${election.id}-${createHash("sha256")
              .update(
                JSON.stringify({
                  electionId: election.id,
                  minCell: MIN_CELL,
                  views: [],
                  cohorts: [],
                }),
              )
              .digest("hex")
              .slice(0, 16)}`,
            k: MIN_CELL,
            suppressionRules: SUPPRESSION_RULES,
            date: generatedAt.slice(0, 10),
          },
          totalResponses: 0,
          published: false,
          views: [],
          cohorts: [],
        }
      : buildStats(counters, dataset, {
          generatedAt,
          electionId: election.id,
          electionLabel: election.label,
          electionYear: election.year,
        });

  const out = resolve(OUTPUT_DIR, `${election.id}.json`);
  let previous: StatsFile | null = null;
  try {
    previous = await readJson<StatsFile>(out);
  } catch {
    // First generation for this election — nothing on disk to protect.
  }

  // The differencing gate: only replace the published file when the snapshot pair would differ
  // by at least MIN_CELL contributors (or on first generation / explicit force). A schema-version
  // change — or a stale file predating the disclosure-control `release` block — always
  // writes: a stale-shape artifact must be upgraded regardless of the response delta.
  const delta = candidate.totalResponses - (previous?.totalResponses ?? 0);
  const write =
    FORCE ||
    previous === null ||
    previous.schemaVersion !== candidate.schemaVersion ||
    previous.release === undefined ||
    delta >= MIN_CELL;
  const file = write ? candidate : previous!;
  if (write) {
    await writeJson(out, file);
  }

  const buckets = file.views.reduce(
    (n, v) => n + v.geos.reduce((m, g) => m + g.buckets.length, 0),
    0,
  );
  console.info(
    `stats/${election.id}.json: ${file.totalResponses} responses, published=${file.published}, ` +
      `${file.cohorts?.length ?? 0} cohorts / ${file.views.length} views / ${buckets} buckets` +
      (write ? "" : ` (kept existing — Δ${delta} < ${MIN_CELL}-response differencing gate)`),
  );

  return {
    id: election.id,
    label: election.label,
    published: file.published,
    totalResponses: file.totalResponses,
  };
}

async function main(): Promise<void> {
  loadEnv();
  await assertRegenerationAllowed();
  const generatedAt = new Date().toISOString();
  const entries: StatsIndexEntry[] = [];
  for (const election of TARGET_ELECTIONS) {
    entries.push(await generateElection(election, generatedAt));
  }

  const index: StatsIndex = { schemaVersion: 2, generatedAt, elections: entries };
  await writeJson(resolve(OUTPUT_DIR, "index.json"), index);
  const publishedCount = entries.filter((e) => e.published).length;
  console.info(
    `stats/index.json: ${entries.length} elections, ${publishedCount} published → ${OUTPUT_DIR}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
