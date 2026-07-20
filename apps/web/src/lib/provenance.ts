/**
 * Provenance constants for the scoring methodology.
 *
 * `METHODOLOGY_VERSION` now lives in `@how2vote/data-schema` (ADR 0005: the pipeline stamps it into
 * every election manifest so each release records the method version it was built under). Re-exported here so the methodology and corrections pages keep
 * their import site. See the constant's doc comment for the bump rules; every bump must be
 * recorded, dated, in docs/methodology-changelog.md.
 */
export { METHODOLOGY_VERSION } from "@how2vote/data-schema";
