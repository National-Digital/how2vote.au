<script lang="ts">
  import { CURRENT_ELECTION_ID } from "@how2vote/data-schema";
  import Landing from "$lib/components/Landing.svelte";
  import Meta from "$lib/components/Meta.svelte";
</script>

<Meta />

<Landing electionId={CURRENT_ELECTION_ID} />
