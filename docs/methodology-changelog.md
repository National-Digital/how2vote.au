# Methodology change log

A dated, versioned record of changes to how2vote's **scoring method** — the arithmetic and
editorial rules published on the [methodology page](https://how2vote.au/methodology). This is
distinct from the [correction log](corrections.md), which records fixes to *data* (a wrong
candidate, mapping or figure). A pure data refresh (new divisions, a new election's ballots) does
**not** bump the method version.

The version below is the single source of truth defined in
`apps/web/src/lib/provenance.ts` (`METHODOLOGY_VERSION`) and surfaced on the methodology page and
the public `/corrections` route. Bump it, and add an entry here, on any change to: the 1–5 banding,
the per-question distance/points formula, the extremely-important (10×) weighting, how a party's
members are averaged into a position, or how merged/renamed parties are combined.

## 2026.1 — 2026-07-14

First published scoring method (rebuild; ADR
[0006](adr/0006-legal-compliance-rebuild.md)):

- **Party positions** are the plain average of the [They Vote For You](https://theyvoteforyou.org.au/)
  agreement figures (0–100) of that party's members, each counted once, placed on a 1–5 scale by
  five equal 20-point bands. A party with no member on the record for an issue has **no position**
  (never guessed).
- **Per-question scoring** uses the whole-number distance `d = |party − you|`. A strong answer is
  worth `max(0, 4 − d)`, a moderate answer `max(0, 3 − d)`, equal merits `max(0, 2 − d)`.
- **Extremely-important** marking multiplies both points earned and points at stake by exactly ten
  (`max(0, 40 − 10d)`); only the two strongest answers may be starred.
- **Overall match** adds earned and possible points across answered questions, then rounds a single
  percentage. Merged/renamed parties are combined by adding raw earned and possible points **before**
  rounding — the merge pools raw scores rather than averaging already-rounded percentages.
- Candidates are never ranked by score; scores are shown only beside candidates in official ballot
  order.

The scoring engine is open source and covered by tests that pin these numbers exactly.
