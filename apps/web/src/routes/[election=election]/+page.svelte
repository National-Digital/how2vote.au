<script lang="ts">
  import { page } from "$app/state";
  import { electionById } from "@how2vote/data-schema";
  import Landing from "$lib/components/Landing.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import { electionLandingMeta, ogImageFor } from "$lib/seo";

  const id = $derived(page.params.election!);
  const meta = $derived(electionById(id)!);
  const pageMeta = $derived(electionLandingMeta(meta.label));
</script>

<Meta title={pageMeta.title} description={pageMeta.description} image={ogImageFor(id)} />

<Landing electionId={id} />
