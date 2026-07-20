import { CURRENT_ELECTION_ID, electionById } from "@how2vote/data-schema";
import type { Crumb } from "$lib/components/Breadcrumb.svelte";
import { SITE_URL, canonicalPath } from "$lib/seo";

/**
 * The landing page for an election: the current election lives at `/`, past elections at `/<id>`.
 * Used as the root of every data-page breadcrumb so the trail always climbs back to a real page.
 */
export function electionHome(electionId: string): Crumb {
  if (electionId === CURRENT_ELECTION_ID) return { label: "Home", href: "/" };
  const meta = electionById(electionId);
  return { label: meta?.shortLabel ?? electionId, href: `/${electionId}` };
}

/**
 * Absolute `{name, url}` items for the BreadcrumbList JSON-LD, from the visible breadcrumb trail. The
 * final crumb has no href (it is the current page), so it resolves to the current pathname.
 */
export function breadcrumbItems(
  crumbs: Crumb[],
  currentPath: string,
): { name: string; url: string }[] {
  return crumbs.map((c) => ({
    name: c.label,
    url: SITE_URL + canonicalPath(c.href ?? currentPath),
  }));
}
