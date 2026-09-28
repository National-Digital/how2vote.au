<script lang="ts">
  /**
   * What the comparison shows, above its panels: for a ballot, or for the parties alone where the
   * election has none yet. The card renders it, and the build renders both into `states/card.html`
   * (ADR 0019 D4b).
   */
  let { electorateLess }: { electorateLess: boolean } = $props();
</script>

{#if electorateLess}
  This shows how often the <b>parties'</b> recorded votes in the current Parliament align with your
  answers — as <b>evidence only</b>. The next election hasn't been announced, so there are no
  candidates or ballot yet; this is a provisional comparison against the parties, not a
  recommendation.
{:else}
  For each chamber, this shows how often the <b>parties'</b> recorded votes align with your answers
  — as <b>evidence only</b>. Nothing here is ranked or recommended: How2Vote does not tell you who
  to put first. When you're ready, you build your own order.
{/if}
