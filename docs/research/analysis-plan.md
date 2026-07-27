# How2Vote research — pre-registered analysis plan (estimand registry)

Status: **v1** (2026-07-14) · Decision: [ADR-0008](../adr/0008-aggregate-counters.md) ·
Companion: [codebook](codebook.md)

Under the aggregate-counters storage model (ADR-0008), the research dataset holds **only the
counter tables listed here**. Nothing else is collected, so nothing else can ever be analysed:
this registry is the complete, closed list of estimands the research programme commits to. That
is a deliberate design property, not a limitation to work around — the programme is a
**confirmatory repeated cross-sectional trend series**, the design used by official statistics,
not an open-ended microdata archive.

This document is also the **documented longitudinal research purpose** that justifies long-term
retention: retention beyond five years is permissible where the purpose
is defined, reviewed after each election, and data is deleted when no longer required.

## Estimands

Each estimand maps 1:1 to a counter table (`apps/web/migrations/0001_research.sql`).
A counter row is `key → n`, only ever incremented at ingestion; no per-person record exists at
any point at rest.

| # | Estimand | Counter table | Keys | Geography floor |
|---|----------|---------------|------|-----------------|
| E1 | Response volume (denominators; per-cohort dashboard gate) | `response_total` | election, cohort, state | State |
| E2 | Top-party match × one demographic at a time | `demographic_count` | election, cohort, state, dimension, bucket, party | State for the 9 non-sensitive dimensions; **national for the 12 sensitive dimensions** (see below) |
| E3 | Proposition support (agree / neutral / disagree) | `proposition_count` | election, cohort, proposition, stance | National |
| E4 | Proposition stance × top-party match (“do people who match a party agree with its positions?”) | `proposition_party_count` | election, cohort, proposition, stance, party | National |
| E5 | Weighting frame: joint age × gender × state per cohort, **no opinion variables** — enables post-stratification of the whole series against ABS/AEC benchmarks | `weighting_frame_count` | election, cohort, state, age, gender | State |
| E6 | Response coverage by electorate (no attributes attached) | `geography_count` (separate endpoint, `/api/research/geography`) | election, electorate | Electorate — count only, no cohort, never joined to any opinion or demographic |
| E7 | Consent-version record (which collection notice was live) | `consent_count` | election, consent version | — |
| E8 | Collection-period record (when responses arrived, AEST quarter grain) | `collection_period_count` | election, cohort, YYYY-Qn | — |

## Disclosure-control rule for keys (at rest)

> **No counter may key an opinion variable together with a sensitive attribute and a geography
> finer than national.**

The top-party match and proposition stances are political opinion. The **sensitive dimensions**
(Privacy Act 1988 (Cth) sensitive-information categories) are: `union_member`; `birthplace`,
`language`, `indigenous` (racial/ethnic origin); `religion`, `attendance`; `orientation`; and
`politics_scale`, `party_id`, `past_vote`, `vote_intention`, `vote_next` (political opinion). Rows
for these dimensions are stored **national-only** (state stored as the `''` sentinel). The
**non-sensitive dimensions** — `age`, `gender`, `education`, `work`, `household_size`,
`children`, `tenure`, `income`, `financial` — may key state. `geography_count` carries no
attribute at all. This caps the semantics of the worst leaked row at "one person somewhere in
Australia", assessed in the PIA as the model's residual risk.

Every time-varying counter is additionally keyed by the **collection cohort** (item 14 —
pre-declaration / live / post-election / historical / unknown, classified server-side against the
AEC timetable), so per-cohort suppression is exact and cohorts are never silently combined; no
combined cell-view is published when more than one cohort exists (differencing protection).

A **placeholder election** that targets a parliament period before the election is announced has no
AEC timetable, so it cannot be classified against one. It instead reports its **provisional
lifecycle stage** (`pending` → `provisional` → `drawn`) as the cohort. This is deliberate series
discipline: the questions are still in flight during `pending` and are locked when the stage becomes
`provisional`, which is an instrument change — a **series break** — so the two waves must stay
separate counter series and are never combined, exactly as the option-set rule below requires.

Publication adds the existing gates on top: per-cohort k ≥ 10 cell suppression, 50-response board minimum,
shown-equals-sum-of-surviving-cells, and the regeneration differencing gate
(`packages/data-pipeline`).

## Series discipline

- **Scoring is fixed per wave.** Each election's counters are derived with that election's
  engine + dataset (`data_version`; engine archived in git). Historical waves are never
  re-scored. If the method must change, dual-run for one wave and publish bridged estimates
  (series-break handling).
- **Instrument stability.** The 20-question instrument and its ABS/AES-aligned buckets
  (codebook) are held stable across waves; option-set changes create a new codebook version and
  are documented as a series break for the affected dimension.
- **New estimands are additive and forward-only.** Adding a counter table (or key) is a
  governed change to this plan: it requires a new plan version, a disclosure review against the
  rule above, and applies from the next collection onward. Nothing can be computed
  retrospectively — by design.

## Retention

The counters are genuinely aggregated statistics that do not relate to an identifiable individual,
so they are **retained indefinitely** — there is no fixed maximum period (Privacy Policy §5; ADR-0008).
A retention clock never mitigated the residual small-cell risk (a cell that is `n = 1` after any
number of years is `n = 1` because only one person ever matched that combination); that risk is
handled by the key rule, publication suppression and access control, not by deletion.

Deletion is therefore **purpose-based, not age-based**. A wave's counters are deleted when:

- an after-election review determines its research purpose has ended; or
- the privacy impact assessment directs deletion of a wave, dimension or cell.

There is no delta/integrity log and no timestamp finer than the collection quarter to age out (see
ADR-0008 "Integrity without a person-reconstructable delta log"). `scripts/retention-sweep.sql` is
the per-election deletion template used when a review or the PIA calls for it.

## Standing per-election review

After each federal election: (1) confirm the estimands above are still required, and delete any
that are not; (2) run the disclosure review over anything published; (3) reassess
re-identification risk in the current data environment (including whether a
published file should be withdrawn); (4) record the review outcome here with a date.

| Date | Review outcome |
|------|----------------|
| 2026-07-14 | v1 registered (pre-launch; no data held). |
