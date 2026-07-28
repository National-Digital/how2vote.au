/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { ELECTION_IDS } from "@how2vote/data-schema";
import { build, files, prerendered, version } from "$service-worker";

// The offline PWA: precache the whole app shell + the bundled dataset + the core
// prerendered routes, so the quiz, scoring, the card, opening a shared link — and the branded
// /offline page — all work with zero connectivity. Updates are atomic and version-stamped.
//
// Update discipline (do NOT skipWaiting / claim unconditionally): a deploy mid-quiz must not pull the
// rug out from an open session. The active page holds references to lazily-imported chunks from the
// build it loaded with; if a new worker activated immediately, deleted the old cache and claimed the
// page, that page's next dynamic import (e.g. the dataset at the card step) would 404 → a permanent
// spinner. So the new worker WAITS: the running session keeps its own cache generation until it is
// closed or explicitly reloaded, and old caches are only pruned once the new worker actually
// activates (after the old clients have gone). A client that wants the update now posts "SKIP_WAITING"
// (behind a reload prompt) — nothing is forced.

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `how2vote-${version}`;

// The data-derived content pages (/<election>/electorates|senate|issues|parties…) number in the
// hundreds — SEO/reference content, not part of the offline card flow. Precaching them would make
// install slow and fragile (one atomic addAll of every page) for no offline benefit, so they are
// excluded here and instead cached on demand by the network-first fetch handler below. The core
// flow routes (/, /ballot, /quiz, …, /offline) and the election landings stay precached.
const isDataPage = (path: string): boolean => ELECTION_IDS.some((id) => path.startsWith(`/${id}/`));

// `prerendered` holds the built HTML for every route; keep the core flow (drop the data pages) so
// the whole flow is available offline on first install and the offline-status page can honestly
// report each step as saved.
const corePrerendered = prerendered.filter((path) => !isDataPage(path));
const PRECACHE = [...build, ...files, ...corePrerendered];

sw.addEventListener("install", (event) => {
  // Precache the new generation, but do NOT skipWaiting: the new worker stays "waiting" so any open
  // session keeps running on the worker + cache it loaded with.
  //
  // addAll is deliberately atomic: a half-populated generation would serve part of one version and
  // miss the rest. The trade-off is that a single unfetchable entry disables offline support, so every
  // path in PRECACHE must be servable in production. Cloudflare Pages 404s the _headers/_redirects it
  // consumes as config, so those are excluded via kit.serviceWorker.files in svelte.config.js and the
  // built list is gated by scripts/check-precache.mjs.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

sw.addEventListener("activate", (event) => {
  // Runs only once this worker actually takes over (the previous clients have gone, or a client asked
  // to SKIP_WAITING). Only THEN is it safe to prune older cache generations. No clients.claim(): a
  // page keeps the worker it loaded with until it navigates/reloads.
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
    })(),
  );
});

// Opt-in immediate update: the app may show a "new version — reload" prompt and post this message to
// activate the waiting worker on the user's command (never automatically mid-session).
sw.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") void sw.skipWaiting();
});

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // never intercept cross-origin (e.g. TVFY links)

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      // Precached build assets are immutable for this version — serve from cache first.
      if (PRECACHE.includes(url.pathname)) {
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
      }

      // Otherwise: network first, falling back to cache (and caching successful navigations), so a
      // card generated on the bus still opens in a polling place with no signal.
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") cache.put(request, response.clone());
        return response;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        // A navigation to something we haven't cached, with no network: show the branded offline
        // page (it explains what IS available and links back into the cached flow), falling back to
        // the app shell only if that page somehow isn't cached.
        if (request.mode === "navigate") {
          const offline = (await cache.match("/offline")) ?? (await cache.match("/"));
          if (offline) return offline;
        }
        throw new Error("offline and uncached");
      }
    })(),
  );
});
