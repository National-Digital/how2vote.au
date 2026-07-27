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
  import Logo from "$lib/components/Logo.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import { ageGate } from "$lib/age.svelte";
  import { CIVIC_LINKS, RESEARCH_MIN_AGE } from "$lib/org";

  // A returning visitor who already affirmed eligibility never has to declare again — send them
  // straight on to where they were headed (or the start of the ballot flow).
  onMount(() => {
    if (ageGate.confirmed) void goto(ageGate.takeIntended());
  });

  function confirmAdult(): void {
    ageGate.confirmAdult();
    void goto(ageGate.takeIntended());
  }

  // Record the under-18 declaration in memory only (never persisted, never uploaded) and clear any
  // local quiz/saved state left by a prior session. This does NOT navigate: it flips the view to the
  // explore-mode explainer below, so the visitor sees up front what they can and can't do before the
  // quiz begins.
  function chooseExplore(): void {
    ageGate.declareMinor();
  }

  // Continue into the quiz in explore-only mode. declareMinor() reset the intended destination, so
  // this always starts a fresh comparison at the ballot picker.
  function continueExploring(): void {
    void goto(ageGate.takeIntended());
  }

  function back(): void {
    goto("/");
  }
</script>

<Meta />

<TopBar label="" onback={back} />

<div class="body">
  {#if ageGate.minor}
    <div class="gate" role="status">
      <Logo size="sm" />
      <h1>You can still see how your views compare</h1>
      <p class="note ui">
        Thanks for letting us know. Because you're under {RESEARCH_MIN_AGE}, How2Vote won't build
        you a how-to-vote plan — a how-to-vote card is material for casting a vote, and only people
        enrolled to vote can do that. But you can still take the quiz and see how your views line up
        with the parties' recorded votes. Nothing is saved or sent.
      </p>
      <div class="cta">
        <button type="button" class="btn" onclick={continueExploring}>
          Continue to the quiz
        </button>
      </div>
      <p class="note ui" style="margin-top:20px">
        Not old enough to vote yet? There's still plenty you can do:
      </p>
      <ul class="links ui">
        <li>
          <a href={CIVIC_LINKS.enrol} target="_blank" rel="noopener noreferrer">
            Enrol early with the AEC ↗
          </a>
          — at 16 or 17 you can provisionally enrol, so you're ready to vote the day you turn {RESEARCH_MIN_AGE}.
        </li>
        <li>
          <a href={CIVIC_LINKS.findMember} target="_blank" rel="noopener noreferrer">
            Find and contact your local member ↗
          </a>
          — tell the person who represents your area what matters to you.
        </li>
        <li>
          <a href={CIVIC_LINKS.votingRecord} target="_blank" rel="noopener noreferrer">
            See how Parliament votes ↗
          </a>
          — the records behind this quiz, on They Vote For You.
        </li>
        <li><a href="/">Back to the home page</a></li>
      </ul>
    </div>
  {:else}
    <div class="gate">
      <p class="kicker ui">Before you start</p>
      <h1>Are you {RESEARCH_MIN_AGE} or older?</h1>
      <p class="note ui">
        How2Vote builds a voting comparison and a how-to-vote plan for a federal election. Anyone
        can see how their views compare, but a how-to-vote plan is for people who are {RESEARCH_MIN_AGE}
        or over and can vote. This is the first step — nothing is created, saved or sent until you answer.
      </p>
      <p class="note ui">
        We only ask whether you're eligible. We never ask for your date of birth or age, and your
        answer to this question is never uploaded.
      </p>
      <div class="cta">
        <button type="button" class="btn" onclick={confirmAdult}>
          Yes, I'm {RESEARCH_MIN_AGE} or older — continue
        </button>
        <button type="button" class="btn secondary" onclick={chooseExplore}>
          No, I'm under {RESEARCH_MIN_AGE}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 12px var(--gutter) 20px;
  }
  .gate {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .kicker {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--ink2);
    margin: 0 0 6px;
  }
  h1 {
    font-size: 26px;
    margin: 8px 0 10px;
  }
  .note {
    font-size: 14px;
    color: var(--ink2);
    line-height: 1.55;
    margin: 0 0 12px;
  }
  .links {
    list-style: none;
    padding: 0;
    margin: 4px 0 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .links a {
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
    font-size: 15px;
  }
  .cta {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 20px;
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
    border: 1.5px solid var(--ink);
    cursor: pointer;
    text-align: center;
    padding: 6px 14px;
  }
  .btn.secondary {
    background: transparent;
    color: var(--ink);
    border-color: var(--rule);
  }
</style>
