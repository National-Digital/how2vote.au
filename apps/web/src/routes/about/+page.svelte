<script lang="ts">
  import AboutPage from "$lib/components/AboutPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import { election } from "$lib/election.svelte";
</script>

<Meta />

<AboutPage electionId={election.id} />
