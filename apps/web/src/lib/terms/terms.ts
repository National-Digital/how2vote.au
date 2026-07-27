/**
 * Centralised Terms-of-Use versioning + acceptance copy — the SINGLE source of truth for the current
 * Terms version and the exact wording of the click-acceptance affirmation.
 *
 * Terms incorporation is by ACTIVE, VERSIONED click-acceptance at each consequential interaction
 * (building a plan, creating a share link, printing the s321D worksheet, and contributing to
 * research), never a passive "by using the site you agree". The version here lets a material Terms
 * change re-prompt: an acceptance is recorded against exactly this version, and the acceptance store
 * treats an acceptance of any other version as not-accepted (fail closed — see terms.svelte.ts).
 *
 * The version is bound three ways so it cannot drift:
 *   - the terms hash registry (docs/legal/terms-registry.json) records this version's content hash;
 *   - the public Terms page surfaces this version string verbatim; and
 *   - scripts/check-terms.mjs fails CI if any of the three disagree, or if the Terms wording changes
 *     without a new version + registry entry.
 *
 * This module is a LEAF — it imports nothing app-specific, so the version + copy can be pulled into
 * the acceptance store, every gate component and the guard alike. Bump TERMS_VERSION on any material
 * change to the Terms wording, add the new version to the registry, and update the surfaced version
 * on the Terms page in the same change.
 */

/**
 * Version of the Terms of Use a user actively accepts. Shape `YYYY-MM` with an optional `.N` minor,
 * matching the research consent-version shape (e.g. `2026-07` or `2026-07.1`). This is the ONE place
 * the value is defined; the store, the gate components, the Terms page and the guard all read it.
 */
export const TERMS_VERSION = "2026-07.2";

/**
 * The exact affirmation a user ticks to accept the Terms. It is deliberately a CAPACITY declaration
 * as well as an agreement: it confirms the user is acting as an individual (a natural person), not on
 * behalf of an organisation and not as a foreign campaigner. This is how the "no organisation /
 * foreign-campaigner use" position (Terms §"Who may use the Service") is actively affirmed at every
 * gated action, so an organisation or foreign-campaigner attempt cannot proceed without disclaiming
 * that capacity. Single-sourced so the card gate, the survey gate and the guard cannot drift.
 */
export const TERMS_ACCEPTANCE_LABEL =
  "I have read and agree to the Terms of Use, and I am using How2Vote as an individual (a natural " +
  "person) — not on behalf of an organisation and not as a foreign campaigner.";

/** Short lead-in shown above the acceptance affirmation in the reusable gate. */
export const TERMS_GATE_INTRO =
  "Before you continue, please confirm you accept the current Terms of Use. This is separate from " +
  "any research consent.";

/** Accessible group name for the acceptance gate — shared by the gate component and the e2e suites. */
export const TERMS_GATE_LABEL = "Terms of Use acceptance";
