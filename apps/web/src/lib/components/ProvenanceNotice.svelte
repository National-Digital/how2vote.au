<script lang="ts">
  import { provenanceFor } from "$lib/manifest";

  /**
   * The election's data-provenance disclosure, rendered identically wherever party
   * positions are shown — the quiz and the Insights/analysis pages carry the SAME statement and
   * retrieval timestamp (generated in the dataset manifest, so the wording cannot drift). Renders
   * nothing when the election has no committed snapshot.
   */
  let { electionId }: { electionId: string } = $props();

  const provenance = $derived(provenanceFor(electionId));
</script>

{#if provenance}
  <p class="provenance ui" data-basis={provenance.basis}>
    {provenance.statement}
  </p>
{/if}

<style>
  .provenance {
    margin: 0.75rem 0;
    padding: 0.5rem 0.75rem;
    border-inline-start: 2px solid currentColor;
    font-size: 0.85rem;
    line-height: 1.4;
    /* A required legal disclosure — kept clearly legible (not dimmed like an aside). */
    opacity: 0.9;
  }
</style>
