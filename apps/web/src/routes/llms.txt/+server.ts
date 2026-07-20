import { ELECTIONS } from "@how2vote/data-schema";
import { SITE_URL, indexableRoutes, pageMeta, type PageMeta } from "$lib/seo";

// Prerendered to a static /llms.txt at build time (fully static site, see +layout.ts). The "## Pages"
// list is generated from the same indexableRoutes source that drives the sitemap, so the two can
// never drift and every indexable content page is listed automatically (see seo.test.ts, which
// asserts every route is registered in pageMeta).
export const prerender = true;

// Hand-owned prose. Everything factual about the *set* of pages is generated below.
const INTRO = `# how2vote

> An independent tool to compare a voter's views with parties' real parliamentary voting records for Australian federal elections. Voters answer questions that
> parliament has actually voted on; each party is scored on its recorded parliamentary votes, and
> that alignment is shown against the candidates on the voter's House and Senate ballot —
> always in official ballot order. Candidates are never ranked and no preference is recommended.

how2vote is a fully static, offline-capable web app. It sets no third-party cookies at all: usage is
measured by cookieless Cloudflare Web Analytics at the edge, and the contact/feedback forms are
protected by cookieless Cloudflare Turnstile that runs only on submit. The quiz, scoring and card
generation run entirely in the browser. The methodology is public and deterministic.`;

const DATA = `## Data

- Party positions are derived from real parliamentary voting records.
- The committed dataset ships with the app and carries a tamper-evident checksum and a data vintage.`;

// Per-election hub pages, generated from the election registry. Each hub fans out to the full,
// prerendered long-tail (every electorate, Senate ballot, proposition and party voting record for
// that election); those detail URLs live in the sitemap. Newest election first.
const RECORDS = `## Voting records & candidates

Factual, evidence-only pages derived from the dataset — recorded party positions and candidate
ballots per election, with no match score. Full detail URLs are in ${SITE_URL}/sitemap.xml, and the
complete data (all propositions, party voting records and candidate ballots) is generated as plain
text at ${SITE_URL}/llms-full.txt.

${ELECTIONS.map(
  (e) =>
    `- ${e.label}: [candidates by electorate](${SITE_URL}/${e.id}/electorates), [where parties stand](${SITE_URL}/${e.id}/issues), [party voting records](${SITE_URL}/${e.id}/parties)`,
).join("\n")}`;

/** Link text for a page: the registered title with the redundant " — how2vote" suffix trimmed. */
const labelFor = (path: string, meta: PageMeta): string =>
  path === "/" ? "Home" : meta.title.replace(/\s*[—-]\s*how2vote\s*$/i, "");

export function GET() {
  const pages = indexableRoutes
    .map((path) => {
      const meta = pageMeta[path as keyof typeof pageMeta] as PageMeta;
      const url = `${SITE_URL}${path === "/" ? "/" : path}`;
      return `- [${labelFor(path, meta)}](${url}): ${meta.description}`;
    })
    .join("\n");

  const body = `${INTRO}\n\n## Pages\n\n${pages}\n\n${RECORDS}\n\n${DATA}\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
