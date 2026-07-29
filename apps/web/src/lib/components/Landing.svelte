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
  import { electionById, electionPhase, isArchivedElection } from "@how2vote/data-schema";
  import ElectionToggle from "$lib/components/ElectionToggle.svelte";
  import Logo from "$lib/components/Logo.svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import { manifestFor } from "$lib/manifest";
  import { ageGate } from "$lib/age.svelte";
  import { quiz } from "$lib/quiz.svelte";

  let { electionId }: { electionId: string } = $props();

  const meta = $derived(electionById(electionId)!);
  const count = $derived(manifestFor(electionId).counts["questions"] ?? 0);
  // Whether this election is archived (a historical demonstration) — from the single AEC-timetable
  // classifier the card uses, never the `current` toggle or a raw date proxy, so the landing and the
  // card can't disagree about liveness. All shipped elections are archived today.
  const isPast = $derived(isArchivedElection(meta));
  // An upcoming election that has not been announced: a PROVISIONAL comparison against the current
  // Parliament's record, with no ballot yet (no electorate to pick, no candidates, no printable plan).
  const isUpcoming = $derived(electionPhase(meta) === "upcoming");
  const electorateLess = $derived((manifestFor(electionId).counts["electorates"] ?? 0) === 0);

  const trust = [
    "Built from real parliamentary voting records",
    "Even-handed — the method is public and deterministic",
    "No account, works offline, analytics off by default",
  ];

  // The step rail adapts to the flow: an electorate-less provisional quiz has no ballot step.
  const steps = $derived(
    electorateLess
      ? [
          { n: "1 · Answer", d: `${count} questions, ~5 min` },
          { n: "2 · Compare", d: "See how you compare" },
        ]
      : [
          { n: "1 · Ballot", d: "Find your electorate" },
          { n: "2 · Answer", d: `${count} questions, ~5 min` },
          { n: "3 · Compare", d: isPast ? "Review the record" : "See how you compare" },
        ],
  );

  // Offer to resume an in-progress quiz (WCAG 3.3.7). Only meaningful after hydration.
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
  <p class="lede">
    {#if isUpcoming}
      Answer {count} real questions the current Parliament has voted on and see how your views compare
      with the parties' recorded votes.{" "}<span class="past"
        >The next federal election hasn't been announced yet, so this is a provisional comparison
        against the current Parliament — the questions may change, and there are no candidates or
        printable how-to-vote plan yet.</span
      >
    {:else}
      Answer {count} real questions parliament has voted on and see how your views compare with the parties'
      recorded votes, for your {meta.year} ballot — House and Senate.{#if isPast}{" "}<span
          class="past"
          >This election has already been held — what follows is a historical comparison, scored on
          the record as it stood then.</span
        >{/if}
    {/if}
  </p>

  <ul class="trust ui">
    {#each trust as item (item)}
      <li><span class="tick" aria-hidden="true">✓</span>{item}</li>
    {/each}
  </ul>

  <ol class="steps ui">
    {#each steps as s (s.n)}
      <li><b>{s.n}</b>{s.d}</li>
    {/each}
  </ol>

  <div class="cta">
    {#if canResume}
      <button type="button" class="btn" onclick={resume}>
        Continue — question {quiz.recorded + 1} of {quiz.total}
      </button>
      <button type="button" class="link" onclick={start}>Start again</button>
    {:else if hasCard}
      <button type="button" class="btn" onclick={viewCard}>See my comparison</button>
      <button type="button" class="link" onclick={start}>Start again</button>
    {:else}
      <button type="button" class="btn" onclick={start}>See how my views compare</button>
      <a class="link" href="/methodology">How the matching works</a>
    {/if}
  </div>
</div>

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
  .past {
    color: var(--ink3);
  }
  h1 {
    font-size: clamp(27px, 7vw, 32px);
    line-height: 1.14;
  }
  .lede {
    font-size: 15px;
    color: var(--ink2);
    line-height: 1.55;
    margin: 14px 0 0;
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
  .steps {
    list-style: none;
    padding: 0;
    display: flex;
    gap: 8px;
    margin: 8px 0 0;
  }
  .steps li {
    flex: 1;
    border-top: 2px solid var(--rule);
    padding-top: 8px;
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--ink2);
  }
  .steps b {
    display: block;
    color: var(--ink);
    font-size: 12px;
    margin-bottom: 2px;
  }
  .cta {
    margin-top: auto;
    padding-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 54px;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-fill);
    font-family: var(--ui);
    font-size: 16px;
    font-weight: 600;
    border: 0;
    cursor: pointer;
    text-decoration: none;
  }
  .link {
    text-align: center;
    font-family: var(--ui);
    font-size: 13.5px;
    color: var(--ink2);
    text-decoration: underline;
    text-underline-offset: 3px;
    background: none;
    border: 0;
    cursor: pointer;
  }
  .link:hover,
  .link:focus-visible {
    color: var(--ink);
  }
</style>
