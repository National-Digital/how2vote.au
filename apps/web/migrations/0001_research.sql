-- Research store schema — aggregate-only by construction (ADR-0008).
--
-- The optional research feature stores COUNTS, never records. There is no per-person row anywhere in
-- this schema: every table is a pure counter that is only ever incremented (UPSERT … n = n + 1), so a
-- leak of the whole store exposes only aggregate cells, never one participant's attributes tied
-- together. The raw answer vector never reaches the server — the client derives a match + stances and
-- posts only those (functions/api/research.ts).
--
-- Every time-varying counter is keyed by `cohort`, the collection context classified server-side from
-- arrival time against the election's AEC timetable (pre-declaration | live | post-election |
-- historical | unknown), so cohorts are never silently combined and the generator's per-cohort
-- k-anonymity suppression is exact.
--
-- Key rule (docs/research/analysis-plan.md): no counter keys an opinion value (party match / stance)
-- together with a sensitive attribute AND a sub-national geography. Sensitive demographic dimensions
-- are stored national-only (state_code = ''). '' is the sentinel for "unknown / not applicable" in any
-- key column, so upserts merge (a NULL in a primary key would make every upsert insert a fresh row).
-- The coarsest time anywhere in this store is the calendar quarter in collection_period_count; no
-- table carries a per-day or finer timestamp.
--
-- Every statement is idempotent (IF NOT EXISTS), so applying the migration is a clean, repeatable
-- baseline. The public dashboards read ONLY the k-anonymised v_public_* views defined at the foot of
-- this file — the stats generator never SELECTs a base counter table.
--
-- Apply with:  wrangler d1 migrations apply how2vote-research   (see wrangler.toml)

-- E1 — denominators and the dashboard publication gate, per cohort. state_code '' = unknown.
CREATE TABLE IF NOT EXISTS response_total (
  election_id  TEXT    NOT NULL,
  cohort       TEXT    NOT NULL,
  state_code   TEXT    NOT NULL DEFAULT '',
  responses    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (election_id, cohort, state_code)
);

-- E2 — top-party match crossed with ONE demographic dimension at a time (never multi-way), per
-- cohort. state_code is ALWAYS '' for the sensitive dimensions (SENSITIVE_DIMENSIONS in
-- src/lib/survey.ts — the ingestion Function enforces it; the generator never receives a
-- state-keyed sensitive row to publish).
CREATE TABLE IF NOT EXISTS demographic_count (
  election_id  TEXT    NOT NULL,
  cohort       TEXT    NOT NULL,
  state_code   TEXT    NOT NULL DEFAULT '',
  dimension    TEXT    NOT NULL,
  bucket       TEXT    NOT NULL,
  party        TEXT    NOT NULL,
  n            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (election_id, cohort, state_code, dimension, bucket, party)
);

-- E3 — proposition support distribution, per cohort. National only (no state key), matching what is
-- published; stance is the client-derived agree / neutral / disagree.
CREATE TABLE IF NOT EXISTS proposition_count (
  election_id     TEXT    NOT NULL,
  cohort          TEXT    NOT NULL,
  proposition_id  INTEGER NOT NULL,
  stance          TEXT    NOT NULL,
  n               INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (election_id, cohort, proposition_id, stance)
);

-- E4 — proposition stance × top-party match ("do people who match a party agree with its
-- positions?"), per cohort. National only, no demographics — coarse by design.
CREATE TABLE IF NOT EXISTS proposition_party_count (
  election_id     TEXT    NOT NULL,
  cohort          TEXT    NOT NULL,
  proposition_id  INTEGER NOT NULL,
  stance          TEXT    NOT NULL,
  party           TEXT    NOT NULL,
  n               INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (election_id, cohort, proposition_id, stance, party)
);

-- E5 — the weighting frame: joint age × gender × state with NO opinion variables, per cohort
-- (cohorts are analysed separately, so each needs its own frame for ABS/AEC post-stratification).
-- '' = item non-response.
CREATE TABLE IF NOT EXISTS weighting_frame_count (
  election_id  TEXT    NOT NULL,
  cohort       TEXT    NOT NULL,
  state_code   TEXT    NOT NULL DEFAULT '',
  age          TEXT    NOT NULL DEFAULT '',
  gender       TEXT    NOT NULL DEFAULT '',
  n            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (election_id, cohort, state_code, age, gender)
);

-- E7 — which consent notice each contribution was collected under, in aggregate.
CREATE TABLE IF NOT EXISTS consent_count (
  election_id      TEXT    NOT NULL,
  consent_version  TEXT    NOT NULL,
  n                INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (election_id, consent_version)
);

-- E8 — when contributions arrived: AEST calendar quarter per cohort (finer would recreate a timing
-- signal).
CREATE TABLE IF NOT EXISTS collection_period_count (
  election_id  TEXT    NOT NULL,
  cohort       TEXT    NOT NULL,
  period       TEXT    NOT NULL,   -- 'YYYY-Qn' (AEST quarter)
  n            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (election_id, cohort, period)
);

-- Aggregate geography: submissions per electorate, per election, via its own endpoint
-- (functions/api/research/geography.ts). A running count only — no attributes, no key to anything
-- else — so electorate can never be joined back to an opinion or a demographic.
CREATE TABLE IF NOT EXISTS geography_count (
  election_id  TEXT    NOT NULL,
  electorate   TEXT    NOT NULL,   -- division name; a running count only, never joined to a person
  submissions  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (election_id, electorate)
);

-- There is deliberately NO per-cell-per-day delta / integrity log. Such a table would let a rare cell
-- on a low-traffic day be regrouped — by insertion order or by its shared cohort/state/party key
-- values — into a temporary person-level record, defeating the whole point of an aggregate-only store.
-- Poisoning is prevented at the infra layer (Cloudflare rate limit + Bot Fight Mode on
-- POST /api/research) and detected via Cloudflare request analytics. See ADR-0008 "Integrity without a
-- person-reconstructable delta log".

-- --------------------------------------------------------------------------------------------------
-- Public disclosure control at the QUERY/VIEW layer. The public dashboards are generated ONLY from the
-- k-anonymised views below; the stats generator (packages/data-pipeline/src/bin/generate-stats.ts)
-- never SELECTs the raw counter tables. Every published cell is aggregated and thresholded IN THE
-- DATABASE with `HAVING SUM(n) >= <k>`, so a cell with fewer than k contributors can never leave the
-- database. The single k is 10, mirroring MIN_CELL in packages/data-pipeline/src/stats.ts; the two are
-- kept in step by scripts/check-public-stat-release.mjs, which parses this file and fails closed if any
-- v_public_* view's HAVING threshold differs from MIN_CELL, if the generator reads a base counter table
-- directly, or if a new v_public_* cross-tab view appears that is not on the reviewed allowlist.
-- Views hold no rows of their own, so they are safe under the aggregate-only live-schema allowlist
-- (check-aggregate-only.mjs reads sqlite_master type='table' and never sees a view).

-- E2 national marginal — top-party match × ONE demographic dimension × bucket, summed across ALL
-- states (including the '' unknown-state and the national-only sensitive-dimension rows) and gated at
-- k. This is the headline breakdown; per-state interiors come from v_public_demographic_state.
CREATE VIEW IF NOT EXISTS v_public_demographic_national AS
  SELECT election_id, cohort, dimension, bucket, party, SUM(n) AS n
  FROM demographic_count
  GROUP BY election_id, cohort, dimension, bucket, party
  HAVING SUM(n) >= 10;

-- E2 per-state interior — the same cross-tab keyed by a real state (state_code <> '' excludes both the
-- unknown-state bucket and the national-only sensitive dimensions, which are always stored with
-- state_code = ''), gated at k. buildStats applies complementary suppression across these and the
-- national marginal so a suppressed state cell cannot be recovered by subtraction.
CREATE VIEW IF NOT EXISTS v_public_demographic_state AS
  SELECT election_id, cohort, state_code, dimension, bucket, party, SUM(n) AS n
  FROM demographic_count
  WHERE state_code <> ''
  GROUP BY election_id, cohort, state_code, dimension, bucket, party
  HAVING SUM(n) >= 10;

-- E3 national proposition stance distribution, per cohort, gated at k. Propositions are national-only
-- (no geography hierarchy), so no complementary suppression is needed for them.
CREATE VIEW IF NOT EXISTS v_public_proposition_national AS
  SELECT election_id, cohort, proposition_id, stance, SUM(n) AS n
  FROM proposition_count
  GROUP BY election_id, cohort, proposition_id, stance
  HAVING SUM(n) >= 10;

-- E1 denominators — scored-response counts per (cohort, state). NOT a disclosive cross-tab (a bare
-- count of responses, no opinion × attribute); the generator only ever sums them to a per-cohort total
-- to drive the dashboard-visibility gate (DASHBOARD_MIN). Exposed through a view purely so the
-- generator reads exclusively from v_public_* surfaces and never touches a base counter table; hence no
-- HAVING threshold here.
CREATE VIEW IF NOT EXISTS v_public_response_total AS
  SELECT election_id, cohort, state_code, SUM(responses) AS responses
  FROM response_total
  GROUP BY election_id, cohort, state_code;
