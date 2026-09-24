<script lang="ts">
  /**
   * The ballot picker's wording, for the iOS app to draw its picker from (ADR 0019 D4b): each piece
   * once — the page's and the app's own — as a template section named for it, with its values
   * marked by `<data>` and a sample in each; the states the picker offers, in its order; the ballot
   * an election with no electorates records; the lookup link; and the map's licence notice, a
   * section per paragraph, with its link. Rendered at build time by `routes/states/ballot.html`. It
   * never reaches a browser as a page.
   */
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import { AEC_LOOKUP, BALLOT_COPY, PICKER_STATES } from "$lib/ballot-copy";
  import { MAP_LICENCE_NAME, MAP_LICENCE_NOTICE, MAP_LICENCE_URL } from "$lib/mapLicence";
  import { BALLOT_APP_COPY } from "$lib/ballot-copy.app";
  import { NATIONAL_BALLOT } from "$lib/data";
  import { parts } from "$lib/template";

  const SAMPLES: Record<string, string> = {
    step: "1",
    total: "3",
    retry: BALLOT_COPY.retry,
    count: "47",
    code: "NSW",
    state: "New South Wales",
    filter: "Bennelong",
    lookup: BALLOT_COPY.lookup,
    electorate: "Bennelong",
  };
</script>

<div class="body">
  {#each Object.entries({ ...BALLOT_COPY, ...BALLOT_APP_COPY }) as [key, template] (key)}
    <section class="template" id="ballot-{key}">
      <p>
        {#each parts(template) as part, i (i)}{#if "text" in part}{part.text}{:else}<data
              value={part.value}>{SAMPLES[part.value]}</data
            >{/if}{/each}
      </p>
    </section>
  {/each}
  <section class="template" id="ballot-states">
    <dl>
      {#each PICKER_STATES as s (s.code)}<dt>{s.code}</dt>
        <dd>{s.name}</dd>{/each}
    </dl>
  </section>
  <section class="template" id="ballot-national">
    <dl>
      <dt>{NATIONAL_BALLOT.state}</dt>
      <dd>{NATIONAL_BALLOT.electorate}</dd>
    </dl>
  </section>
  <section class="template" id="ballot-lookup-link">
    <p><ExternalLink href={AEC_LOOKUP}>{BALLOT_COPY.lookup}</ExternalLink></p>
  </section>
  {#each MAP_LICENCE_NOTICE as line, i (line)}
    <section class="template" id="ballot-licence-{i + 1}"><p>{line}</p></section>
  {/each}
  <section class="template" id="ballot-licence-link">
    <p><ExternalLink href={MAP_LICENCE_URL}>{MAP_LICENCE_NAME}</ExternalLink></p>
  </section>
</div>
