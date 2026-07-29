# 0008 — Aggregate-counters research storage (no per-person rows)

- Status: Accepted
- Deciders: National Digital

This ADR decides the research *storage model*. The product and consent design is in
[0006](0006-legal-compliance-rebuild.md); the same-origin backend architecture is in
[0007](0007-same-origin-research-backend.md).

## Context

A per-person research record — an answer vector plus demographics and state — would be a near-unique
fingerprint: a leak would expose plausibly re-identifiable **sensitive information** (political
opinion, religion, sexual orientation, Indigenous origin, union membership). An aggregate-counter
pattern — a `key → count` table — carries no such record: nothing at rest ties one person's
attributes together, and a leak exposes only counts.

This ADR applies that pattern to the **entire research dataset**, so no per-person row is ever
created.

## Decision

**Storage is counters only.** Migration `0001_research.sql` creates the pure counter
tables (`response_total`, `demographic_count`, `proposition_count`, `proposition_party_count`,
`weighting_frame_count`, `consent_count`, `collection_period_count`, `geography_count`). No
per-person table is ever created, so the committed schema is aggregate-only by construction (see
"Schema" below). Every
write is `UPSERT … SET n = n + 1`; a `''` sentinel stands in for a null key part so upserts
merge. The complete set of counters — the **estimand registry** — is pre-registered in
[`docs/research/analysis-plan.md`](../research/analysis-plan.md); adding one is a governed,
forward-only change to that plan, never a schema accident.

**Every time-varying counter is keyed by the collection cohort.** The server classifies each
contribution against the election's AEC timetable with its own clock; with cohort-keyed counters the
generator's per-cohort k-anonymity suppression is exact by construction, and cohorts can never
be silently combined. The published StatsFile (schema v3, per-cohort boards, no combined view
when more than one cohort exists) is unchanged; the insights UI is untouched.

**The raw answer vector never leaves the device** (payload v1 — see the version note below).
The client computes the top-party match with the same engine that renders the comparison
(`topPartyMatch`, `packages/engine`) and reduces each answered proposition to a stance
(agree / neutral / disagree). The payload carries only: election, timetable (public facts),
state, match, stances, survey demographics, consent version, data/app versions. No points, no
importance weights, no vector — and no electorate (that goes to the separate geography
endpoint, as before).

**Version policy: the research schema is v1.** The endpoints accept only the current v1 payload
shape; a raw-vector body claiming v1 fails field validation (no `match`/`propositions`) —
test-pinned.

**Disclosure control applies to keys at rest, not just publication** (analysis plan): no
counter keys an opinion variable with a sensitive attribute and a sub-national geography.
Sensitive dimensions (all of the culture/identity and politics blocks plus union membership,
incl. `vote_next`) are stored national-only. `geography_count` remains electorate + count
with no attribute — the "closest party must not sit beside electorate" rule is honoured
with margin (our alignment × geography floor is *state or coarser*, and only for non-sensitive
dimensions).

**No person-reconstructable delta log.** The store keeps no per-cell-per-time delta table (e.g. a
`day × table × key → n` log for surgical poisoning-excision), because such a log recreates the very
thing this ADR eliminates. One contribution writes a *bundle* of delta rows in a single request, and
on any low-traffic day (or for any rare cell — and a per-day sub-partition makes almost every cell
rare) those rows are `n = 1` and regroupable into a temporary person-level record by (a) insertion
order — a rowid table writes one participant's rows at consecutive rowids — and (b) their shared key
values (all of one person's opinion-keyed rows carry the same `cohort`, `state` and party-match).
`SELECT … WHERE day = D ORDER BY rowid` would reconstruct each day's contributions. This is a general
result, not a tuning problem: **any mechanism that permits surgical subtraction of a time window must
record per-cell-per-time deltas, and a small per-time delta is a person record.** Surgical excision
and "no per-person record at rest" are therefore incompatible, and the guarantee wins.

Poisoning is instead handled by **prevention** (a Cloudflare per-IP rate limit on
`POST /api/research`, already live) and **detection** via Cloudflare request analytics (the
infra layer already meters request volume to the route). If an attack is ever confirmed, the
remedy is coarse and documented: tighten the limit, annotate the affected wave in the analysis
plan, and — only in the worst case — discard that election's counters and re-open collection.
We accept the loss of surgical excision as the price of the guarantee. A consequence: the store
now contains **no timestamp finer than a calendar quarter** (`collection_period_count`); no
per-day or finer time exists anywhere.

**The migration's own comment is superseded by the paragraph above.** `apps/web/migrations/0001_research.sql`
attributes prevention to "Cloudflare rate limit + Bot Fight Mode". No managed bot-detection service is
subscribed on this account, so the Bot Fight Mode half was never accurate: the per-IP WAF rate limit
and the self-hosted proof-of-work ([0017](0017-self-hosted-proof-of-work-challenge.md)) are the whole
edge defence, and the absence of a behavioural layer is accepted residual risk under threat-model T8.
The comment is deliberately left as written. That migration has been applied and its hash is pinned in
`infra/providers/cloudflare/migration-registry.json`, so an applied migration is immutable — editing
one to correct prose means re-pinning the hash, which spends the registry's only tamper signal on a
comment and makes the pin unable to distinguish a prose fix from a schema change. Corrections to a
migration's commentary belong in this ADR, which the comment already cites.

**Publication differencing gate**: the stats generator republishes an election's
file only when at least `MIN_CELL` new responses have accrued since the published file,
so no pair of published snapshots ever differs by fewer than k contributors. `STATS_FORCE=1`
overrides for deliberate regeneration.

**Series discipline replaces re-scoring.** Scoring is fixed per wave (engine + `data_version`
archived in git); a method change dual-runs for one wave and publishes bridged estimates.
Re-scoring history is a methodological error in a trend series, so its loss is accepted.

## Schema

The research D1 is provisioned from a single aggregate-only migration
(`apps/web/migrations/0001_research.sql`): only counter tables, no per-person table, so the schema is
aggregate-only by construction. `scripts/check-aggregate-only.mjs` (source scan + schema replay +
provenance) and the deploy-time production-schema allowlist keep it that way. The database id lives in
the CI variable `CF_D1_DATABASE_ID`, not in the repo (public-repo hygiene); the deploy workflow
injects it and runs `wrangler d1 migrations apply --remote`.

## Alternatives considered

- **Client-side local differential privacy (randomised response).** Noisy microdata with
  per-record plausible deniability. Rejected: LDP error grows ~1/√N per cell; at
  `MIN_CELL = 10` / `DASHBOARD_MIN = 50` scale the noise swamps the signal (sensible only at
  ~10⁵+ respondents).
- **Client-encrypted raw vectors to an escrowed offline key.** Preserves re-scoring but
  recreates the honeypot and adds a long-lived key-custody obligation, contradicting the goal
  that the database is never a source of individual exposure. Rejected.
- **Keep a row-level record with a hardening checklist** (separate ingestion queues, shuffled
  batch writes, segregated accounts…). Strictly more operational surface for a strictly weaker
  guarantee. Rejected.

## Consequences

- **A leak of the research store exposes only counts.** The PIA's answer-vector fingerprint
  risk is retired; the new, smaller residual risks are (1) small cells (a count of 1 in a rare
  bucket is attribute disclosure against someone known to have participated) — capped by the
  key rule above; and (2) the full profile existing *in flight* for one request — contained by
  the ingestion path storing no request body, IP, or trace identifier, and by keeping
  exception/analytics tooling off `POST /api/research` (PIA §3).
- **Research value is preserved as a confirmatory series**: the published views are unchanged
  (party × one demographic, proposition support), `weighting_frame_count` keeps the whole
  series post-stratifiable against ABS/AEC benchmarks, and `proposition_party_count` adds the
  highest-value research cross. Lost, by design: retroactive re-scoring, unplanned crosstabs,
  raw-data replication. The retention purpose narrows to "pre-registered aggregate trend
  analysis" (Privacy Policy / PIA updated).
- **Retention is indefinite.** Because the store holds only genuinely aggregated group counts (not
  personal information), the APP 11.2 destroy limb does not bite: the aggregates are kept
  indefinitely (Privacy Policy §5's aggregate carve-out), with no fixed maximum period. Deletion is
  purpose-based (after-election review or PIA direction), not age-based — a clock never reduced the
  small-cell residual, which is handled by the key rule and publication suppression instead.
- **Language discipline**: docs and copy say *"aggregate-only by
  construction; no per-person record is created or stored, so a particular contribution cannot
  be located or deleted"* — never "anonymous", even though the claim is now nearly true.
- Per-state party views are not produced for the 12 sensitive dimensions (national-only
  keys). The insights UI is unaffected (it renders whatever geos a view carries).
- A **new consent version** (`2026-07.2`) ships with the flip: participants consent to a
  described processing, and the description materially changes. `consent_count` records which
  notice was live, in aggregate.
- Server-side consistency validation is impossible (the server never sees answers); validation
  is shape/allowlist-only, as before. Junk party slugs can create counter rows but never
  publish — they are below k and outside the dataset's party order, so the generator drops them.
- **No surgical poisoning excision** (see "Integrity…" above): a confirmed attack is met with
  prevention/detection at the infra layer and, at worst, discarding the affected election's
  counters — the price of holding no per-request bundle at rest.
