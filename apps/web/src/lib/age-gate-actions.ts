/**
 * What each answer at the age gate does (ADR 0011, as amended by ADR 0012), shared by the web page
 * and the iOS app's native gate, which asks the web to act rather than acting itself.
 */
import { ageGate } from "$lib/age.svelte";

/** Affirm 18+ and continue to where the visitor was headed. */
export function declareAdult(navigate: (path: string) => void): void {
  ageGate.confirmAdult();
  navigate(ageGate.takeIntended());
}

/**
 * Record an under-18 declaration, in memory only, and clear any prior local state. Does not
 * navigate: the gate shows the explore-only explainer next.
 */
export function declareMinor(): void {
  ageGate.declareMinor();
}

/** Continue into the quiz in explore-only mode, from the start of the ballot flow. */
export function continueExploring(navigate: (path: string) => void): void {
  navigate(ageGate.takeIntended());
}
