<script lang="ts">
  // The body lives in $lib/content/CorrectionsContent.svelte so the SAME markup renders here and in
  // the dialog raised by an in-flow policy link (DocDialog). See that file for why.
  import ContentPage from "$lib/components/ContentPage.svelte";
  import CorrectionsContent from "$lib/content/CorrectionsContent.svelte";
  import Meta from "$lib/components/Meta.svelte";
</script>

<!-- Title/description come from the single-source pageMeta entry for /corrections (seo.ts), matching
     every other static content page (methodology, accessibility, …). -->
<Meta />

<ContentPage title="Corrections & methodology changes">
  <CorrectionsContent />
</ContentPage>
