<script lang="ts">
  /**
   * The age gate's explore-only explainer, as `/start` shows it after an under-18 answer: the only
   * state of the gate the build would not otherwise render. Rendered at build time by
   * `routes/states/start.html` for the iOS app (ADR 0019 D4b); it never reaches a browser.
   */
  import AgeGate from "$lib/components/AgeGate.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
</script>

<TopBar label="" onback={() => undefined} />

<AgeGate state="explore" />
