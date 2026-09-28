import { render } from "svelte/server";
import { CURRENT_ELECTION_ID, ELECTION_IDS } from "@how2vote/data-schema";
import AboutPage from "$lib/components/AboutPage.svelte";
import type { EntryGenerator, RequestHandler } from "./$types";

// The About page as it reads for each past election, rendered once at build time for the iOS app
// to draw while that election is selected (ADR 0019 D4b). The current election's is `/about`.
export const prerender = true;

export const entries: EntryGenerator = () =>
  ELECTION_IDS.filter((id) => id !== CURRENT_ELECTION_ID).map((election) => ({ election }));

export const GET: RequestHandler = ({ params }) => {
  const { body } = render(AboutPage, { props: { electionId: params.election } });
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="robots" content="noindex"><title>How2Vote</title></head>
<body><main>${body}</main></body>
</html>
`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
};
