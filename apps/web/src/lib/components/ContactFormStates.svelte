<script lang="ts">
  /**
   * The contact form's wording, for the iOS app to draw its form from (ADR 0019 D4b): each piece
   * once, as a section named for it. Rendered at build time by `routes/states/contact-form.html`.
   * It never reaches a browser as a page.
   */
  import { CONTACT_COPY } from "$lib/contact-copy";
</script>

<div class="body">
  {#each Object.entries(CONTACT_COPY) as [key, text] (key)}
    <section class="template" id="contact-{key}"><p>{text}</p></section>
  {/each}
</div>
