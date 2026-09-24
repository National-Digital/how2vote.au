import { render } from "svelte/server";
import AgeGateStates from "$lib/components/AgeGateStates.svelte";

// The age gate's explore-only explainer, rendered once at build time for the iOS app to project
// (ADR 0019 D4b). A file rather than a page: it is removed from every other channel's build, never
// precached, and kept out of the app's universal links, so no visitor can open it out of the flow
// that explains it.
export const prerender = true;

export function GET(): Response {
  const { body } = render(AgeGateStates);
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="robots" content="noindex"><title>How2Vote</title></head>
<body><main>${body}</main></body>
</html>
`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
