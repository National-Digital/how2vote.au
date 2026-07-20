import { fullCorpus } from "$lib/content.server";

// Prerendered to a static /llms-full.txt at build time. The complete factual corpus (every
// election's propositions, party voting records and candidate ballots) generated entirely from the
// committed datasets — the companion to the concise /llms.txt. See $lib/content.server (fullCorpus).
export const prerender = true;

export function GET() {
  return new Response(fullCorpus(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
