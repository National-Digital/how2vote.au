<script lang="ts">
  /**
   * The landing screen, rendered for both the current election (`/`) and each past election
   * (`/2019`, `/2022`). Its content is driven by the `electionId` prop — not the active-election
   * store — so the prerendered HTML for each path is correct for social crawlers and no-JS clients.
   * The question count comes from the tiny manifest (not the ~330 KB dataset), so the home page
   * keeps its lazy-loaded, dataset-free first paint. The layout syncs the store to the page's
   * election, so the quiz and card that follow use it.
   */
  import { goto } from "$app/navigation";
  import ElectionToggle from "$lib/components/ElectionToggle.svelte";
  import LandingActions from "$lib/components/LandingActions.svelte";
  import LandingIntro from "$lib/components/LandingIntro.svelte";
  import Logo from "$lib/components/Logo.svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import { ageGate } from "$lib/age.svelte";
  import { quiz } from "$lib/quiz.svelte";
  import { nativeRoute } from "$lib/native-router.svelte";

  let { electionId }: { electionId: string } = $props();

  const trust = [
    "Built from real parliamentary voting records",
    "Even-handed — the method is public and deterministic",
    "No account, works offline, analytics off by default",
  ];

  const canResume = $derived(
    quiz.hydrated && quiz.hasBallot && quiz.recorded > 0 && !quiz.complete,
  );
  // A finished run leaves a card the visitor can regenerate from their stored answers — surface it
  // on return so it's clear they've already made one, rather than silently offering a fresh start.
  const hasCard = $derived(quiz.hydrated && quiz.hasBallot && quiz.complete && quiz.recorded > 0);

  // The age-first gate is the first interactive step: send a new visitor to /start, and anyone who
  // has already answered it (a confirmed adult, or an under-18 exploring this session) straight on to
  // the ballot. The layout guard is the real enforcement — this just avoids a redirect flash.
  function start(): void {
    // "Start again" (and the fresh-start CTA) must wipe any prior session, or a returner lands
    // mid-quiz with stale answers. Mirrors startFresh() on the card. A no-op for a brand-new visitor.
    quiz.reset();
    goto(ageGate.canExplore ? "/ballot" : "/start");
  }
  function resume(): void {
    goto("/quiz");
  }
  function viewCard(): void {
    goto("/card");
  }
</script>

<!-- A native landing covers this page on iOS (ADR 0018 D1); rendering the web one underneath would
     put a second copy of the first screen behind the one being read. -->
{#if nativeRoute.isWeb}
  <header class="top ui app-top">
    <Logo size="sm" />
    <ThemeToggle />
  </header>

  <div class="body">
    <div class="pick">
      <p class="kicker ui">Federal election</p>
      <ElectionToggle active={electionId} />
    </div>
    <h1>How do your views compare?</h1>
    <LandingIntro {electionId} part="lede" />

    <ul class="trust ui">
      {#each trust as item (item)}
        <li><span class="tick" aria-hidden="true">✓</span>{item}</li>
      {/each}
    </ul>

    <LandingIntro {electionId} part="steps" />

    <LandingActions
      state={canResume ? "resume" : hasCard ? "complete" : "fresh"}
      next={quiz.recorded + 1}
      total={quiz.total}
      onstart={start}
      onresume={resume}
      oncard={viewCard}
    />
  </div>
{/if}

<style>
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    /* Bottom padding matches the other pinned bars: stuck, content scrolling beneath must not
       come right up against the logo/toggle row. */
    padding: 14px var(--gutter) 10px;
  }
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 8px var(--gutter) 20px;
  }
  /* Mobile: stack the eyebrow above the toggle so all four segments fit; inline row from 720px. */
  .pick {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    margin: 6px 0 10px;
  }
  @media (min-width: 720px) {
    .pick {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
  }
  .kicker {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--ink2);
    margin: 0;
  }
  h1 {
    font-size: clamp(27px, 7vw, 32px);
    line-height: 1.14;
  }
  .trust {
    list-style: none;
    padding: 0;
    margin: 22px 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 13.5px;
    color: var(--ink2);
  }
  .trust li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .tick {
    width: 16px;
    height: 16px;
    border: 1.4px solid var(--rule);
    border-radius: 2px;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: var(--ink);
    margin-top: 2px;
  }
</style>
