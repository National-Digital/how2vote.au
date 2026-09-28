<script lang="ts">
  /**
   * The plan's acknowledgement, above the ballot the voter numbers: the numbers are theirs, and the
   * candidates are in the ballot paper's order. The card renders it; the build renders it into
   * `states/card.html` for each kind of election, with the year `marked` (ADR 0019 D4b).
   */
  let {
    archived,
    year,
    marked = false,
  }: { archived: boolean; year: number | string; marked?: boolean } = $props();
</script>

{#snippet y()}{#if marked}<data value="year">{year}</data>{:else}{year}{/if}{/snippet}

{#if archived}
  <p>
    <b>These numbers are your choice.</b> How2Vote does not recommend a candidate or a preference
    order — every box starts blank and you decide each number. This is a historical demonstration of
    the {@render y()}
    ballot: the election is over, this is not a ballot paper, and it cannot be used to vote.
  </p>
{:else}
  <p>
    <b>These numbers are your choice.</b> How2Vote does not recommend a candidate or a preference order
    — every box starts blank and you decide each number. A voting plan is not a ballot paper: copy your
    numbers onto the official paper at the polling place and follow the AEC's instructions.
  </p>
{/if}
<p class="ack-order">
  The candidates below are listed in the same order as the official ballot paper — so you can match
  each one box for box. That order is the ballot's, not a ranking by How2Vote.
</p>
