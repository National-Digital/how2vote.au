<script lang="ts">
  /**
   * The card's persistent historical-use warning, for an election already held. The card renders it
   * for the election compared; the build renders it into `states/card.html` with the election's label
   * and year `marked` as values the iOS app fills (ADR 0019 D4b).
   */
  let {
    label,
    year,
    marked = false,
  }: { label: string; year: number | string; marked?: boolean } = $props();
</script>

{#snippet l()}{#if marked}<data value="label">{label}</data>{:else}{label}{/if}{/snippet}
{#snippet y()}{#if marked}<data value="year">{year}</data>{:else}{year}{/if}{/snippet}

<b>Historical demonstration — {@render l()}.</b> This election has already been held. What you see
and build here is a retrospective demonstration using the {@render y()}
candidates and ballot as they stood then, scored on the parliamentary record of the time. It is not current
and cannot be used to vote.
