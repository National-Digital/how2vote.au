<script lang="ts">
  import { page } from "$app/state";
  import { electionById } from "@how2vote/data-schema";
  import Landing from "$lib/components/Landing.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import StructuredData from "$lib/components/StructuredData.svelte";
  import { electionLandingMeta, ogImageFor } from "$lib/seo";
  import { electionEventGraph } from "$lib/structured-data";

  const id = $derived(page.params.election!);
  const meta = $derived(electionById(id)!);
  const pageMeta = $derived(electionLandingMeta(meta.label));
  const event = $derived(electionEventGraph(meta));
</script>

<Meta title={pageMeta.title} description={pageMeta.description} image={ogImageFor(id)} />
{#if event}<StructuredData node={event} />{/if}

<Landing electionId={id} />
