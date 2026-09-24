<script lang="ts">
  /**
   * The "clear all my data" control's confirmation, for the iOS app to draw it from (ADR 0019 D4b):
   * each piece once, as a section named for it. Rendered at build time by
   * `routes/states/clear-data.html`. It never reaches a browser as a page.
   */
  import { CLEAR_DATA_COPY } from "$lib/clear-data-copy";
</script>

<div class="body">
  {#each Object.entries(CLEAR_DATA_COPY) as [key, text] (key)}
    <section class="template" id="clear-{key}"><p>{text}</p></section>
  {/each}
</div>
