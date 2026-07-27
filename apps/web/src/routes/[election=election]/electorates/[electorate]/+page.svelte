<script lang="ts">
  import { page } from "$app/state";
  import DataPage from "$lib/components/DataPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import { electionHome } from "$lib/nav";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const home = $derived(electionHome(page.params.election!));
  const crumbs = $derived([
    home,
    { label: "Electorates", href: data.hubHref },
    { label: data.electorate },
  ]);
</script>

<Meta title={data.seo.title} description={data.seo.description} type="article" />

<DataPage
  {crumbs}
  title="{data.electorate} candidates — {data.label}"
  intro="Every candidate on the House of Representatives ballot in {data.electorate}, {data.stateName}, at the {data.year} federal election, in ballot-paper order."
>
  <ul class="rows">
    {#each data.candidates as c (c.position)}
      <li>
        <span class="lead">{c.candidate}</span>
        <span class="meta">
          {#if c.partyHref}<a href={c.partyHref}>{c.party}</a>{:else}{c.party || "Independent"}{/if}
        </span>
      </li>
    {/each}
  </ul>

  <p><a href={data.senateHref}>See the {data.stateName} Senate ballot →</a></p>
  <p><a href={data.hubHref}>All electorates, {data.year} →</a></p>

  <p class="source">
    Candidate lists as declared by the Australian Electoral Commission. Party links show that
    party's recorded parliamentary voting record. How2Vote is independent and lists every candidate
    in ballot order.
  </p>
</DataPage>
