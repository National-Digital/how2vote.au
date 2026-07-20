// See https://svelte.dev/docs/kit/types#app
declare global {
  /** Four-digit year the site was built, injected by Vite at build time (see vite.config.ts). */
  const __BUILD_YEAR__: number;

  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
