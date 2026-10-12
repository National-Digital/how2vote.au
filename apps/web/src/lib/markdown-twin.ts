/**
 * Routes published with a Markdown twin: the same page's `<main>` as `/<path>.md`, generated after
 * the build by scripts/build-markdown.mjs. The page announces its twin with
 * `<link rel="alternate" type="text/markdown">` (Meta.svelte), and the generator writes a twin for
 * exactly the pages that announce one.
 */
import { SITE_URL } from "$lib/seo";

export const MARKDOWN_TWIN_ROUTES: ReadonlySet<string> = new Set([
  "/methodology",
  "/[election=election]/electorates/[electorate]",
  "/[election=election]/parties/[party]",
  "/[election=election]/issues/[issue]",
  "/[election=election]/senate/[state]",
]);

/**
 * The twin's absolute URL for a route, or null when the route has none. Absolute, like the canonical
 * link, so the prerender crawler does not request a file that only exists after the build.
 */
export function markdownTwinHref(routeId: string | null, pathname: string): string | null {
  if (!routeId || !MARKDOWN_TWIN_ROUTES.has(routeId)) return null;
  if (pathname === "/" || pathname.endsWith("/")) return null;
  return `${SITE_URL}${pathname}.md`;
}
