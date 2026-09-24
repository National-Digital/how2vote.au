<script lang="ts">
  /**
   * The age-first eligibility gate's two states (ADR 0011, as amended by ADR 0012): the question, and
   * the explore-only explainer an under-18 sees after answering. `/start` renders whichever applies;
   * `AgeGateStates.svelte` renders the explainer at build time, so the build holds both — which is
   * what the iOS app draws its native gate from. Each answer names its action (`value`), so the
   * native gate acts on what a button does, never on where it sits.
   */
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import Logo from "$lib/components/Logo.svelte";
  import { CIVIC_LINKS, RESEARCH_MIN_AGE } from "$lib/org";

  let {
    state,
    onadult = () => undefined,
    onminor = () => undefined,
    oncontinue = () => undefined,
  }: {
    state: "ask" | "explore";
    onadult?: () => void;
    onminor?: () => void;
    oncontinue?: () => void;
  } = $props();
</script>

<div class="body">
  {#if state === "explore"}
    <div class="gate" role="status">
      <Logo size="sm" />
      <h1>You can still see how your views compare</h1>
      <p class="note ui">
        Thanks for letting us know. Because you're under {RESEARCH_MIN_AGE}, How2Vote won't build
        you a how-to-vote plan — a how-to-vote card is material for casting a vote, and only people
        enrolled to vote can do that. But you can still take the quiz and see how your views line up
        with the parties' recorded votes. Nothing is saved or sent.
      </p>
      <div class="cta explore">
        <button type="button" class="btn" value="continue" onclick={oncontinue}>
          Continue to the quiz
        </button>
      </div>
      <p class="note ui spaced">Not old enough to vote yet? There's still plenty you can do:</p>
      <ul class="links ui">
        <li>
          <ExternalLink href={CIVIC_LINKS.enrol}>Enrol early with the AEC</ExternalLink>
          — at 16 or 17 you can provisionally enrol, so you're ready to vote the day you turn {RESEARCH_MIN_AGE}.
        </li>
        <li>
          <ExternalLink href={CIVIC_LINKS.findMember}>
            Find and contact your local member
          </ExternalLink>
          — tell the person who represents your area what matters to you.
        </li>
        <li>
          <ExternalLink href={CIVIC_LINKS.votingRecord}>See how Parliament votes</ExternalLink>
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
      <div class="cta declare">
        <button type="button" class="btn" value="adult" onclick={onadult}>
          Yes, I'm {RESEARCH_MIN_AGE} or older — continue
        </button>
        <button type="button" class="btn secondary" value="minor" onclick={onminor}>
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
  .spaced {
    margin-top: 20px;
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
