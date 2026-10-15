// See https://svelte.dev/docs/kit/types#app
declare global {
  /** Four-digit year the site was built, injected by Vite at build time (see vite.config.ts). */
  const __BUILD_YEAR__: number;
  /** Each election's ballot, from its committed dataset (see vite.config.ts, scripts/ballot-states.mjs). */
  const __BALLOTS__: Record<string, "none" | "provisional" | "drawn">;

  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
