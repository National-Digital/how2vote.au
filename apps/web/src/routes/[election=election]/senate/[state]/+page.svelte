<script lang="ts">
  import { page } from "$app/state";
  import { electionById } from "@how2vote/data-schema";
  import DataPage from "$lib/components/DataPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import StructuredData from "$lib/components/StructuredData.svelte";
  import { electionHome } from "$lib/nav";
  import { SITE_URL, canonicalPath } from "$lib/seo";
  import { ballotPageGraph, ballotPlace, senateBallotList } from "$lib/structured-data";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const home = $derived(electionHome(page.params.election!));
  const crumbs = $derived([
    home,
    { label: "Electorates", href: data.hubHref },
    { label: `${data.stateName} Senate` },
  ]);
  const title = $derived(`${data.stateName} Senate candidates — ${data.label}`);
  const ballot = $derived(
    ballotPageGraph({
      name: title,
      url: SITE_URL + canonicalPath(page.url.pathname),
      election: electionById(page.params.election!)!,
      place: ballotPlace(data.stateName),
      list: senateBallotList(data.groups),
    }),
  );
</script>

<Meta title={data.seo.title} description={data.seo.description} type="article" />
<StructuredData node={ballot} />

<DataPage
  {crumbs}
  {title}
  intro="The full Senate ballot for {data.stateName} at the {data.year} federal election, by group, as printed on the paper."
>
  {#each data.groups as g (g.group)}
    <h2>Group {g.group}</h2>
    <ul class="rows">
      {#each g.candidates as c (c.position)}
        <li>
          <span class="lead">{c.candidate}</span>
          <span class="detail">
            {#if c.partyHref}<a href={c.partyHref}>{c.party}</a>{:else}{c.party ||
                "Independent"}{/if}
          </span>
        </li>
      {/each}
    </ul>
  {/each}

  <p><a href={data.hubHref}>All {data.stateName} electorates, {data.year} →</a></p>

  <p class="source">
    Candidate lists as declared by the Australian Electoral Commission. Party links show that
    party's recorded parliamentary voting record.
  </p>
</DataPage>
