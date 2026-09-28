<script lang="ts">
  /**
   * What the Terms gate asks, and where the Terms are. The gate renders it, and the build renders it
   * into `states/card.html` (ADR 0019 D4b).
   */
  import DocLink from "./DocLink.svelte";
  import { TERMS_GATE_INTRO } from "$lib/terms/terms";
</script>

<!-- Opens over the gate: navigating away to read the terms would discard the pending acceptance and
     leave no route back to it. -->
{TERMS_GATE_INTRO} See our <DocLink href="/terms">Terms of Use</DocLink>.
