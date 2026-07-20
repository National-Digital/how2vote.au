<script lang="ts">
  // Emits an arbitrary JSON-LD node into the document head as an application/ld+json data block
  // (not executable script, so it is exempt from the strict script-src CSP). Mirrors JsonLd.svelte
  // (the sitewide graph) for per-page graphs — breadcrumbs, HowTo, FAQ. The node is escaped in
  // $lib/structured-data (serializeJsonLd) so "<" can never terminate the script element early.
  import { serializeJsonLd } from "$lib/structured-data";

  let { node }: { node: unknown } = $props();
  const json = $derived(serializeJsonLd(node));
</script>

<svelte:head>
  {@html `<script type="application/ld+json">${json}</script>`}
</svelte:head>
