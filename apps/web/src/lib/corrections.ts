/**
 * Correction / right-of-reply runtime suspension.
 *
 * A candidate's party mapping or its alignment figure can be disputed and flagged for correction.
 * While a flag stands, the runtime must SUSPEND showing that party's alignment rather than leave a
 * disputed figure standing.
 *
 * This lever is SUBSUMED by the signed governance control plane: the flags
 * still live in the plain, data-driven file the runtime reads (data/corrections/suspensions.json,
 * enforced by scripts/check-candidate-corrections.mjs), but `suspendedPartyKeys` now resolves to the
 * UNION of that list and the control plane's `mapping` scope (apps/web/src/lib/governance.ts). This
 * module is kept as the stable `$lib/corrections` import used by the card; the composition — and the
 * fail-closed integrity check — lives in $lib/governance.
 */
export { suspendedPartyKeys } from "$lib/governance";
