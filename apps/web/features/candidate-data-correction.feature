# Control: control-7 — candidate / data correction and right of reply (ADR 0005 snapshot store;
#          data/corrections/suspensions.json). Traceable to the legal control register entry for
#          corrections and provenance.
#
# Business context (readable by developers, lawyers and product owners):
#   Published candidate information is sourced from an external dataset (They Vote For You), captured
#   as an immutable, provenance-stamped snapshot. When a verified correction arrives, the corrected
#   data is published as a NEW snapshot version — never an edit to a locked one — and that new version
#   must record who verified it, why, and which version it supersedes. The original source, its
#   retrieval date, and the previous version therefore remain auditable. While a figure is in dispute
#   the runtime withdraws it (a correction / right-of-reply suspension) rather than leaving it standing.
#
# This specification is bound to the real schemas and engine by apps/web/src/features.test.ts:
#   - the snapshot version / meta schemas in @how2vote/data-schema (source, retrievedAt, supersedes,
#     verifiedBy, reason), which enforce the auditable correction trail; and
#   - generateCard in @how2vote/engine with a `suspended` party set, the runtime lever that withdraws
#     a disputed figure while the prior data remains in git history and the snapshot store.

Feature: Candidate data is corrected
  So that a published error can be fixed without losing provenance, a verified correction is
  published as a new snapshot version while the source, retrieval date and previous version stay
  auditable.

  Scenario: Candidate data is corrected
    Given published candidate information was sourced from an external dataset
    When a verified correction is received
    Then the corrected data is published
    And the source, retrieval date and previous version remain auditable
