<script lang="ts">
  /**
   * The Insights page's lead: what the figures are, and the group size below which one is withheld.
   * The page renders it with the selected election's size; the build renders it into
   * `states/insights.html` with the size `marked` as a value the iOS app fills (ADR 0019 D4b).
   */
  let { min, marked = false }: { min: number; marked?: boolean } = $props();
</script>

<p class="lead">
  These figures come from the optional survey people answer after building a comparison. Everything
  here is aggregate only, and descriptive — never a prediction. A figure is shown only when its
  group is large enough that a single response cannot be singled out (at least {#if marked}<data
      value="min">{min}</data
    >{:else}{min}{/if} responses); smaller groups are withheld entirely. You can filter by when responses
  were collected, and groups are never combined across those periods without saying so. See
  <a href="/research">how these figures are made</a> and
  <a href="/privacy">how we handle survey data</a>.
</p>

<style>
  .lead {
    color: var(--ink2);
    margin: 0 0 8px;
  }
  .lead a {
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
