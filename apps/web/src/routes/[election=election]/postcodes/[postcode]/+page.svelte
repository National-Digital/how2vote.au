<script lang="ts">
  import { page } from "$app/state";
  import DataPage from "$lib/components/DataPage.svelte";
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import PostcodeAttribution from "$lib/components/PostcodeAttribution.svelte";
  import { electionHome } from "$lib/nav";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const home = $derived(electionHome(page.params.election!));
  const crumbs = $derived([
    home,
    { label: "Postcodes", href: data.hubHref },
    { label: data.postcode },
  ]);
  const linked = $derived([...data.electorates, ...data.partly].filter((e) => e.href));
</script>

<Meta
  title={data.seo.title}
  description={data.seo.description}
  type="article"
  asAt={data.checkedAt}
/>

<DataPage {crumbs} title="Postcode {data.postcode} — {data.label}" intro={data.intro}>
  {#if data.checkAddress}
    <p class="note">
      Your electorate depends on your street address. Check it with the AEC's
      <ExternalLink href={data.finderUrl}>Find my electorate</ExternalLink> search.
    </p>
  {/if}

  <h2>{data.split ? "Federal electorates" : "Federal electorate"}</h2>
  <ul class="rows">
    {#each data.electorates as e (e.name)}
      <li>
        <span class="lead">{e.name}</span>
        <span class="detail">{e.stateName}</span>
      </li>
    {/each}
  </ul>

  {#if data.split && data.partly.length > 0}
    <p>
      A small part of this postcode may also fall in {data.partlyText}.
    </p>
  {/if}

  {#each linked as e (e.name)}
    <p>
      <a href={e.href}
        >Candidates in {e.name}{e.linkYear ? ` at the ${e.linkYear} election` : ""} →</a
      >
    </p>
  {/each}
  <p><a href={data.hubHref}>All postcodes →</a></p>

  <p class="source">
    Postcodes do not follow electorate boundaries, so this page matches each postcode to the
    Australian Bureau of Statistics' approximation of each electorate. The AEC's
    <ExternalLink href={data.finderUrl}>Find my electorate</ExternalLink> search is the authoritative
    source for any address.
  </p>
  <PostcodeAttribution
    sources={data.sources}
    attribution={data.attribution}
    licenceUrl={data.licenceUrl}
  />
</DataPage>
