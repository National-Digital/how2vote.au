<script lang="ts">
  import { page } from "$app/state";
  import DataPage from "$lib/components/DataPage.svelte";
  import ElectionToggle from "$lib/components/ElectionToggle.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import { electionHome } from "$lib/nav";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const home = $derived(electionHome(page.params.election!));
  const crumbs = $derived([home, { label: "Where parties stand" }]);
</script>

<Meta title={data.seo.title} description={data.seo.description} type="article" />

<DataPage
  {crumbs}
  title="Where parties stand — {data.label}"
  intro="The {data.issues
    .length} parliamentary propositions behind the {data.year} How2Vote scoring. Open any one to see how every party is recorded voting on it."
>
  <div class="switch"><ElectionToggle active={page.params.election!} section="issues" /></div>

  <ul class="rows">
    {#each data.issues as q (q.href)}
      <li><a href={q.href}>{q.text}</a></li>
    {/each}
  </ul>

  <p class="source">
    Each proposition links to the parliamentary <a href="/glossary#division">divisions</a> behind it on
    They Vote For You. Positions are the recorded voting record — How2Vote takes no side on any proposition.
  </p>
</DataPage>
