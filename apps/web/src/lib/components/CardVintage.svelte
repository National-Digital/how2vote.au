<script lang="ts">
  /**
   * The comparison's vintage: the parliamentary record it is scored on, whether it is historical, and
   * any question withdrawn from it. The card renders it; the build renders each case into
   * `states/card.html` with its values `marked` for the iOS app to fill (ADR 0019 D4b).
   */
  import DocLink from "$lib/components/DocLink.svelte";
  import GlossaryTerm from "$lib/components/GlossaryTerm.svelte";

  let {
    vintage,
    archived,
    year,
    withdrawn,
    marked = false,
  }: {
    vintage: string;
    archived: boolean;
    year: number | string;
    withdrawn: number;
    marked?: boolean;
  } = $props();
</script>

{#snippet v()}{#if marked}<data value="vintage">{vintage}</data>{:else}{vintage}{/if}{/snippet}
{#snippet y()}{#if marked}<data value="year">{year}</data>{:else}{year}{/if}{/snippet}
{#snippet n()}{#if marked}<data value="n">{withdrawn}</data>{:else}{withdrawn}{/if}{/snippet}

Compared against parliamentary <GlossaryTerm id="division">divisions</GlossaryTerm> up to {@render v()}.{#if archived}{" "}This
  is a historical comparison for the {@render y()} election, not a current recommendation.{/if}
{#if withdrawn > 0}{" "}{#if withdrawn === 1}One question has been withdrawn pending correction and
    is excluded from this comparison{:else}{@render n()} questions have been withdrawn pending correction
    and are excluded from this comparison{/if}
  <!-- Opens over the comparison: this line explains why a figure on screen is missing, so
       navigating away would remove what it refers to. -->
  — see <DocLink href="/corrections">corrections</DocLink>.{/if}
