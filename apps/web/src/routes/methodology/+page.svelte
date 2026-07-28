<script lang="ts">
  // The body lives in $lib/content/MethodologyContent.svelte so the same markup renders here and in
  // the dialog raised by an in-flow link to this document. The HowTo JSON-LD stays here: it
  // describes the document at THIS url.
  import ContentPage from "$lib/components/ContentPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import StructuredData from "$lib/components/StructuredData.svelte";
  import MethodologyContent from "$lib/content/MethodologyContent.svelte";
  import { methodologyHowToGraph } from "$lib/structured-data";
</script>

<Meta />
<StructuredData node={methodologyHowToGraph()} />

<ContentPage title="How it works">
  <MethodologyContent />
</ContentPage>
