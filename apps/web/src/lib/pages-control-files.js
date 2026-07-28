/**
 * Files that live in `static/` but are configuration for Cloudflare Pages rather than servable
 * assets. Pages reads them at deploy time and does not serve them: `/_headers` returns 404 in
 * production while `vite preview` serves it locally.
 *
 * They must therefore be kept out of the service worker's precache list, which is installed with a
 * single atomic `cache.addAll()` — one unfetchable path rejects the install and disables offline
 * support entirely. They are excluded via `kit.serviceWorker.files` in `svelte.config.js` and the
 * built list is gated by `scripts/check-precache.mjs`.
 *
 * Extend this list when a new Pages control file is introduced (e.g. `_routes.json`, `_worker.js`).
 */
export const PAGES_CONTROL_FILES = ["_headers", "_redirects"];

/** The paths those files would occupy if served — what must never enter the precache list. */
export const PAGES_CONTROL_PATHS = PAGES_CONTROL_FILES.map((name) => `/${name}`);
