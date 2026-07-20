/**
 * Provenance constant for the scoring methodology (freeze editorial methodology per election
 * release, ADR 0005).
 *
 * A single, human-set version number for how2vote's *scoring method* — the arithmetic and editorial
 * rules described on /methodology, not the data vintage (per-election, on each manifest) nor the
 * app build. It lives in the shared schema package so BOTH the app (methodology page, corrections
 * history) and the data pipeline (which stamps it into every `data/dist/<id>/manifest.json`) read
 * the same value: the manifest records which method version an election's release was built under.
 *
 * Bump on ANY change to the scoring method: the 1–5 banding, the distance/points formula, the
 * extremely-important weighting, how party records are averaged, or how merged/renamed parties are
 * combined. A pure data refresh does NOT bump it. Every bump must be recorded, dated, in
 * docs/methodology-changelog.md — and the method must NOT change while any election is in its
 * `live` phase; if it ever must, that is a disclosed material correction (/corrections).
 *
 * Format: `YYYY.N` — calendar year of the change, then a within-year sequence number.
 */
export const METHODOLOGY_VERSION = "2026.1";
