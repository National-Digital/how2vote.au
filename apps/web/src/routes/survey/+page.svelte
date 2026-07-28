<script lang="ts">
  import { version } from "$app/environment";
  import { goto } from "$app/navigation";
  import { activeQuestions, electionPhase } from "@how2vote/data-schema";
  import { topPartyMatch } from "@how2vote/engine";
  import DocLink from "$lib/components/DocLink.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import Progress from "$lib/components/Progress.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import { loadData } from "$lib/data";
  import { election } from "$lib/election.svelte";
  import { manifestFor } from "$lib/manifest";
  import { RESEARCH_MIN_AGE } from "$lib/org";
  import { quiz } from "$lib/quiz.svelte";
  import { suspendedPropositionIds } from "$lib/governance";
  import { termsAcceptance } from "$lib/terms.svelte";
  import { TERMS_ACCEPTANCE_LABEL } from "$lib/terms/terms";
  import {
    RESEARCH_CONSENT_VERSION,
    requestResearchToken,
    stanceOf,
    submitGeography,
    submitResearch,
    surveyFor,
    type Stance,
  } from "$lib/survey";
  import { solveChallenge } from "$lib/altcha";

  // -1 = the research opt-in gate; 0..n-1 = the optional demographic questions (index into the full
  // question set). The gate is reached only AFTER the comparison result exists; nothing about it
  // changes the result. NOTHING is ever uploaded unless the visitor ticks consent and contributes.
  let step = $state<number>(-1);
  let demographics = $state<Record<string, string>>({});
  // Express, specific opt-in: unticked by default, confirming 18+ AND consent to collection of the
  // NON-sensitive items. The "Contribute" action is inert until this is true; "Skip" ignores it.
  let consented = $state(false);
  // SEPARATE, independent consent for the particularly-sensitive categories, kept OUT of the general
  // consent above (never bundled). It is NOT required to contribute: left unticked, the sensitive
  // questions are not asked and their fields are omitted from the upload entirely. See
  // SENSITIVE_CONSENT_KEYS below and the collection notice on the gate.
  let sensitiveConsented = $state(false);

  // The survey questions whose answers are only collected under the separate sensitive-category
  // consent above: trade union membership, Aboriginal or Torres Strait Islander origin, religion
  // (incl. the attendance follow-up) and sexual orientation. Anything outside this set is covered by
  // the general research consent.
  const SENSITIVE_CONSENT_KEYS = new Set([
    "union_member",
    "indigenous",
    "religion",
    "attendance",
    "orientation",
  ]);
  // Versioned Terms-of-Use acceptance, recorded on contribute. Contributing is a
  // consequential action, so it requires an active acceptance of the CURRENT Terms version — SEPARATE
  // from research consent above. Skipped entirely by "Skip". If the current version was already
  // accepted elsewhere (e.g. a prior visit), the checkbox is not re-shown but is still required.
  let termsChecked = $state(false);
  // Guards against a double POST if finish() somehow runs twice. There is no other submit path.
  let submitted = false;

  // Both decisions (research consent + current-version Terms acceptance) are required to contribute.
  const canContribute = $derived(consented && (termsAcceptance.accepted || termsChecked));

  // A historical election is a retrospective contribution, so the political questions are framed
  // differently and the collection notice changes.
  const isArchived = $derived(electionPhase(election.meta) === "archived");
  // "Build a voting plan" is only true mid-campaign: a past election yields a demonstration and an
  // unannounced one has no ballot to build against, so the skip CTA only promises a plan when live.
  const inFlight = $derived(electionPhase(election.meta) === "live");
  // The political questions are election- and phase-dependent, so the set follows both. The
  // particularly-sensitive questions are only included when their separate consent is ticked — an
  // un-consented visitor is never asked them, so their fields never enter `demographics`.
  const questions = $derived(
    surveyFor(election.id, { isArchived, year: election.meta.year }).filter(
      (q) => sensitiveConsented || !SENSITIVE_CONSENT_KEYS.has(q.key),
    ),
  );
  // Questions currently shown: some are conditionally hidden (e.g. religious attendance when the
  // religion answer is "No religion"). Used for the progress denominator so it reflects reality.
  const visible = $derived(questions.filter((q) => !q.skipWhen?.(demographics)));
  const current = $derived(step >= 0 ? questions[step] : undefined);
  const position = $derived(current ? visible.indexOf(current) + 1 : 0);

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

  /**
   * Posts the research contribution — the ONLY upload path, reached only by finishing the
   * questions after an explicit opt-in. Everything transmitted is derived ON DEVICE (ADR-0008):
   * the raw answers and weights never leave the browser — the same engine that scored the card
   * reduces them to a top-party match and a stance per answered proposition, and the server only
   * increments aggregate counters. Two SEPARATE requests, separated by design rather than as an
   * absolute guarantee of unlinkability: the derived contribution carries NO electorate; the
   * electorate goes on its own geography ping that shares no key with it. Fire-and-forget: the plan
   * never waits on either, and the dataset chunk is
   * already cached from the card flow so the derivation costs no extra fetch.
   */
  function submitRecord(): void {
    // Fail closed: never upload without BOTH research consent AND a recorded current-version Terms
    // acceptance. Both are established at the gate before the questions begin.
    if (submitted || !consented || !termsAcceptance.accepted) return;
    submitted = true;
    const electionId = election.id;
    const submittedDemographics = { ...demographics };
    // Defence in depth for the separate sensitive-category consent: even if a value was captured (e.g.
    // the visitor answered, went back to the gate and un-ticked), never upload a sensitive category
    // without its explicit consent.
    if (!sensitiveConsented) {
      for (const key of SENSITIVE_CONSENT_KEYS) delete submittedDemographics[key];
    }
    const t = election.meta.timetable;
    const electorate = quiz.electorate;
    // Reached only after the explicit age + consent opt-in above, so this is the point to mint the
    // short-lived single-use tokens. First solve the invisible, self-hosted proof-of-work challenge
    // on demand (purpose-bound to "research", so a forms challenge can never be spent here); its
    // solution is passed to the token endpoint, which verifies it in-process before issuing. The
    // challenge is best-effort — a failure or an unprovisioned challenge layer resolves to undefined
    // and the token request proceeds without it (the server's verifier then decides). Two
    // independent tokens keep the detailed record and the electorate ping separated by design rather
    // than a guaranteed-unlinkable pair. Never blocks the plan.
    void solveChallenge("research")
      .catch(() => undefined)
      .then((challenge) => requestResearchToken(electionId, challenge))
      .then((tokens) =>
        loadData(electionId).then((d) => {
          // Apply the SAME runtime kill-switch proposition suspensions the card applies before it
          // scores/displays (card/+page.svelte): a suspended proposition must not reach the research
          // match or the transmitted stances, or the counters would record a figure the card withholds.
          const suspended = suspendedPropositionIds(electionId);
          const answers = quiz.toAnswers().filter((a) => !suspended.has(a.id));
          const propositions = answers
            .map((a) => ({ id: a.id, stance: stanceOf(a.points) }))
            .filter((p): p is { id: number; stance: Stance } => p.stance !== null);
          void submitResearch({
            schemaVersion: 1,
            electionId,
            timetable: t
              ? {
                  declarationOfNominations: t.declarationOfNominations,
                  pollsCloseAt: t.pollsCloseAt,
                  returnOfWrits: t.returnOfWrits,
                }
              : null,
            state: quiz.state,
            // Same question set the card scores (withdrawn questions never score; suspended
            // propositions filtered above).
            match: topPartyMatch(
              answers,
              activeQuestions(d.dataset.questions),
              d.dataset.parties.merges,
            ),
            propositions,
            demographics: submittedDemographics,
            dataVersion: manifestFor(electionId).dataVersion,
            appVersion: version,
            consentVersion: RESEARCH_CONSENT_VERSION,
            token: tokens?.research,
          });
          if (electorate) {
            void submitGeography({
              schemaVersion: 1,
              electionId,
              electorate,
              token: tokens?.geography,
            });
          }
        }),
      )
      .catch(() => {
        // Research is optional and must never affect the plan; any failure drops it silently.
      });
  }

  // Opt in: begin the optional demographic questions. Requires research consent AND a current-version
  // Terms acceptance; a no-op otherwise. The acceptance (version + timestamp) is recorded here.
  function contribute(): void {
    if (!canContribute) return;
    if (!termsAcceptance.accepted) termsAcceptance.accept();
    step = 0;
  }

  // Skip research entirely and go straight to the plan. Uploads NOTHING.
  function skip(): void {
    goto("/card");
  }

  // Reached only from the end of the (consented) questions: submit the record, then the plan.
  function finish(): void {
    submitRecord();
    goto("/card");
  }

  function choose(key: string, value: string): void {
    if (value) demographics[key] = value;
    next();
  }

  // Advance to the next visible question, skipping any that are conditionally hidden; finish once
  // there are none left. `back` mirrors this, and returns to the gate (-1) then the review page.
  function next(): void {
    let n = step + 1;
    while (n < questions.length && questions[n].skipWhen?.(demographics)) n += 1;
    if (n >= questions.length) finish();
    else step = n;
  }

  function back(): void {
    if (step <= -1) {
      goto("/review");
      return;
    }
    let p = step - 1;
    while (p >= 0 && questions[p].skipWhen?.(demographics)) p -= 1;
    step = p; // may be -1 (the gate)
  }
</script>

<Meta />

<TopBar label="" onback={back} />
{#if step >= 0}
  <Progress value={position} max={visible.length} label="Survey progress" />
{/if}

<div class="body">
  {#if step === -1}
    <div class="gate">
      <p class="ready ui">Your result is ready.</p>
      {#if isArchived}
        <h1>Contribute to historical comparison research? Optional.</h1>
        <p class="note ui">
          You are completing a comparison based on the {election.meta.year} federal election and the parliamentary
          voting record available at that time. Any answers you contribute will be recorded as views expressed
          <strong>today</strong>, not as views expressed during the
          {election.meta.year} election, and are analysed separately from responses collected around that
          election.
        </p>
        <p class="note ui">
          If you opt in, your device works out your closest party match and whether you agreed or
          disagreed with each proposition; National Digital collects only those results, your state
          or territory, the election being compared and the period you contributed, the data and app
          versions, and any optional survey answers you choose to give. The survey may include
          sensitive information such as political opinions, union membership, Indigenous origin,
          religion and sexual orientation. Your individual quiz answers and weights never leave your
          device. Everything collected is stored only as additions to aggregate counts — group
          tallies, not individual records — so a particular contribution cannot later be located or
          deleted. We publish only privacy-protected aggregates, do
          <strong>not</strong> collect your preference order, and no direct identifiers are
          collected. Full detail is in the
          <!-- Opens over the gate rather than navigating: every consent tick here lives in
               component state, so leaving the page discards the decision being collected. -->
          <DocLink href="/privacy">Privacy policy</DocLink>.
        </p>
        <label class="consent ui">
          <input type="checkbox" bind:checked={consented} />
          <span>
            I am at least {RESEARCH_MIN_AGE} and consent to National Digital collecting the answers and
            optional survey information I choose to provide for the historical and cross-election research
            purposes described above and in the Privacy Policy.
          </span>
        </label>
      {:else}
        <h1>Help improve the research? Optional.</h1>
        <p class="note ui">
          Your result and voting plan are already complete — you can use them without contributing
          anything. If you opt in, your device works out your closest party match and whether you
          agreed or disagreed with each proposition; National Digital collects only those results,
          your state or territory, the election being compared and the period you contributed, the
          data and app versions, and any optional survey answers you choose to give. The survey may
          include sensitive information such as political opinions, union membership, Indigenous
          origin, religion and sexual orientation. Your individual quiz answers and weights never
          leave your device.
        </p>
        <p class="note ui">
          Everything collected is stored only as additions to aggregate counts — group tallies, not
          individual records. No per-person research record is created or stored, which also means a
          particular contribution cannot later be located or deleted. We do
          <strong>not</strong> collect your preference order, and no direct identifiers are
          collected. We publish only privacy-protected aggregates. Full detail is in the
          <DocLink href="/privacy">Privacy policy</DocLink>.
        </p>
        <label class="consent ui">
          <input type="checkbox" bind:checked={consented} />
          <span>
            I confirm I am {RESEARCH_MIN_AGE} or older and consent to National Digital collecting the
            information described above for these research purposes.
          </span>
        </label>
      {/if}
      <!-- SEPARATE, independent consent for the particularly-sensitive categories. Never bundled into
           the general research consent above, and NOT required to contribute (it does not gate the
           "Contribute" button). Left unticked, those questions are not asked and their fields are
           omitted from the upload. -->
      <label class="consent ui">
        <input type="checkbox" bind:checked={sensitiveConsented} />
        <span>
          Optional, and not required to take part: I also consent to being asked, and to providing,
          the more sensitive categories — trade union membership, Aboriginal or Torres Strait
          Islander origin, religion, and sexual orientation. Leave this unticked to contribute
          without them.
        </span>
      </label>
      {#if !termsAcceptance.accepted}
        <!-- Versioned Terms-of-Use acceptance, separate from the research consent above.
             Contributing is a consequential action, so it requires an active acceptance of the
             current Terms; recorded (version + timestamp) when you contribute. -->
        <label class="consent ui">
          <input type="checkbox" bind:checked={termsChecked} />
          <span>
            {TERMS_ACCEPTANCE_LABEL} See our <DocLink href="/terms">Terms of Use</DocLink>.
          </span>
        </label>
      {/if}
      <div class="cta">
        <button type="button" class="btn" disabled={!canContribute} onclick={contribute}>
          Contribute my answers and continue
        </button>
        <button type="button" class="btn secondary" onclick={skip}>
          {inFlight
            ? "Skip research and build my voting plan"
            : "Skip research and see my comparison"}
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
      Prefer not to say
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
  .note {
    font-size: 13.5px;
    color: var(--ink2);
    line-height: 1.55;
    margin: 0 0 12px;
  }
  /* :global because the anchor now belongs to DocLink — Svelte's scoping class is not applied
     across a component boundary, so a bare descendant selector would silently stop matching. */
  .note :global(a) {
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
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
