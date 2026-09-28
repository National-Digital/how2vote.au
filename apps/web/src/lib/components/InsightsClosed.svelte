<script lang="ts">
  // Shown in place of the survey aggregates on the Insights page during the election-day window
  // (00:00 until the last national poll close, 8 pm AEST). See `insightsClosed` in $lib/insights and
  // docs/adr/0014-election-day-notice.md. Purely informational and self-clearing — the page swaps
  // back to the analysis once polls have closed, so there is nothing to dismiss.
  import { INSIGHTS_COPY } from "$lib/insights-copy";
  import { around } from "$lib/template";

  const [before, after] = around(INSIGHTS_COPY.closed);
</script>

<div class="closed ui" role="status">
  <h2>{INSIGHTS_COPY.closedTitle}</h2>
  <p>{before}<strong>{INSIGHTS_COPY.closedTime}</strong>{after}</p>
</div>

<style>
  .closed {
    margin: 20px 0;
    padding: 20px 18px;
    border: 1.5px solid var(--rule);
    border-radius: var(--radius);
    background: var(--fill2, transparent);
    color: var(--ink);
    line-height: 1.55;
  }
  h2 {
    font-size: 16px;
    font-weight: 700;
    margin: 0 0 6px;
  }
  p {
    margin: 0;
    font-size: 13.5px;
    color: var(--ink2);
  }
</style>
