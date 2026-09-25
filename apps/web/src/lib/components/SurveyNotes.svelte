<script lang="ts">
  /**
   * The research opt-in's collection notice: what is collected, how it is stored, and where the full
   * detail is. The survey page renders it for the election compared; the build renders it into
   * `states/survey.html` for each kind of election, with the year `marked` as a value the iOS app
   * fills (ADR 0019 D4b).
   */
  import DocLink from "$lib/components/DocLink.svelte";

  let {
    archived,
    year,
    marked = false,
  }: { archived: boolean; year: number | string; marked?: boolean } = $props();
</script>

{#snippet y()}{#if marked}<data value="year">{year}</data>{:else}{year}{/if}{/snippet}

{#if archived}
  <p class="note ui">
    You are completing a comparison based on the {@render y()} federal election and the parliamentary
    voting record available at that time. Any answers you contribute will be recorded as views expressed
    <strong>today</strong>, not as views expressed during the
    {@render y()} election, and are analysed separately from responses collected around that election.
  </p>
  <p class="note ui">
    If you opt in, your device works out your closest party match and whether you agreed or
    disagreed with each proposition; National Digital collects only those results, your state or
    territory, the election being compared and the period you contributed, the data and app
    versions, and any optional survey answers you choose to give. The survey may include sensitive
    information such as political opinions, union membership, Indigenous origin, religion and sexual
    orientation. Your individual quiz answers and weights never leave your device. Everything
    collected is stored only as additions to aggregate counts — group tallies, not individual
    records — so a particular contribution cannot later be located or deleted. We publish only
    privacy-protected aggregates, do
    <strong>not</strong> collect your preference order, and no direct identifiers are collected.
    Full detail is in the
    <!-- Opens over the gate rather than navigating: leaving the survey starts it afresh, which
         discards the decision being collected. -->
    <DocLink href="/privacy">Privacy policy</DocLink>.
  </p>
{:else}
  <p class="note ui">
    Your result and voting plan are already complete — you can use them without contributing
    anything. If you opt in, your device works out your closest party match and whether you agreed
    or disagreed with each proposition; National Digital collects only those results, your state or
    territory, the election being compared and the period you contributed, the data and app
    versions, and any optional survey answers you choose to give. The survey may include sensitive
    information such as political opinions, union membership, Indigenous origin, religion and sexual
    orientation. Your individual quiz answers and weights never leave your device.
  </p>
  <p class="note ui">
    Everything collected is stored only as additions to aggregate counts — group tallies, not
    individual records. No per-person research record is created or stored, which also means a
    particular contribution cannot later be located or deleted. We do
    <strong>not</strong> collect your preference order, and no direct identifiers are collected. We
    publish only privacy-protected aggregates. Full detail is in the
    <DocLink href="/privacy">Privacy policy</DocLink>.
  </p>
{/if}

<style>
  .note {
    font-size: 13.5px;
    color: var(--ink2);
    line-height: 1.55;
    margin: 0 0 12px;
  }
  /* :global because the anchor belongs to DocLink — Svelte's scoping class is not applied across a
     component boundary, so a bare descendant selector would silently stop matching. */
  .note :global(a) {
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
