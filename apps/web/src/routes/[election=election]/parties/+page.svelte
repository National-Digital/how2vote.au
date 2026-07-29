<script lang="ts">
  import DocLink from "$lib/components/DocLink.svelte";
  import { page } from "$app/state";
  import DataPage from "$lib/components/DataPage.svelte";
  import ElectionToggle from "$lib/components/ElectionToggle.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import { electionHome } from "$lib/nav";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const home = $derived(electionHome(page.params.election!));
  const crumbs = $derived([home, { label: "Party voting records" }]);
</script>

<Meta title={data.seo.title} description={data.seo.description} type="article" />

<DataPage
  {crumbs}
  title="Party voting records — {data.label}"
  intro="Every party and independent with a federal parliamentary voting record scored for the {data.year} election. Open one to see how it voted, proposition by proposition."
>
  <div class="switch"><ElectionToggle active={page.params.election!} section="parties" /></div>

  <ul class="cols">
    {#each data.parties as p (p.href)}
      <li>
        <a href={p.href}>{p.name}</a>{#if p.independent}<span class="meta">
            · independent</span
          >{/if}
      </li>
    {/each}
  </ul>

  <p class="source">
    Positions are compiled from recorded parliamentary votes, sourced from They Vote For You. See
    <DocLink href="/methodology">how the scoring works</DocLink>.
  </p>
</DataPage>
