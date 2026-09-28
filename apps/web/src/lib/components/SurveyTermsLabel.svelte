<script lang="ts">
  /**
   * The survey's Terms-of-Use acceptance, as its checkbox is labelled. The survey page renders it,
   * and the build renders it into `states/survey.html` for the iOS app (ADR 0019 D4b).
   */
  import DocLink from "$lib/components/DocLink.svelte";
  import { TERMS_ACCEPTANCE_LABEL } from "$lib/terms/terms";
</script>

{TERMS_ACCEPTANCE_LABEL} See our <DocLink href="/terms">Terms of Use</DocLink>.
