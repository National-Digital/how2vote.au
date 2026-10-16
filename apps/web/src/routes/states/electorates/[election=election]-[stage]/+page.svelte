<script lang="ts">
  import { page } from "$app/state";
  import ElectorateHubPage from "$lib/components/ElectorateHubPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<Meta title={data.data.seo.title} description={data.data.seo.description} type="article" />

<ElectorateHubPage data={data.data} election={page.params.election!} stage={data.stage} />
