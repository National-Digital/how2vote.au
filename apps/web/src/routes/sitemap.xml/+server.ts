import { SITE_URL, indexableRoutes } from "$lib/seo";
import { contentPaths } from "$lib/content.server";

// Prerendered to a static sitemap.xml at build time (fully static site, see +layout.ts).
export const prerender = true;

// Static content routes (from seo.ts) plus every data-derived page (election landings, the
// electorate/Senate/issue/party hubs and their details) enumerated from the datasets. The transient
// app-flow routes (ballot/quiz/review/survey/card) are index:false and excluded there.
const staticRoutes = indexableRoutes;

// Home ranks highest; the per-election hubs above their long-tail detail pages.
const priorityFor = (path: string): string => {
  if (path === "/") return "1.0";
  const depth = path.split("/").filter(Boolean).length;
  return depth <= 1 ? "0.7" : depth === 2 ? "0.6" : "0.5";
};

export function GET() {
  const paths = [...staticRoutes, ...contentPaths()];
  const urls = paths
    .map(
      (path) =>
        `  <url>\n    <loc>${SITE_URL}${path === "/" ? "/" : path}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>${priorityFor(path)}</priority>\n  </url>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
