<script lang="ts">
  /**
   * The saved-cards screen's wording, for the iOS app to draw it from (ADR 0019 D4b): each piece
   * once, as a template section named for it, with its values marked by `<data>` and a sample in
   * each; then the clear-all-data control the screen ends with, as the page renders it. Rendered at
   * build time by `routes/states/saved.html`. It never reaches a browser as a page.
   */
  import ClearMyData from "$lib/components/ClearMyData.svelte";
  import { SAVED_COPY } from "$lib/saved-copy";
  import { parts } from "$lib/template";

  const SAMPLES: Record<string, string> = {
    action: SAVED_COPY.action,
    state: "New South Wales",
    date: "1 Jan 2026",
    electorate: "Sydney",
    count: "2",
  };
</script>

<div class="body">
  {#each Object.entries(SAVED_COPY) as [key, template] (key)}
    <section class="template" id="saved-{key}">
      <p>
        {#each parts(template) as part, i (i)}{#if "text" in part}{part.text}{:else}<data
              value={part.value}>{SAMPLES[part.value]}</data
            >{/if}{/each}
      </p>
    </section>
  {/each}
  <ClearMyData />
</div>
