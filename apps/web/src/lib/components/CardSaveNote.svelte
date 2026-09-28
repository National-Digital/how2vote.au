<script lang="ts">
  /**
   * What saving a comparison on the device means, before and after it is saved. The card renders it,
   * and the build renders both into `states/card.html` (ADR 0019 D4b).
   */
  let { saved }: { saved: boolean } = $props();
</script>

{#if saved}
  Kept only in this browser, never uploaded.
  <a href="/saved">Your saved comparisons</a>
{:else}
  Kept only in this browser, on this device — never uploaded, and yours to delete any time.
{/if}
