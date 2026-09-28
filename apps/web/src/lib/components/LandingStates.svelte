<script lang="ts">
  /**
   * Every state of the landing the build would not otherwise render: each election's lede and steps
   * at every stage, each call to action, and both theme labels. Rendered at build time by
   * `routes/states/landing.html` so the iOS app can draw the state that applies from the web's own
   * wording (ADR 0019 D4b). It never reaches a browser as a page.
   */
  import { ELECTION_IDS } from "@how2vote/data-schema";
  import LandingActions from "$lib/components/LandingActions.svelte";
  import LandingIntro from "$lib/components/LandingIntro.svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";

  const PHASES = ["upcoming", "live", "archived"] as const;
</script>

<div class="body">
  {#each ELECTION_IDS as electionId (electionId)}
    {#each PHASES as phase (phase)}
      <LandingIntro {electionId} {phase} part="lede" />
      <LandingIntro {electionId} {phase} part="steps" />
    {/each}
  {/each}
  <LandingActions state="fresh" />
  <LandingActions state="resume" next={2} total={50} />
  <LandingActions state="complete" />
  <div class="theme light"><ThemeToggle dark={false} /></div>
  <div class="theme dark"><ThemeToggle dark={true} /></div>
</div>
