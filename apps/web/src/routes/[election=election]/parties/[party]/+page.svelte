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
    { label: "Party voting records", href: data.hubHref },
    { label: data.name },
  ]);
  const noun = $derived(data.independent ? "This independent is" : "This party is");
</script>

<Meta title={data.seo.title} description={data.seo.description} type="article" />

<DataPage
  {crumbs}
  title="{data.name} — voting record"
  intro="How {data.name} is recorded voting in federal parliament across the {data.rows
    .length} propositions scored for the {data.year} election."
>
  {#if data.merge}
    <p class="note">
      {#if data.merge.role === "absorbs"}For scoring, this record combines {data.name} with
      {:else}For scoring, {data.name} is combined with{/if}
      {#each data.merge.with as w, i (w.name)}{#if i > 0}{i === data.merge.with.length - 1
            ? " and "
            : ", "}{/if}{#if w.href}<a href={w.href}>{w.name}</a>{:else}{w.name}{/if}{/each},
      treated as one continuous party (see <a href="/methodology">methodology</a>).
    </p>
  {/if}

  {#if data.aliases.length > 0}
    <p class="note">
      This record consolidates the parliamentary voting record of {data.name} across the AEC-registered
      names and branches it appears under:
      {#each data.aliases as a, i (a)}{#if i > 0}{i === data.aliases.length - 1
            ? " and "
            : ", "}{/if}{a}{/each}.
    </p>
  {/if}

  <ul class="rows">
    {#each data.rows as r (r.href)}
      <li>
        <a class="lead" href={r.href}>{r.text}</a>
        <span class="meta"
          >{r.stance} · <a href={r.tvfy} target="_blank" rel="noopener noreferrer">record</a></span
        >
      </li>
    {/each}
  </ul>

  <p class="source">
    {noun} scored on its recorded parliamentary votes, sourced from They Vote For You, not on its campaign
    statements. Each row links to the <a href="/glossary#division">divisions</a> behind it. See
    <a href="/methodology">how the scoring works</a> and
    <a href={data.hubHref}>all parties, {data.year}</a>.
  </p>
</DataPage>
