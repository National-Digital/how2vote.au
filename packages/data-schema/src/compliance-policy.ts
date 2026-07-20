/**
 * Provenance constant for the COMPLIANCE POLICY under which an election release is built and shipped.
 *
 * The reproducibility equation for a displayed result is:
 *
 *     dataset version + questionnaire version + matching-algorithm version
 *       + compliance-policy version + user responses = displayed result
 *
 * The matching-algorithm version is {@link METHODOLOGY_VERSION} (the scoring method IS the matching
 * algorithm — see methodology.ts). The DATA version is each manifest's `dataVersion`/`snapshotVersion`.
 * This constant supplies the remaining dimension: which version of the compliance programme's
 * product rules governed the release — the authorisation/print rules, sharing restrictions,
 * attribution/licence handling, election-period publishing, corrections/suspension and retention
 * behaviour that shape what a user actually sees, shares and prints.
 *
 * It is stamped into every `data/dist/<id>/manifest.json` (buildManifest) so a displayed result can
 * be reproduced from versioned inputs and an auditor can tell which compliance policy applied.
 *
 * Bump on any material change to those product rules (the substance tracked by the control register,
 * docs/legal/control-register.json, and the legal review, docs/legal/legal-review.json). A pure data
 * refresh or a scoring-method change does NOT bump it. Every bump must be recorded and dated in
 * docs/compliance-policy-changelog.md.
 *
 * Format: `YYYY.N` — calendar year of the change, then a within-year sequence number (mirrors
 * METHODOLOGY_VERSION).
 */
export const COMPLIANCE_POLICY_VERSION = "2026.2";
