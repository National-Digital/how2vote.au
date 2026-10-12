<script lang="ts">
  import { page } from "$app/state";
  import DataPage from "$lib/components/DataPage.svelte";
  import ElectionToggle from "$lib/components/ElectionToggle.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import { electionHome } from "$lib/nav";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const home = $derived(electionHome(page.params.election!));
  const crumbs = $derived([home, { label: "Electorates" }]);
  const noBallot = $derived(data.states.length === 0);
</script>

<Meta title={data.seo.title} description={data.seo.description} type="article" />

<DataPage {crumbs} title="Electorates & candidates — {data.label}" intro={data.intro}>
  <div class="switch"><ElectionToggle active={page.params.election!} section="electorates" /></div>

  {#if data.postcodesHref}
    <p><a href={data.postcodesHref}>Find your electorate by postcode →</a></p>
  {/if}

  {#if data.awaitsNominations}
    <p class="note">
      Once the AEC declares nominations, every candidate will be listed here in ballot-paper order.
      For now, you can <a href="/">compare your views with the parties' voting records</a>.
    </p>
  {:else if !noBallot}
    {#each data.states as s (s.code)}
      <h2>{s.name}</h2>
      <p>{s.summary}</p>
      <ul class="cols">
        {#each s.electorates as e (e.href)}
          <li><a href={e.href}>{e.name}</a></li>
        {/each}
      </ul>
      <p><a href={s.senateHref}>{s.name} {data.senateLink} →</a></p>
    {/each}
  {/if}
</DataPage>
