/**
 * schema.org (JSON-LD) structured data for the site.
 *
 * The graphs live here as pure builders so their shape is unit-tested (see structured-data.test.ts)
 * and both the sitewide {@link JsonLd.svelte} and the insights route render identical, escaped
 * markup:
 *
 * - {@link siteGraph} — an Organization + WebSite + WebApplication `@graph`, emitted once from the
 *   root layout. Nodes are cross-referenced by `@id` (publisher → the Organization) rather than
 *   re-declared, so search engines merge them into one entity across every page.
 * - {@link electionEventGraph} / {@link ballotPageGraph} — each election as an Event, and the
 *   candidates on each House and Senate ballot as Person items by printed position, from the
 *   same data the landing and content pages render.
 * - {@link insightsDatasetGraph} — a Dataset describing the published, k-anonymised survey
 *   aggregates on /insights, so the data is discoverable (e.g. Google Dataset Search) and cites its
 *   creator by the same Organization `@id`.
 *
 * Everything here is factual and neutral by construction: no ratings, reviews, or party/valence
 * signal — consistent with the project's neutrality guarantee.
 */
import { ELECTIONS, type ElectionMeta } from "@how2vote/data-schema";
import { ORG } from "./org";
import { SITE_URL, SITE_NAME } from "./seo";
import { STORE_LINKS } from "./store-links";

/** Stable node identifiers, referenced by `@id` from other nodes and across pages. */
// The Organization's id is the publisher's own, not this site's: its other sites emit the same
// string, so the nodes resolve to one organisation rather than several sharing a name.
export const ORG_ID = `${ORG.website}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const WEBAPP_ID = `${SITE_URL}/#webapp`;
export const INSIGHTS_DATASET_ID = `${SITE_URL}/insights#dataset`;

/** Public source repository — the application's canonical alternate representation. */
export const SOURCE_REPO_URL = "https://github.com/National-Digital/how2vote.au";

const SITE_DESCRIPTION =
  "An independent tool to compare your views with parties' real parliamentary voting records for Australian federal elections.";

/**
 * Sitewide entity graph: who publishes the site (Organization), the site itself (WebSite) and the
 * tool it hosts (WebApplication). The WebApplication and WebSite both point at the Organization by
 * `@id`; the WebApplication lists the public source repo and every live store listing under
 * `sameAs`, so the site and the published apps resolve to one entity.
 */
export function siteGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        // The publisher is the operating ENTITY, not the site/brand: the Organization node names
        // National Digital (with its full legal name) so search engines attribute the site to the
        // real party behind it, sourced from the single-source org record. The "How2Vote" brand
        // lives on the WebSite/WebApplication `name` below. Every property here must hold for the
        // ENTITY, not this site, because the `@id` merges this node with the entity's own.
        "@type": "Organization",
        "@id": ORG_ID,
        name: ORG.tradingName,
        legalName: ORG.legalName,
        url: ORG.website,
      },
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        description: SITE_DESCRIPTION,
        inLanguage: "en-AU",
        publisher: { "@id": ORG_ID },
      },
      {
        "@type": "WebApplication",
        "@id": WEBAPP_ID,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        description: SITE_DESCRIPTION,
        applicationCategory: "Reference",
        operatingSystem: "Any",
        browserRequirements: "Requires JavaScript; installable and works offline as a PWA.",
        inLanguage: "en-AU",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "AUD" },
        publisher: { "@id": ORG_ID },
        // Read from STORE_LINKS rather than restated, so a listing that goes live is carried here
        // by the same one-line switch that turns its badge on, and one that is not live is absent
        // rather than a dead URL.
        sameAs: [SOURCE_REPO_URL, ...Object.values(STORE_LINKS).filter((url) => url !== null)],
      },
    ],
  };
}

/** Inclusive year range the aggregates cover, as an ISO 8601 interval (e.g. "2019/2025"). */
function electionYearRange(): string {
  const years = ELECTIONS.map((e) => e.year);
  return `${Math.min(...years)}/${Math.max(...years)}`;
}

/**
 * Dataset describing the published survey aggregates served under /stats. One DataDownload per
 * election plus the index; `creator` references the Organization by `@id`. No `license` is asserted
 * — the aggregates carry none (the ODbL in LICENSE-DATA governs the vote dataset, not these), and a
 * fabricated one would be worse than none.
 */
export function insightsDatasetGraph() {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": INSIGHTS_DATASET_ID,
    name: "How2Vote survey — aggregate insights",
    description:
      "De-identified, aggregate results from the optional survey people answer after building a voting comparison, published with k-anonymity suppression. Descriptive only — an opt-in, non-probability sample, not a representative poll.",
    url: `${SITE_URL}/insights`,
    creator: { "@id": ORG_ID },
    isAccessibleForFree: true,
    inLanguage: "en-AU",
    spatialCoverage: { "@type": "Place", name: "Australia" },
    temporalCoverage: electionYearRange(),
    measurementTechnique: "Opt-in online survey (non-probability sample)",
    variableMeasured: [
      "Party match by respondent demographic group",
      "Agreement with each parliamentary proposition",
    ],
    distribution: [
      {
        "@type": "DataDownload",
        name: "Index of published elections",
        encodingFormat: "application/json",
        contentUrl: `${SITE_URL}/stats/index.json`,
      },
      ...ELECTIONS.map((e) => ({
        "@type": "DataDownload",
        name: `${e.label} aggregates`,
        encodingFormat: "application/json",
        contentUrl: `${SITE_URL}/stats/${e.id}.json`,
      })),
    ],
  };
}

/**
 * The three steps a voter takes to build a card. This is the SINGLE source for both the visible
 * "In short" list on /methodology and the HowTo JSON-LD below, so the structured data can never
 * drift from what the page shows (see structured-data.test.ts + the methodology page, which both
 * consume this array). Factual, no valence.
 */
export const HOWTO_STEPS: { name: string; text: string }[] = [
  {
    name: "Find your electorate",
    text: "Choose your state and federal electorate so the card is built for the candidates on your House and Senate ballot.",
  },
  {
    name: "Answer the propositions",
    text: "Answer real propositions parliament has voted on, on a five-point scale, and star the ones that matter most to you.",
  },
  {
    name: "Compare, then build your plan",
    text: "See how your answers align with each party's recorded votes, shown in official ballot order — then choose your own preferences to build your voting plan.",
  },
];

/**
 * HowTo graph for the methodology page, built from {@link HOWTO_STEPS} — the same array the page
 * renders — so the two cannot diverge. Steps carry no `url` (the flow routes they'd point at are
 * noindex).
 */
export function methodologyHowToGraph() {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to build your How2Vote voting plan",
    description:
      "Compare your views with Australian parties on their recorded parliamentary votes, then build your own voting plan for your House and Senate ballot.",
    step: HOWTO_STEPS.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}

/**
 * BreadcrumbList graph from an ordered list of `{name, url}` items (the same trail the visible
 * breadcrumb renders). Emitted on the data-derived content pages so search engines show the
 * hierarchy and can climb it.
 */
export function breadcrumbGraph(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

/**
 * FAQPage graph from factual question/answer pairs: the data facts on each issue page (which parties
 * are recorded agreeing with a proposition), and the questions /how-to-decide answers on the page.
 * An answer states what the page shows and carries no editorial or partisan signal.
 */
export function faqGraph(qas: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qas.map((qa) => ({
      "@type": "Question",
      name: qa.question,
      acceptedAnswer: { "@type": "Answer", text: qa.answer },
    })),
  };
}

const AUSTRALIA = { "@type": "Country", name: "Australia" } as const;

/** Stable `@id` for an election's Event node, independent of which election is current. */
export const electionEventId = (electionId: string): string => `${SITE_URL}/${electionId}#election`;

/**
 * Event node for a federal election, from its registry entry. Null until a polling day is recorded:
 * an unannounced election has no date or status to state. `EventScheduled` is the schema.org status
 * for an event that is (or was) held as planned. `url` is the election's own landing path, which is
 * only served while the election is not current.
 */
export function electionEventNode(meta: ElectionMeta) {
  if (!meta.date) return null;
  return {
    "@type": "Event",
    "@id": electionEventId(meta.id),
    name: meta.label,
    ...(meta.current ? {} : { url: `${SITE_URL}/${meta.id}` }),
    startDate: meta.date,
    endDate: meta.date,
    eventStatus: "https://schema.org/EventScheduled",
    location: {
      "@type": "Place",
      name: "Australia",
      address: { "@type": "PostalAddress", addressCountry: "AU" },
    },
    organizer: {
      "@type": "Organization",
      name: "Australian Electoral Commission",
      url: "https://www.aec.gov.au/",
    },
  };
}

/** Standalone Event graph for an election's landing page, or null when it has no polling day. */
export function electionEventGraph(meta: ElectionMeta) {
  const event = electionEventNode(meta);
  return event && { "@context": "https://schema.org", ...event };
}

/** A ballot line as the content pages render it: position, name and party label as printed. */
export type BallotCandidate = { position: number; candidate: string; party: string };

/** The printed name without the trailing separator a mononym leaves (e.g. "MERVIN JOSHUA, "). */
const printedName = (candidate: string): string => candidate.trim().replace(/,$/, "");

/**
 * Whether a ballot label names no organisation: blank, "Independent", or the candidate's own name
 * (e.g. "David Pocock" for "POCOCK, David").
 */
function isUnaffiliated(c: BallotCandidate): boolean {
  const label = c.party.trim().toLowerCase();
  if (label === "" || label === "independent") return true;
  const [surname = "", given = ""] = c.candidate.split(",").map((s) => s.trim().toLowerCase());
  return label === `${given} ${surname}`.trim() || label === `${surname} ${given}`.trim();
}

/**
 * A candidate as printed on the ballot: name, plus the printed party label as `affiliation` when it
 * names an organisation. A ballot label is not proof of membership, so `memberOf` is not used. No
 * other personal data: candidate records are minimised to the ballot line.
 */
function candidateNode(c: BallotCandidate) {
  return {
    "@type": "Person",
    name: printedName(c.candidate),
    ...(isUnaffiliated(c)
      ? {}
      : { affiliation: { "@type": "Organization", name: c.party.trim() } }),
  };
}

/** The electorate (House) or state (Senate) a ballot covers, contained in Australia. */
export function ballotPlace(stateName: string, electorate?: string) {
  const state = { "@type": "AdministrativeArea", name: stateName, containedInPlace: AUSTRALIA };
  return electorate
    ? { "@type": "AdministrativeArea", name: electorate, containedInPlace: state }
    : state;
}

/** Candidates as ListItems whose `position` is the position printed on the ballot. */
const candidateItems = (candidates: BallotCandidate[]) =>
  candidates.map((c) => ({ "@type": "ListItem", position: c.position, item: candidateNode(c) }));

/** A House ballot: one list of candidates by printed ballot position. */
export function houseBallotList(candidates: BallotCandidate[]) {
  return {
    "@type": "ItemList",
    numberOfItems: candidates.length,
    itemListElement: candidateItems(candidates),
  };
}

/**
 * A Senate ballot: one list per group in printed order, each holding its candidates by their
 * position within the group. "UG" is the ungrouped column.
 */
export function senateBallotList(groups: { group: string; candidates: BallotCandidate[] }[]) {
  return {
    "@type": "ItemList",
    numberOfItems: groups.length,
    itemListElement: groups.map((g, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "ItemList",
        name: g.group === "UG" ? "Ungrouped" : `Group ${g.group}`,
        numberOfItems: g.candidates.length,
        itemListElement: candidateItems(g.candidates),
      },
    })),
  };
}

/**
 * A ballot page as a CollectionPage: the ballot list is its `mainEntity`, the electorate or state
 * it covers its `spatialCoverage`, and the election its `about`. No `itemListOrder` is asserted:
 * ballot order is drawn by lot and is not a ranking. Candidates are listed as candidates only;
 * nothing here states office held, alignment or rank.
 */
export function ballotPageGraph(args: {
  name: string;
  url: string;
  election: ElectionMeta;
  place: ReturnType<typeof ballotPlace>;
  list: ReturnType<typeof houseBallotList> | ReturnType<typeof senateBallotList>;
}) {
  const event = electionEventNode(args.election);
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: args.name,
    url: args.url,
    ...(event ? { about: event } : {}),
    spatialCoverage: args.place,
    mainEntity: args.list,
  };
}

/**
 * Serialise a JSON-LD object for embedding in a `<script type="application/ld+json">` block.
 * Escapes every `<` so the payload can never terminate the script element early.
 */
export function serializeJsonLd(node: unknown): string {
  return JSON.stringify(node).replace(/</g, "\\u003c");
}
