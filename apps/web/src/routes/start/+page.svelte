<script lang="ts">
  /**
   * The age-first eligibility gate (see docs/adr/0011, as amended by docs/adr/0012) — the FIRST interactive
   * step of the quiz/comparison flow. It runs before any quiz state, answer, research consent,
   * integrity token or share capability can exist: the root layout redirects every gated route here
   * until it is answered.
   *
   * It asks a single self-declared eligibility question (18+). It never collects a date of birth, an
   * age band or any age value, and nothing is uploaded. Choosing "under 18" clears any local quiz /
   * saved-card state, then continues in EXPLORE-ONLY mode: the visitor can take the quiz and see how
   * their views compare, but a how-to-vote plan (build / print / share / save) and the research
   * survey stay closed — a comparison is educational; a how-to-vote card is voting material.
   */
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import AgeGate from "$lib/components/AgeGate.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import { ageGate } from "$lib/age.svelte";
  import { continueExploring, declareAdult, declareMinor } from "$lib/age-gate-actions";

  // A returning visitor who already affirmed eligibility never has to declare again — send them
  // straight on to where they were headed (or the start of the ballot flow).
  onMount(() => {
    if (ageGate.confirmed) void goto(ageGate.takeIntended());
  });

  const navigate = (path: string): void => void goto(path);
</script>

<Meta />

<TopBar label="" onback={() => goto("/")} />

<AgeGate
  state={ageGate.minor ? "explore" : "ask"}
  onadult={() => declareAdult(navigate)}
  onminor={declareMinor}
  oncontinue={() => continueExploring(navigate)}
/>
