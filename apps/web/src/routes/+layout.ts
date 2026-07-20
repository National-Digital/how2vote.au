// Fully static: every route is prerendered to HTML at build time, then hydrates for interactivity.
export const prerender = true;

// Canonical URLs have no trailing slash (except root). Keeps canonical/og:url and the sitemap
// consistent with how the routes are actually served. This is SvelteKit's default, pinned explicitly.
export const trailingSlash = "never";
