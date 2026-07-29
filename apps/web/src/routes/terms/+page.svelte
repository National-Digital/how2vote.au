<script lang="ts">
  // The body lives in $lib/content/TermsContent.svelte so the SAME markup renders here and in the
  // dialog raised by the Terms gate's link. The wording is version-bound to the acceptance store
  // and the terms hash registry (docs/legal/terms-registry.json, scripts/check-terms.mjs), so the
  // text a reader is asked to accept exists exactly once.
  import ContentPage from "$lib/components/ContentPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import TermsContent from "$lib/content/TermsContent.svelte";
</script>

<Meta />

<ContentPage title="Terms of use">
  <TermsContent />
</ContentPage>
