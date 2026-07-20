<script lang="ts">
  // Sitewide structured data (schema.org): an Organization + WebSite + WebApplication @graph,
  // emitted once from the root layout. Rendered as an application/ld+json data block — not
  // executable script, so it is not subject to the strict script-src CSP. The graph is built and
  // escaped in $lib/structured-data (unit-tested there).
  import { siteGraph, serializeJsonLd } from "$lib/structured-data";

  const json = serializeJsonLd(siteGraph());
</script>

<svelte:head>
  {@html `<script type="application/ld+json">${json}</script>`}
</svelte:head>
