import { browser } from "$app/environment";

/**
 * One authoritative "clear all my How2Vote data" action.
 *
 * The site keeps everything on the visitor's own device: their in-progress quiz, saved comparisons,
 * selected election, theme, Terms acknowledgement, age-eligibility bit and privacy/consent choice all
 * live in localStorage, and the offline PWA keeps an app-shell + dataset cache in the Cache Storage
 * API. This module is the single control that wipes the lot in one action.
 *
 * FAIL-CLOSED COMPLETENESS. Every store namespaces its localStorage key under
 * {@link STORAGE_KEY_PREFIX} and the service worker names every cache under {@link CACHE_NAME_PREFIX}
 * (both asserted in CI by scripts/check-clear-all.mjs). Rather than hand-list the individual keys —
 * which would silently miss a store added later — {@link clearLocalDeviceData} SWEEPS the whole
 * namespace: every localStorage/sessionStorage key that starts with the prefix, and every cache whose
 * name starts with the cache prefix. A new store is cleared automatically the day it lands, and the CI
 * guard fails the build if any store's key or any cache name ever escapes the swept namespace.
 *
 * The known keys as at this writing (all covered by the sweep):
 *   how2vote:quiz:v2:<election>  in-progress quiz per election  ($lib/quiz.svelte)
 *   how2vote:saved:v1            saved comparisons              ($lib/saved.svelte)
 *   how2vote:terms-accept:v2     Terms-of-Use acknowledgement   ($lib/terms.svelte)
 *   how2vote:consent:v1          privacy / analytics choice     ($lib/privacy/registry)
 *   how2vote:election:v1         selected election              ($lib/election.svelte)
 *   how2vote:theme               light/dark/system preference   ($lib/theme.svelte)
 *   how2vote:age-ok:v1           18+ eligibility bit            ($lib/age.svelte)
 *   how2vote-<build-version>     offline app-shell + dataset    (service-worker.ts)
 *
 * This wipes on-device state only. It does not — and cannot — recall an already-shared link: a share
 * link carries its answers in the URL fragment, so once sent it lives with the recipient and is
 * independent of this device (see the share-copy warning on /card and the Privacy policy).
 */

/** Namespace every localStorage / sessionStorage key the site writes shares. */
export const STORAGE_KEY_PREFIX = "how2vote:";

/** Namespace every Cache Storage cache the service worker creates shares. */
export const CACHE_NAME_PREFIX = "how2vote-";

/** Keys under {@link STORAGE_KEY_PREFIX} in a Web Storage area, oldest-index first. */
function namespacedKeys(store: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key !== null && key.startsWith(STORAGE_KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

/**
 * Deletes EVERY piece of How2Vote state on this device: all namespaced localStorage and
 * sessionStorage keys, and all service-worker caches. Best-effort and never throws — each area is
 * cleared independently so a blocked or unavailable one (private mode, no Cache API) does not stop the
 * others. A caller should reload the app afterwards so every in-memory store re-hydrates from the now
 * empty storage (a hard reload is the simplest way to guarantee no in-memory residue survives).
 */
export async function clearLocalDeviceData(): Promise<void> {
  if (!browser) return;

  try {
    for (const key of namespacedKeys(localStorage)) localStorage.removeItem(key);
  } catch {
    // localStorage blocked/unavailable — nothing to clear there.
  }

  try {
    for (const key of namespacedKeys(sessionStorage)) sessionStorage.removeItem(key);
  } catch {
    // sessionStorage blocked/unavailable — nothing to clear there.
  }

  try {
    if ("caches" in globalThis) {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_NAME_PREFIX))
          .map((name) => caches.delete(name)),
      );
    }
  } catch {
    // Cache Storage unavailable or a delete rejected — the storage wipe above still stands.
  }
}
