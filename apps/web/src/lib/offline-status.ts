/**
 * Reads what the service worker has actually cached, so the offline page can tell the visitor the
 * truth about what they can still do — rather than a hopeful guess. Everything here queries the
 * Cache Storage API from the window; it never assumes the SW installed. Safe to call anywhere
 * (returns a "not supported / nothing cached" result rather than throwing).
 *
 * The SW names its cache `how2vote-<version>` (see src/service-worker.ts) and precaches every built
 * asset, the bundled dataset and every prerendered route on install. We look only at those caches.
 */

/** A single flow step we want to report availability for. */
export type OfflineCheck = { path: string; label: string };

export type OfflineItem = OfflineCheck & { available: boolean };

export type OfflineCapability = {
  /** The Cache Storage API exists in this browser. */
  supported: boolean;
  /** A how2vote SW cache is present (i.e. the app has been installed for offline use). */
  installed: boolean;
  /** Every requested step is cached — the whole card flow works with no connection. */
  ready: boolean;
  items: OfflineItem[];
};

const CACHE_PREFIX = "how2vote-";

/**
 * Resolve the offline availability of each given flow step against the live SW caches.
 *
 * @param checks - Flow steps to test, in display order.
 */
export async function readOfflineCapability(checks: OfflineCheck[]): Promise<OfflineCapability> {
  const unavailable = checks.map((c) => ({ ...c, available: false }));

  if (typeof caches === "undefined") {
    return { supported: false, installed: false, ready: false, items: unavailable };
  }

  try {
    const keys = await caches.keys();
    const ours = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    if (ours.length === 0) {
      return { supported: true, installed: false, ready: false, items: unavailable };
    }

    const items = await Promise.all(
      checks.map(async (c) => ({ ...c, available: await isCached(ours, c.path) })),
    );
    return {
      supported: true,
      installed: true,
      ready: items.every((i) => i.available),
      items,
    };
  } catch {
    // Storage disabled / private-mode quirks — degrade to "can't tell", never crash the page.
    return { supported: false, installed: false, ready: false, items: unavailable };
  }
}

/** True if any of our caches holds a response for `path` (ignoring the URL fragment/query). */
async function isCached(cacheNames: string[], path: string): Promise<boolean> {
  for (const name of cacheNames) {
    const cache = await caches.open(name);
    const match = await cache.match(path, { ignoreSearch: true });
    if (match) return true;
  }
  return false;
}
