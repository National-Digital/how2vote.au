/**
 * The stale-data notice's wording and its dismissal, shared by `StaleDataNotice.svelte` and the iOS
 * native core, which covers the layout and is handed the notice with each route (ADR 0018 D6).
 *
 * WHEN it fires is `staleness.ts`, identical on every channel; this module holds only what it says
 * and whether the voter has already dismissed it for the bundled dataVersion.
 */
import type { StalenessVerdict } from "$lib/staleness";

// Remembered against the dataVersion it was shown for, in the how2vote: namespace so it is backed
// up and cleared like all other on-device state.
const DISMISS_KEY = "how2vote:stale-dismissed:v1";

export function staleMessage(verdict: StalenessVerdict): string {
  return verdict.level === "prominent"
    ? `This app's candidate data (from ${verdict.dataVersion}) is from before nominations were finalised, so the ballot may be incomplete.`
    : `This app's candidate data is from ${verdict.dataVersion}. A newer version may be available.`;
}

class StaleDismissal {
  version = $state<string | null>(null);

  hydrate(): void {
    try {
      this.version = localStorage.getItem(DISMISS_KEY);
    } catch {
      // Storage blocked — treat as not dismissed.
    }
  }

  remember(dataVersion: string): void {
    this.version = dataVersion;
    try {
      localStorage.setItem(DISMISS_KEY, dataVersion);
    } catch {
      // Storage blocked — the dismissal holds for this session only.
    }
  }
}

export const staleDismissal = new StaleDismissal();
