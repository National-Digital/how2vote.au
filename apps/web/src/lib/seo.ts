/**
 * Single source of truth for per-route SEO metadata.
 *
 * Titles and descriptions live here (not inline in each page) so their length policy can be
 * enforced in CI (see seo.test.ts): titles 10–60 chars, descriptions 50–160. `Meta.svelte`
 * resolves the current route against this map and emits <title>, description, canonical and the
 * OpenGraph/Twitter tags. The site is fully static and prerendered, so the production origin is
 * not knowable at prerender time — it is pinned here and combined with the request pathname.
 */

/** Canonical production origin (apex). Drives canonical URLs, OG url and the sitemap. */
export const SITE_URL = "https://how2vote.au";
export const SITE_NAME = "how2vote";
export const OG_LOCALE = "en_AU";

/** Absolute URL of the default shared social preview image (the current election). */
export const OG_IMAGE = `${SITE_URL}/og.png`;
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/**
 * Absolute URL of an election's social preview image (generated per election at build time, see
 * scripts/generate-og.mjs). Falls back to the default image for an unknown id.
 */
export function ogImageFor(electionId: string | undefined): string {
  return electionId ? `${SITE_URL}/og-${electionId}.png` : OG_IMAGE;
}

export type PageMeta = {
  title: string;
  description: string;
  /** false → emit robots noindex (transient app-flow routes, not content pages). Default true. */
  index?: boolean;
};

/**
 * Metadata for a per-election landing page (`/2019`, `/2022`, …). Built from the election rather
 * than the static route map so it can carry the year, kept within the same length policy the map
 * follows. The current election lives at `/` and uses the default landing metadata instead.
 */
export function electionLandingMeta(label: string): PageMeta {
  return {
    title: `${label} — how2vote`,
    description: `Compare your views with the parties' real parliamentary voting record for the ${label}, House and Senate.`,
  };
}

/**
 * Per-route metadata. Keys are canonical pathnames without a trailing slash (SvelteKit
 * `trailingSlash: 'never'`), except the root "/".
 */
export const pageMeta = {
  "/": {
    title: "How do your views compare with the parties? — how2vote",
    description:
      "Answer real questions the current Parliament has voted on and see how your views compare with the parties, scored on their recorded votes — not their promises.",
  },
  "/about": {
    title: "About how2vote",
    description:
      "Who builds how2vote and why: an independent voting-record comparison tool that scores parties on their real parliamentary voting record, not their promises.",
  },
  "/methodology": {
    title: "How how2vote works",
    description:
      "How how2vote works: every party is scored on its recorded parliamentary votes, then compared question by question with your answers.",
  },
  "/privacy": {
    title: "Privacy — how2vote",
    description:
      "How how2vote handles your data and your privacy on the site, including what is stored, where your quiz answers live, and how they are used.",
  },
  "/contact": {
    title: "Contact — how2vote",
    description:
      "Get in touch with the how2vote team — questions, corrections or a bug report. Send a message and we'll get back to you as soon as we can.",
  },
  "/terms": {
    title: "Terms of use — how2vote",
    description:
      "The terms that govern using how2vote: you build your own voting plan, results are historical comparisons only, and always check your ballot before voting.",
  },
  "/accessibility": {
    title: "Accessibility — how2vote",
    description:
      "how2vote's accessibility commitment: WCAG 2.2 AA target, keyboard and screen-reader support, no drag-and-drop, text alternatives, and how to give feedback.",
  },
  "/corrections": {
    title: "Corrections — how2vote",
    description:
      "Report an error in a candidate, party or issue page, and see how2vote's correction log, response times and methodology version history.",
  },
  "/glossary": {
    title: "Glossary — how2vote",
    description:
      "Short, plain-English meanings for the words how2vote uses — division, proposition, Hansard, alignment, aggregate counts, data vintage and more.",
  },
  "/insights": {
    title: "Insights — how2vote",
    description:
      "De-identified, aggregate insights from the optional how2vote survey — how people's views and circumstances line up with parties' real voting records.",
  },
  "/research": {
    title: "Research methods — how2vote",
    description:
      "How the optional how2vote survey is analysed: the estimand registry, the disclosure controls behind Insights, and the ethics and statistical standards it meets.",
  },
  "/start": {
    title: "Before you start — how2vote",
    description:
      "A quick eligibility check before you compare your views for a federal election. Comparing is open to everyone; a how-to-vote plan is for people 18 and over.",
    index: false,
  },
  "/ballot": {
    title: "Find your electorate — how2vote",
    description:
      "Choose your state and federal electorate so how2vote can build your voting comparison for your House and Senate ballot paper.",
    index: false,
  },
  "/quiz": {
    title: "The questions — how2vote",
    description:
      "Answer 50 real questions that parliament has voted on. It takes about five minutes and your progress is saved as you go.",
    index: false,
  },
  "/review": {
    title: "Review your answers — how2vote",
    description:
      "Check and change your answers before how2vote builds your personal voting comparison for the House and the Senate.",
    index: false,
  },
  "/survey": {
    title: "Before your plan — how2vote",
    description:
      "An optional research invitation before you build your voting plan for your House and Senate ballot. Contributing is your choice and never changes your result.",
    index: false,
  },
  "/card": {
    title: "Your how2vote comparison",
    description:
      "See how your answers align with each candidate's party record in official ballot order, then build your own voting plan for your House and Senate ballot.",
    index: false,
  },
  "/offline": {
    title: "Offline — how2vote",
    description:
      "how2vote runs entirely on your device, so the questions, the scoring and your card keep working with no internet connection.",
    index: false,
  },
  "/saved": {
    title: "Saved cards — how2vote",
    description:
      "The how2vote cards you've saved to this device. They are kept only in this browser, never uploaded, and you can delete them at any time.",
    index: false,
  },
} satisfies Record<string, PageMeta>;

export const DEFAULT_META: PageMeta = pageMeta["/"];

/** Content routes that should be indexed and listed in the sitemap (index !== false). */
export const indexableRoutes: string[] = Object.entries(pageMeta)
  .filter(([, meta]) => (meta as PageMeta).index !== false)
  .map(([path]) => path);

/** Normalise a pathname to a canonical key: strip a trailing slash except for the root. */
export function canonicalPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

/** Resolve metadata for a pathname, falling back to the site default for unknown routes. */
export function resolveMeta(pathname: string): PageMeta {
  const key = canonicalPath(pathname);
  return (pageMeta as Record<string, PageMeta>)[key] ?? DEFAULT_META;
}
