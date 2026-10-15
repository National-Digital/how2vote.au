<script lang="ts">
  import { CURRENT_ELECTION_ID, electionById } from "@how2vote/data-schema";
  import Landing from "$lib/components/Landing.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import StructuredData from "$lib/components/StructuredData.svelte";
  import { electionEventGraph } from "$lib/structured-data";

  const event = electionEventGraph(electionById(CURRENT_ELECTION_ID)!);
</script>

<Meta />
{#if event}<StructuredData node={event} />{/if}

<Landing electionId={CURRENT_ELECTION_ID} />
