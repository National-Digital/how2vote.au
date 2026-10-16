<script lang="ts">
  import { page } from "$app/state";
  import { electionById } from "@how2vote/data-schema";
  import ElectorateHubPage from "$lib/components/ElectorateHubPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import { ballotFor } from "$lib/ballots";
  import { stageFor } from "$lib/election-stage";
  import { now } from "$lib/now.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const election = $derived(page.params.election!);
  // The stage now, so a page built before the stage changed still reads for the stage it is in.
  now.start();
  const stage = $derived(stageFor(electionById(election)!, ballotFor(election), now.current));
</script>

<Meta title={data.seo.title} description={data.seo.description} type="article" />

<ElectorateHubPage {data} {election} {stage} />
