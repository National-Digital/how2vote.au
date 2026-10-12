<script lang="ts">
  /**
   * What the comparison shows, above its panels, worded for the election's stage. The card renders
   * it, and the build renders the ballot and unannounced cases into `states/card.html` (ADR 0019
   * D4b).
   */
  import type { Stage } from "$lib/election-stage";
  import { cardHint } from "$lib/stage-copy";

  let { stage, electorateLess }: { stage: Stage; electorateLess: boolean } = $props();
  const runs = $derived(cardHint(stage, electorateLess));
</script>

{#each runs as run, i (i)}{#if run.bold}<b>{run.text}</b>{:else}{run.text}{/if}{/each}
