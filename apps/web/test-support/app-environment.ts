// `$app/environment` for unit tests. The SvelteKit plugin is omitted from vitest.config.ts, so this
// alias stands in for the runtime module. `browser` is true because the modules under test are the
// on-device ones, whose real behaviour only exists in a browser — a false value would make their
// storage branches vacuously pass.
export const browser = true;
export const dev = false;
export const building = false;
export const version = "0.0.0-test";
