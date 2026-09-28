<script lang="ts">
  /**
   * What the party alignment panel's figures are, and what their order means. The panel renders it,
   * and the build renders both orders into `states/card.html` (ADR 0019 D4b).
   */
  let { ballotOrdered }: { ballotOrdered: boolean } = $props();
</script>

<b>Party voting record — not the candidate's personal position.</b> Each figure is how often a
party's recorded parliamentary votes align with your answers, as evidence only. Parties are listed {ballotOrdered
  ? "in the order they appear on the ballot paper"
  : "in registration order, with any registered family shown together"}, <b>not</b> ranked by alignment
— nothing here is ranked or recommended.
