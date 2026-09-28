/**
 * The research survey's state and its steps: the opt-in gate, then the optional demographic
 * questions, then the plan. The survey page renders it, and the iOS app draws the step it is on
 * (`nativeStep`) and asks it to take each step the page's controls take, so the consent rules, the
 * question order and the one upload path are the page's alone.
 *
 * It starts afresh each time the survey is entered (`reset`), as the page's own state once did:
 * leaving the survey discards the decision being collected.
 */
import { version } from "$app/environment";
import { activeQuestions, electionPhase } from "@how2vote/data-schema";
import { topPartyMatch } from "@how2vote/engine";
import { solveChallenge } from "$lib/altcha";
import { loadData } from "$lib/data";
import { election } from "$lib/election.svelte";
import { suspendedPropositionIds } from "$lib/governance";
import { manifestFor } from "$lib/manifest";
import { quiz } from "$lib/quiz.svelte";
import {
  RESEARCH_CONSENT_VERSION,
  requestResearchToken,
  stanceOf,
  submitGeography,
  submitResearch,
  surveyFor,
  type Stance,
} from "$lib/survey";
import { termsAcceptance } from "$lib/terms.svelte";

/**
 * The survey questions whose answers are only collected under the separate sensitive-category
 * consent: trade union membership, Aboriginal or Torres Strait Islander origin, religion (incl. the
 * attendance follow-up) and sexual orientation. Anything outside this set is covered by the general
 * research consent.
 */
export const SENSITIVE_CONSENT_KEYS: ReadonlySet<string> = new Set([
  "union_member",
  "indigenous",
  "religion",
  "attendance",
  "orientation",
]);

/** How the app names the survey's gate, as the step a back request is made from. */
export const GATE = "gate";

/** The step the iOS app draws, as the survey page would show it. */
export type NativeSurveyStep =
  | {
      step: "gate";
      /** What the app sends back with a step back from the gate. */
      key: typeof GATE;
      archived: boolean;
      year: string;
      inFlight: boolean;
      consented: boolean;
      sensitive: boolean;
      /** Whether the current Terms still need accepting, so their checkbox is shown. */
      termsNeeded: boolean;
      terms: boolean;
      canContribute: boolean;
    }
  | {
      step: "question";
      /** The question's key, which the app sends back with an answer to it. */
      key: string;
      label: string;
      note: string;
      options: string[];
      position: number;
      total: number;
    };

class SurveyFlow {
  // -1 = the research opt-in gate; 0..n-1 = the optional demographic questions (index into the full
  // question set). The gate is reached only AFTER the comparison result exists; nothing about it
  // changes the result. NOTHING is ever uploaded unless the visitor ticks consent and contributes.
  step = $state<number>(-1);
  demographics = $state<Record<string, string>>({});
  // Express, specific opt-in: unticked by default, confirming 18+ AND consent to collection of the
  // NON-sensitive items. The "Contribute" action is inert until this is true; "Skip" ignores it.
  consented = $state(false);
  // SEPARATE, independent consent for the particularly-sensitive categories, kept OUT of the general
  // consent above (never bundled). It is NOT required to contribute: left unticked, the sensitive
  // questions are not asked and their fields are omitted from the upload entirely. See
  // SENSITIVE_CONSENT_KEYS and the collection notice on the gate.
  sensitiveConsented = $state(false);
  // Versioned Terms-of-Use acceptance, recorded on contribute. Contributing is a consequential
  // action, so it requires an active acceptance of the CURRENT Terms version — SEPARATE from research
  // consent above. Skipped entirely by "Skip". If the current version was already accepted elsewhere
  // (e.g. a prior visit), the checkbox is not re-shown but is still required.
  termsChecked = $state(false);
  // Guards against a double POST if finish() somehow runs twice. There is no other submit path.
  #submitted = false;
  /** Set once a step has left the survey — for the plan, or back to the review — until it is entered
   *  again: a request sent from its last step before the app redrew is then no step at all. */
  left = false;

  // Both decisions (research consent + current-version Terms acceptance) are required to contribute.
  canContribute = $derived(this.consented && (termsAcceptance.accepted || this.termsChecked));

  // A historical election is a retrospective contribution, so the political questions are framed
  // differently and the collection notice changes.
  isArchived = $derived(electionPhase(election.meta) === "archived");
  // "Build a voting plan" is only true mid-campaign: a past election yields a demonstration and an
  // unannounced one has no ballot to build against, so the skip CTA only promises a plan when live.
  inFlight = $derived(electionPhase(election.meta) === "live");
  // The political questions are election- and phase-dependent, so the set follows both. The
  // particularly-sensitive questions are only included when their separate consent is ticked — an
  // un-consented visitor is never asked them, so their fields never enter `demographics`.
  questions = $derived(
    surveyFor(election.id, { isArchived: this.isArchived, year: election.meta.year }).filter(
      (q) => this.sensitiveConsented || !SENSITIVE_CONSENT_KEYS.has(q.key),
    ),
  );
  // Questions currently shown: some are conditionally hidden (e.g. religious attendance when the
  // religion answer is "No religion"). Used for the progress denominator so it reflects reality.
  visible = $derived(this.questions.filter((q) => !q.skipWhen?.(this.demographics)));
  current = $derived(this.step >= 0 ? this.questions[this.step] : undefined);
  position = $derived(this.current ? this.visible.indexOf(this.current) + 1 : 0);

  /** Starts the survey afresh: the gate, nothing ticked, nothing answered. */
  reset(): void {
    this.step = -1;
    this.demographics = {};
    this.consented = false;
    this.sensitiveConsented = false;
    this.termsChecked = false;
    this.#submitted = false;
    this.left = false;
  }

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
  #submit(): void {
    // Fail closed: never upload without BOTH research consent AND a recorded current-version Terms
    // acceptance. Both are established at the gate before the questions begin.
    if (this.#submitted || !this.consented || !termsAcceptance.accepted) return;
    this.#submitted = true;
    const electionId = election.id;
    const submittedDemographics = { ...this.demographics };
    // Defence in depth for the separate sensitive-category consent: even if a value was captured (e.g.
    // the visitor answered, went back to the gate and un-ticked), never upload a sensitive category
    // without its explicit consent.
    if (!this.sensitiveConsented) {
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
  contribute(): void {
    if (!this.canContribute) return;
    if (!termsAcceptance.accepted) termsAcceptance.accept();
    this.step = 0;
  }

  // Reached only from the end of the (consented) questions: submit the record, then the plan.
  #finish(navigate: (path: string) => void): void {
    this.#submit();
    this.left = true;
    navigate("/card");
  }

  choose(key: string, value: string, navigate: (path: string) => void): void {
    if (value) this.demographics[key] = value;
    this.#next(navigate);
  }

  // Advance to the next visible question, skipping any that are conditionally hidden; finish once
  // there are none left. `back` mirrors this, and returns to the gate (-1) then the review page.
  #next(navigate: (path: string) => void): void {
    let n = this.step + 1;
    while (n < this.questions.length && this.questions[n]!.skipWhen?.(this.demographics)) n += 1;
    if (n >= this.questions.length) this.#finish(navigate);
    else this.step = n;
  }

  back(navigate: (path: string) => void): void {
    if (this.step <= -1) {
      this.left = true;
      navigate("/review");
      return;
    }
    let p = this.step - 1;
    while (p >= 0 && this.questions[p]!.skipWhen?.(this.demographics)) p -= 1;
    this.step = p; // may be -1 (the gate)
  }

  /** The step the iOS app draws: the gate and its ticks, or the question shown and its place. */
  nativeStep(): NativeSurveyStep {
    const current = this.current;
    if (!current) {
      return {
        step: "gate",
        key: GATE,
        archived: this.isArchived,
        year: String(election.meta.year),
        inFlight: this.inFlight,
        consented: this.consented,
        sensitive: this.sensitiveConsented,
        termsNeeded: !termsAcceptance.accepted,
        terms: this.termsChecked,
        canContribute: this.canContribute,
      };
    }
    return {
      step: "question",
      key: current.key,
      label: current.label,
      note: current.note ?? "",
      options: [...current.options],
      position: this.position,
      total: this.visible.length,
    };
  }
}

export const survey = new SurveyFlow();
