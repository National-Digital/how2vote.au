<script lang="ts">
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import GlossaryTerm from "$lib/components/GlossaryTerm.svelte";
  import { page } from "$app/state";
  import DataPage from "$lib/components/DataPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import StructuredData from "$lib/components/StructuredData.svelte";
  import { electionHome } from "$lib/nav";
  import { faqGraph } from "$lib/structured-data";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const home = $derived(electionHome(page.params.election!));
  const crumbs = $derived([
    home,
    { label: "Where parties stand", href: data.hubHref },
    { label: data.text.length > 40 ? data.text.slice(0, 40).trimEnd() + "…" : data.text },
  ]);
  const active = $derived(data.bands.filter((b) => b.parties.length > 0));
</script>

<Meta title={data.seo.title} description={data.seo.description} type="article" />
<StructuredData node={faqGraph(data.faqs)} />

<DataPage {crumbs} title={data.text}>
  <p class="intro">
    How every party and independent with a parliamentary record is scored on this proposition for
    the {data.year} federal election, on the same 1–5 scale How2Vote uses.
  </p>

  {#each active as band (band.position)}
    <h2>{band.stance}</h2>
    <ul class="cols">
      {#each band.parties as p (p.href)}
        <li><a href={p.href}>{p.name}</a></li>
      {/each}
    </ul>
  {/each}

  <p class="source">
    {#if data.divisionCount}Based on {data.divisionCount} parliamentary division{data.divisionCount ===
      1
        ? ""
        : "s"}.
    {/if}
    See the <GlossaryTerm id="division">divisions</GlossaryTerm> behind this on
    <ExternalLink href={data.tvfy}>They Vote For You</ExternalLink>. Positions are the recorded
    voting record; How2Vote takes no side on any proposition.
  </p>
</DataPage>
