<script lang="ts">
  // The body lives in $lib/content/MethodologyContent.svelte so the same markup renders here and in
  // the dialog raised by an in-flow link to this document. The JSON-LD stays here: it describes the
  // document at THIS url.
  import ContentPage from "$lib/components/ContentPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import StructuredData from "$lib/components/StructuredData.svelte";
  import MethodologyContent from "$lib/content/MethodologyContent.svelte";
  import { methodologyHowToGraph, openDataDatasetGraph } from "$lib/structured-data";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<Meta />
<StructuredData node={methodologyHowToGraph()} />
<StructuredData node={openDataDatasetGraph(data.openData)} />

<ContentPage title="How it works">
  <MethodologyContent />
</ContentPage>
