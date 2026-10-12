<script lang="ts">
  import { page } from "$app/state";
  import { electionById } from "@how2vote/data-schema";
  import DataPage from "$lib/components/DataPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import StructuredData from "$lib/components/StructuredData.svelte";
  import { electionHome } from "$lib/nav";
  import { SITE_URL, canonicalPath } from "$lib/seo";
  import { ballotPageGraph, ballotPlace, houseBallotList } from "$lib/structured-data";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const home = $derived(electionHome(page.params.election!));
  const crumbs = $derived([
    home,
    { label: "Electorates", href: data.hubHref },
    { label: data.electorate },
  ]);
  const title = $derived(`${data.electorate} candidates — ${data.label}`);
  const ballot = $derived(
    ballotPageGraph({
      name: title,
      url: SITE_URL + canonicalPath(page.url.pathname),
      election: electionById(page.params.election!)!,
      place: ballotPlace(data.stateName, data.electorate),
      list: houseBallotList(data.candidates),
    }),
  );
</script>

<Meta title={data.seo.title} description={data.seo.description} type="article" />
{#if data.candidates.length > 0}<StructuredData node={ballot} />{/if}

<DataPage
  {crumbs}
  {title}
  intro={data.provisional
    ? `The candidates listed so far for the House of Representatives in ${data.electorate}, ${data.stateName}, at the ${data.year} federal election. How2Vote doesn't have the AEC's declared list and ballot order yet.`
    : `Every candidate on the House of Representatives ballot in ${data.electorate}, ${data.stateName}, at the ${data.year} federal election, in ballot-paper order.`}
>
  <ul class="rows">
    {#each data.candidates as c (c.position)}
      <li>
        <span class="lead">{c.candidate}</span>
        <span class="detail">
          {#if c.partyHref}<a href={c.partyHref}>{c.party}</a>{:else}{c.party || "Independent"}{/if}
        </span>
      </li>
    {/each}
  </ul>

  <p>
    <a href={data.senateHref}
      >See the {data.stateName} Senate {data.provisional ? "candidates" : "ballot"} →</a
    >
  </p>
  <p><a href={data.hubHref}>All electorates, {data.year} →</a></p>

  <p class="source">
    Candidate lists as declared by the Australian Electoral Commission. Party links show that
    party's recorded parliamentary voting record. How2Vote is independent and lists every candidate
    in ballot order.
  </p>
</DataPage>
