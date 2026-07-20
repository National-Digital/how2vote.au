/**
 * schema.org (JSON-LD) structured data for the site.
 *
 * Two graphs live here as pure builders so their shape is unit-tested (see structured-data.test.ts)
 * and both the sitewide {@link JsonLd.svelte} and the insights route render identical, escaped
 * markup:
 *
 * - {@link siteGraph} — an Organization + WebSite + WebApplication `@graph`, emitted once from the
 *   root layout. Nodes are cross-referenced by `@id` (publisher → the Organization) rather than
 *   re-declared, so search engines merge them into one entity across every page.
 * - {@link insightsDatasetGraph} — a Dataset describing the published, k-anonymised survey
 *   aggregates on /insights, so the data is discoverable (e.g. Google Dataset Search) and cites its
 *   creator by the same Organization `@id`.
 *
 * Everything here is factual and neutral by construction: no ratings, reviews, or party/valence
 * signal — consistent with the project's neutrality guarantee.
 */
import { ELECTIONS } from "@how2vote/data-schema";
import { ORG } from "./org";
import { SITE_URL, SITE_NAME } from "./seo";

/** Stable node identifiers, referenced by `@id` from other nodes and across pages. */
export const ORG_ID = `${SITE_URL}/#org`;
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
 * `@id`; the WebApplication lists the public source repo under `sameAs`.
 */
export function siteGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        // The publisher is the operating ENTITY, not the site/brand: the Organization node names
        // National Digital (with its full legal name) so search engines attribute the site to the
        // real party behind it, sourced from the single-source org record. The "how2vote" brand
        // lives on the WebSite/WebApplication `name` below, and this entity is linked to its own
        // corporate site via `sameAs`.
        "@type": "Organization",
        "@id": ORG_ID,
        name: ORG.tradingName,
        legalName: ORG.legalName,
        url: SITE_URL,
        logo: `${SITE_URL}/icon.svg`,
        sameAs: [ORG.website],
      },
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        inLanguage: "en-AU",
        publisher: { "@id": ORG_ID },
      },
      {
        "@type": "WebApplication",
        "@id": WEBAPP_ID,
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        applicationCategory: "Reference",
        operatingSystem: "Any",
        browserRequirements: "Requires JavaScript; installable and works offline as a PWA.",
        inLanguage: "en-AU",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "AUD" },
        publisher: { "@id": ORG_ID },
        sameAs: [SOURCE_REPO_URL],
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
    name: "how2vote survey — aggregate insights",
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
    name: "How to build your how2vote voting plan",
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
 * FAQPage graph from factual question/answer pairs. Used only for *data* facts (e.g. which parties
 * are recorded agreeing with a proposition), never for questions about the app — the answers are
 * the public voting record, so the markup carries no editorial or partisan signal.
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

/**
 * Serialise a JSON-LD object for embedding in a `<script type="application/ld+json">` block.
 * Escapes every `<` so the payload can never terminate the script element early.
 */
export function serializeJsonLd(node: unknown): string {
  return JSON.stringify(node).replace(/</g, "\\u003c");
}
