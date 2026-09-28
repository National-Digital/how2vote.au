<script lang="ts">
  /**
   * The contact page as the iOS app draws it (ADR 0019 D4b): the page's text above its form, under
   * the page's own title and top bar. The app draws the form itself, from `states/contact-form`.
   * Rendered at build time by `routes/states/contact.html`. It never reaches a browser as a page.
   */
  import ContactIntro from "$lib/components/ContactIntro.svelte";
  import ContentPage from "$lib/components/ContentPage.svelte";
  import { CONTACT_TITLE } from "$lib/contact-copy";
</script>

<ContentPage title={CONTACT_TITLE}>
  <ContactIntro />
</ContentPage>
