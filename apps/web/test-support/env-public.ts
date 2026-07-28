/**
 * Vitest stand-in for SvelteKit's `$env/dynamic/public` (aliased in vitest.config.ts). Unit
 * tests run without the SvelteKit plugin, so modules that read PUBLIC_ vars (channel.ts,
 * formspree.ts, turnstile.ts) resolve this empty map instead — i.e. tests always see the
 * "unset" build-time state and exercise each module's documented fallback.
 */
export const env: Record<string, string | undefined> = {};
