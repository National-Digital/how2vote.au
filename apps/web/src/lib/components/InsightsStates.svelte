<script lang="ts">
  /**
   * The Insights page's wording, for the iOS app to draw its figures in (ADR 0019 D4b): the page's
   * title and top bar, its lead with the group size marked, and each piece of `INSIGHTS_COPY` once
   * as a template section named for it, its values marked by `<data>` with a sample in each.
   * Rendered at build time by `routes/states/insights.html`. It never reaches a browser as a page.
   */
  import { goto } from "$app/navigation";
  import InsightsLead from "$lib/components/InsightsLead.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import { DEFAULT_MIN_CELL } from "$lib/insights";
  import { INSIGHTS_COPY } from "$lib/insights-copy";
  import { parts } from "$lib/template";

  const SAMPLES: Record<string, string> = {
    election: "2025 Federal Election",
    date: "16 Jul 2026",
    count: "120",
    label: "Coalition",
    pct: "40",
    shown: "120",
    agree: "50",
    neutral: "20",
    disagree: "30",
    time: INSIGHTS_COPY.closedTime,
  };
</script>

<TopBar label={INSIGHTS_COPY.top} onback={() => goto("/")} backLabel={INSIGHTS_COPY.back} />

<article class="insights">
  <h1>{INSIGHTS_COPY.title}</h1>
  <section class="template" id="insights-lead">
    <InsightsLead min={DEFAULT_MIN_CELL} marked />
  </section>
  {#each Object.entries(INSIGHTS_COPY) as [key, template] (key)}
    <section class="template" id="insights-{key}">
      <p>
        {#each parts(template) as part, i (i)}{#if "text" in part}{part.text}{:else}<data
              value={part.value}>{SAMPLES[part.value]}</data
            >{/if}{/each}
      </p>
    </section>
  {/each}
</article>
