import { render } from "svelte/server";
import ReviewStates from "$lib/components/ReviewStates.svelte";

// Rendered once, at build time, for the iOS app to project (ADR 0019 D4b). A server-rendered file
// rather than a page, so it adds no client code and no route a visitor can reach through the app.
export const prerender = true;

export function GET(): Response {
  const { body } = render(ReviewStates);
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="robots" content="noindex"><title>How2Vote</title></head>
<body><main>${body}</main></body>
</html>
`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
