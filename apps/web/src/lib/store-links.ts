/**
 * Public store listings for the native shells (apps/mobile). Both stay null until each listing is
 * actually live — the store badges (StoreBadges.svelte) render nothing for a null, so flipping a
 * value here is the single switch that turns the badge on everywhere it appears. Badges are
 * web-channel-only: a store app must never advertise the other store (App Review), and inside a
 * shell the badge would be pointless anyway.
 */
export const STORE_LINKS: {
  appStore: string | null;
  playStore: string | null;
  fDroid: string | null;
} = {
  // e.g. "https://apps.apple.com/au/app/how2vote/id0000000000"
  appStore: null,
  // e.g. "https://play.google.com/store/apps/details?id=au.how2vote.app"
  playStore: null,
  // e.g. "https://f-droid.org/packages/au.how2vote.app/" — set only once F-Droid has actually
  // published the app. F-Droid builds from source on their own schedule after the recipe is merged
  // (docs/fdroid/), so a listing exists later than the tag, and the badge must not promise a page
  // that 404s. F-Droid also asks that the badge only point at an app in their main repository.
  fDroid: null,
};
