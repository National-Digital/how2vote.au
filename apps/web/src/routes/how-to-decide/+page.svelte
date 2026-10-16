<script lang="ts">
  import { CURRENT_ELECTION_ID, electionById } from "@how2vote/data-schema";
  import HowToDecidePage from "$lib/components/HowToDecidePage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import { ballotFor } from "$lib/ballots";
  import { stageFor } from "$lib/election-stage";
  import { now } from "$lib/now.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  // The stage now, so a page built before the stage changed still reads for the stage it is in.
  now.start();
  const stage = $derived(
    stageFor(electionById(CURRENT_ELECTION_ID)!, ballotFor(CURRENT_ELECTION_ID), now.current),
  );
</script>

<Meta />

<HowToDecidePage {...data} {stage} />
