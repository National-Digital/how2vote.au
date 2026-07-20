import { browser } from "$app/environment";

/**
 * A shared, slowly-ticking wall clock for the few places that must react to the passage of real
 * time rather than to a user action — currently the election-day close of the Insights page, whose
 * window boundaries (00:00 and 8 pm AEST on polling day) must flip a tab that is left open across
 * them, without a reload.
 *
 * A plain `$derived(new Date())` never re-runs (it has no reactive dependency), so it would only
 * ever reflect the time at hydration. This exposes `current` as reactive state and refreshes it on
 * an interval instead. The cadence is deliberately coarse (~60 s): the only consumer is a window
 * measured in hours, so second-level precision buys nothing and a frequent timer would be wasteful.
 *
 * `start()` is idempotent and a no-op on the server, so it is safe to call from component setup that
 * also runs during prerender. Until it is called, `current` holds the value captured at module load.
 */
class Now {
  current = $state<Date>(new Date());
  #timer: ReturnType<typeof setInterval> | null = null;

  /** Begin refreshing `current` every `intervalMs` (default 60 s). Idempotent; browser-only. */
  start(intervalMs = 60_000): void {
    if (!browser || this.#timer) return;
    this.current = new Date();
    this.#timer = setInterval(() => {
      this.current = new Date();
    }, intervalMs);
  }
}

export const now = new Now();
