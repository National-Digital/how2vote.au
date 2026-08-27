// Pure, and in a module of its own so it is testable without SvelteKit's runtime modules.
/**
 * A URL's path, as the route table spells it.
 *
 * `capacitor:` is a non-special scheme, so the WHATWG parser does not normalise an empty path the
 * way it does for `http(s)`: `new URL("capacitor://localhost").pathname` is `""`, where
 * `https://localhost` gives `"/"`. The iOS shell serves the app from `capacitor://localhost`, so the
 * landing — the one route the app always opens on — arrived as the empty string, matched nothing in
 * the route table and was declined, while every other route would have been served natively.
 *
 * Unreachable on the web and on Android (`https://localhost`), which is why nothing else sees it.
 */
export function routePath(url: URL): string {
  return url.pathname === "" ? "/" : url.pathname;
}
