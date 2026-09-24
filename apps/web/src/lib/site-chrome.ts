/**
 * The chrome every screen carries — the footer's links, the copyright credit and the electoral
 * authorisation — as data.
 *
 * `Footer.svelte` renders it on the web and Android; on iOS the native core covers the layout, so the
 * same values are handed to it with each route (ADR 0018 D6) and it declines a route without them.
 */
import { CURRENT_ELECTION_ID } from "@how2vote/data-schema";
import { AUTHORISATION, DATA_SOURCE, LICENCES, ORG } from "$lib/org";

export { AUTHORISATION };

export type FooterLink = { label: string; href: string };
export type CreditPart = { text: string; href?: string };

/**
 * The footer's navigation, grouped by adjacency: understand → browse the data → the org →
 * legal/governance last. Saved cards appear only once the visitor has saved one.
 */
export function footerLinks(savedCount: number): FooterLink[] {
  const e = CURRENT_ELECTION_ID;
  const links: FooterLink[] = [
    { label: "How it works", href: "/methodology" },
    { label: "Glossary", href: "/glossary" },
    { label: "Where parties stand", href: `/${e}/issues` },
    { label: "Party records", href: `/${e}/parties` },
    { label: "Candidates", href: `/${e}/electorates` },
    { label: "Insights", href: "/insights" },
    { label: "Research methods", href: "/research" },
    { label: "Corrections", href: "/corrections" },
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
    { label: "Accessibility", href: "/accessibility" },
    { label: "Privacy policy", href: "/privacy" },
    { label: "Terms of use", href: "/terms" },
  ];
  if (savedCount > 0) links.push({ label: "Saved cards", href: "/saved" });
  return links;
}

/**
 * Where the native core sends a voter who wants to give feedback. The web's feedback dialog is a
 * layout overlay the native screens cover, and the contact form takes the same message.
 */
export const FEEDBACK_LINK: FooterLink = { label: "Feedback", href: "/contact" };

/**
 * The one-line credit: the application (AGPL-3.0) and the vote data (the minimum ODbL attribution
 * They Vote For You requires). Both name a holder and link their licence.
 *
 * @param buildYear - the year the build was made, so the range never drifts to the visitor's clock
 */
export function footerCredit(buildYear: number): CreditPart[] {
  return [
    { text: "© " },
    { text: ORG.tradingName, href: ORG.website },
    { text: ` 2019–${buildYear} (` },
    { text: LICENCES.app.shortName, href: LICENCES.app.url },
    { text: ") · Vote data © " },
    { text: DATA_SOURCE.name, href: DATA_SOURCE.url },
    { text: ` (${DATA_SOURCE.publisher}), ` },
    { text: LICENCES.data.shortName, href: LICENCES.data.url },
  ];
}
