<script lang="ts">
  // A link to a reference document that opens it OVER the current page rather than navigating away.
  //
  // When to use it: open over when losing your place costs work in progress (the consent banner,
  // the Terms gate, "see how the scoring works" beside a comparison). Navigate when the document IS
  // the destination the reader chose (the footer, the landing page, cross-references between
  // reference pages). The distinction is the reader's intent, not the document — /methodology opens
  // over the card and navigates from the footer.
  //
  // Renders a real anchor with a real href, so no-JS, ⌘/Ctrl-click, middle-click, "open in new tab"
  // and "copy link address" all behave as they would for the page. Only a plain left-click is
  // intercepted.
  import type { Component } from "svelte";
  import type { Snippet } from "svelte";
  import DocDialog from "./DocDialog.svelte";

  /**
   * Documents that can be shown modally, keyed by the path they live at. Loaded on demand: the two
   * bodies together are most of the app's prose, and the consent banner sits in the root layout, so
   * importing them eagerly would put the full privacy notice and terms into the first paint of
   * every page. The chunk is part of `build`, which the service worker precaches, so opening one
   * offline still works (see src/service-worker.ts).
   */
  const DOCS: Record<string, { title: string; load: () => Promise<{ default: Component }> }> = {
    "/privacy": {
      title: "Privacy policy",
      load: () => import("$lib/content/PrivacyContent.svelte"),
    },
    "/terms": {
      title: "Terms of use",
      load: () => import("$lib/content/TermsContent.svelte"),
    },
    "/methodology": {
      title: "How it works",
      load: () => import("$lib/content/MethodologyContent.svelte"),
    },
    "/corrections": {
      title: "Corrections & methodology changes",
      load: () => import("$lib/content/CorrectionsContent.svelte"),
    },
  };

  let { href, children }: { href: string; children: Snippet } = $props();

  const doc = $derived(DOCS[href]);
  let Content = $state<Component | null>(null);
  let open = $state(false);

  async function onclick(event: MouseEvent): Promise<void> {
    // Anything that is not a plain primary click is the reader asking for real navigation.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // An href with no registered document navigates, rather than swallowing the click and doing
    // nothing — the page is always the correct fallback.
    if (!doc) return;
    event.preventDefault();
    try {
      Content ??= (await doc.load()).default;
      open = true;
    } catch {
      // The chunk could not be fetched (a genuinely cold offline start, say). Fail OPEN to the
      // page: never leave a policy link that appears to do nothing.
      location.href = href;
    }
  }
</script>

<a {href} {onclick}>{@render children()}</a>

{#if open && Content}
  <DocDialog title={doc.title} {href} onclose={() => (open = false)}>
    <Content />
  </DocDialog>
{/if}
