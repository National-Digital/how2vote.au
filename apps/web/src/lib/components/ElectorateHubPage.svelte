<script lang="ts">
  /**
   * The electorate list for one election, worded for `stage`. The route renders it for the stage
   * now; the build also renders it for every stage (`routes/states/electorates`), which the iOS app
   * draws for the stage now.
   */
  import DataPage from "./DataPage.svelte";
  import ElectionToggle from "./ElectionToggle.svelte";
  import type { ElectorateHub } from "$lib/content.server";
  import type { Stage } from "$lib/election-stage";
  import { electionHome } from "$lib/nav";
  import { electorateHubCopy } from "$lib/stage-copy";

  let {
    data,
    election,
    stage,
  }: { data: ElectorateHub & { postcodesHref?: string }; election: string; stage: Stage } =
    $props();
  const home = $derived(electionHome(election));
  const crumbs = $derived([home, { label: "Electorates" }]);
  const noBallot = $derived(data.states.length === 0);
  const copy = $derived(
    electorateHubCopy(stage, { count: data.count, label: data.label, year: data.year }),
  );
</script>

<DataPage {crumbs} title="Electorates & candidates — {data.label}" intro={copy.intro}>
  <div class="switch"><ElectionToggle active={election} section="electorates" /></div>

  {#if data.postcodesHref}
    <p><a href={data.postcodesHref}>Find your electorate by postcode →</a></p>
  {/if}

  {#if copy.awaitsNominations}
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
      <p><a href={s.senateHref}>{s.name} {copy.senateLink} →</a></p>
    {/each}
  {/if}
</DataPage>
