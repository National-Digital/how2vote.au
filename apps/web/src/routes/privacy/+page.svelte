<script lang="ts">
  // The body lives in $lib/content/PrivacyContent.svelte so the SAME markup renders here and in the
  // dialog raised by a policy link (DocDialog). A copy would drift, and this is the page whose
  // wording is generated from the tested-controls register and cited by the compliance record — the
  // one place where "the dialog says something the page doesn't" would be a real problem.
  import ContentPage from "$lib/components/ContentPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import PrivacyContent from "$lib/content/PrivacyContent.svelte";
</script>

<Meta />

<ContentPage title="Privacy policy">
  <PrivacyContent />
</ContentPage>
