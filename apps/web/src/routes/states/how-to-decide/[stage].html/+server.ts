import { error } from "@sveltejs/kit";
import { render } from "svelte/server";
import HowToDecidePage from "$lib/components/HowToDecidePage.svelte";
import { howToDecide } from "$lib/content/how-to-decide.server";
import { STAGES, type Stage } from "$lib/election-stage";
import type { EntryGenerator, RequestHandler } from "./$types";

// /how-to-decide as it reads at each stage, rendered once at build time for the iOS app to draw the
// one the election is at (ADR 0019 D4b).
export const prerender = true;

export const entries: EntryGenerator = () => STAGES.map((stage) => ({ stage }));

export const GET: RequestHandler = ({ params }) => {
  const stage = params.stage as Stage;
  if (!STAGES.includes(stage)) error(404, "No such stage");
  const { body } = render(HowToDecidePage, { props: { ...howToDecide(), stage } });
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="robots" content="noindex"><title>How2Vote</title></head>
<body><main>${body}</main></body>
</html>
`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
};
