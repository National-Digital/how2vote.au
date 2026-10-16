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
  const crumbs = $derived([home, { label: "Postcodes" }]);
</script>

<Meta
  title={data.seo.title}
  description={data.seo.description}
  type="article"
  asAt={data.checkedAt}
/>

<DataPage
  {crumbs}
  title="Federal electorates by postcode — {data.label}"
  intro="Choose a postcode to see the federal electorate or electorates it falls in. This applies to {data.appliesTo}. Postcodes are grouped by the state of the electorate they fall in."
>
  <p class="note">
    Postcodes do not follow electorate boundaries, and some span more than one electorate. The AEC's
    <ExternalLink href={data.finderUrl}>Find my electorate</ExternalLink> search is the authoritative
    source for any address.
  </p>

  {#if data.notListed}
    <p>{data.notListed}</p>
  {/if}

  {#each data.states as s (s.code)}
    <h2>{s.name}</h2>
    <ul class="cols">
      {#each s.postcodes as p (p.href)}
        <li><a href={p.href}>{p.postcode}</a></li>
      {/each}
    </ul>
  {/each}

  <PostcodeAttribution
    sources={data.sources}
    attribution={data.attribution}
    licenceUrl={data.licenceUrl}
  />
</DataPage>
