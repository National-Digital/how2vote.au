<script lang="ts">
  import { goto } from "$app/navigation";
  import Meta from "$lib/components/Meta.svelte";
  import Progress from "$lib/components/Progress.svelte";
  import SurveyNotes from "$lib/components/SurveyNotes.svelte";
  import SurveyTermsLabel from "$lib/components/SurveyTermsLabel.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import { election } from "$lib/election.svelte";
  import { RESEARCH_MIN_AGE } from "$lib/org";
  import { quiz } from "$lib/quiz.svelte";
  import { SURVEY_COPY } from "$lib/survey-copy";
  import { survey } from "$lib/survey-flow.svelte";
  import { fill } from "$lib/template";
  import { termsAcceptance } from "$lib/terms.svelte";

  // Every entry to the survey starts it afresh. Its state lives in `$lib/survey-flow` so that the
  // iOS app, which draws it natively, takes the same steps (ADR 0019 D4j).
  survey.reset();

  const current = $derived(survey.current);
  const navigate = (path: string) => void goto(path);
  const back = () => survey.back(navigate);
  const choose = (key: string, value: string) => survey.choose(key, value, navigate);

  // Skip research entirely and go straight to the plan. Uploads NOTHING.
  function skip(): void {
    goto("/card");
  }

  // Wait for the store to hydrate (root layout $effect) before acting on it, so a hard refresh on
  // this screen doesn't bounce a mid-flow visitor to /ballot before their ballot is restored. The
  // optional research contribution is offered on every channel: native shells POST to the
  // canonical origin (survey.ts) via the endpoints' strict CORS allowlist.
  $effect(() => {
    if (quiz.hydrated && !quiz.hasBallot) goto("/ballot");
  });

  // Read any prior Terms acceptance so a returning user who already accepted the current version is
  // not asked to re-tick. Browser-only (the store no-ops on the server).
  $effect(() => {
    if (!termsAcceptance.ready) termsAcceptance.hydrate();
  });
</script>

<Meta />

<TopBar label="" onback={back} />
{#if survey.step >= 0}
  <Progress value={survey.position} max={survey.visible.length} label={SURVEY_COPY.progress} />
{/if}

<div class="body">
  {#if survey.step === -1}
    <div class="gate">
      <p class="ready ui">{SURVEY_COPY.ready}</p>
      {#if survey.isArchived}
        <h1>{SURVEY_COPY.archivedTitle}</h1>
        <SurveyNotes archived year={election.meta.year} />
        <label class="consent ui">
          <input type="checkbox" bind:checked={survey.consented} />
          <span>{fill(SURVEY_COPY.archivedConsent, { age: RESEARCH_MIN_AGE })}</span>
        </label>
      {:else}
        <h1>{SURVEY_COPY.liveTitle}</h1>
        <SurveyNotes archived={false} year={election.meta.year} />
        <label class="consent ui">
          <input type="checkbox" bind:checked={survey.consented} />
          <span>{fill(SURVEY_COPY.liveConsent, { age: RESEARCH_MIN_AGE })}</span>
        </label>
      {/if}
      <!-- SEPARATE, independent consent for the particularly-sensitive categories. Never bundled into
           the general research consent above, and NOT required to contribute (it does not gate the
           "Contribute" button). Left unticked, those questions are not asked and their fields are
           omitted from the upload. -->
      <label class="consent ui">
        <input type="checkbox" bind:checked={survey.sensitiveConsented} />
        <span>{SURVEY_COPY.sensitiveConsent}</span>
      </label>
      {#if !termsAcceptance.accepted}
        <!-- Versioned Terms-of-Use acceptance, separate from the research consent above.
             Contributing is a consequential action, so it requires an active acceptance of the
             current Terms; recorded (version + timestamp) when you contribute. -->
        <label class="consent ui">
          <input type="checkbox" bind:checked={survey.termsChecked} />
          <span><SurveyTermsLabel /></span>
        </label>
      {/if}
      <div class="cta">
        <button
          type="button"
          class="btn"
          disabled={!survey.canContribute}
          onclick={() => survey.contribute()}
        >
          {SURVEY_COPY.contribute}
        </button>
        <button type="button" class="btn secondary" onclick={skip}>
          {survey.inFlight ? SURVEY_COPY.skipPlan : SURVEY_COPY.skipComparison}
        </button>
      </div>
    </div>
  {:else if current}
    <h1 class="qh">{current.label}</h1>
    <!-- Always rendered (empty when there's no note) so its line is reserved and the chips below
         never jump between questions that do and don't carry a helper line. -->
    <p class="scale-note ui">{current.note ?? ""}</p>
    <div class="chips">
      {#each current.options as opt (opt)}
        <button type="button" class="chip" onclick={() => choose(current.key, opt)}>{opt}</button>
      {/each}
    </div>
    <button type="button" class="prefer ui" onclick={() => choose(current.key, "")}>
      {SURVEY_COPY.prefer}
    </button>
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
  .ready {
    font-size: 12px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink2);
  }
  h1 {
    font-size: 26px;
    margin: 10px 0;
  }
  /* Reserve two lines for the question so the answer chips sit in the same place on every
     step (no layout shift between one- and two-line labels). */
  .qh {
    margin-top: 6px;
    min-height: 2.3em;
  }
  /* Always reserves a line, even when empty, so questions with and without a helper note keep the
     chips in the same place. */
  .scale-note {
    margin: 2px 0 0;
    min-height: 1.2em;
    font-size: 13px;
    color: var(--ink2);
  }
  .consent {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 6px 0 4px;
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--ink);
  }
  .consent input {
    margin-top: 3px;
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
    accent-color: var(--ink);
  }
  .cta {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 20px;
  }
  /* Two equally-weighted actions: contributing requires consent (disabled until ticked); skipping
     is never gated or diminished. Same size, so opting out is as easy as opting in. */
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 52px;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-fill);
    font-family: var(--ui);
    font-size: 15.5px;
    font-weight: 600;
    border: 1.5px solid var(--ink);
    cursor: pointer;
    text-align: center;
    padding: 6px 14px;
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .btn.secondary {
    background: transparent;
    color: var(--ink);
    border-color: var(--rule);
  }
  /* Reserve room for the tallest set of options (the longest wrapping list) so the card doesn't
     resize between questions and "Prefer not to say" — pinned to the bottom below — never moves.
     align-content keeps a short set anchored to the top of that reserved band. */
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 8px;
    margin-top: 14px;
    min-height: var(--chips-reserve, 264px);
  }
  .chip {
    border: 1.5px solid var(--rule);
    border-radius: 20px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    padding: 6px 16px;
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
    background: var(--raise);
    font-family: var(--ui);
    cursor: pointer;
  }
  .prefer {
    margin-top: auto;
    align-self: flex-start;
    padding-top: 18px;
    background: none;
    border: 0;
    color: var(--ink2);
    font-size: 13px;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
</style>
