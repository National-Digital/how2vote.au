<script lang="ts">
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import type { AnswerPoints } from "@how2vote/engine";
  import AnswerOptions from "$lib/components/AnswerOptions.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import { modal } from "$lib/modal";
  import Progress from "$lib/components/Progress.svelte";
  import ProvenanceNotice from "$lib/components/ProvenanceNotice.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import { keyToAction } from "$lib/answers";
  import { loadData, type Question } from "$lib/data";
  import { election } from "$lib/election.svelte";
  import { quiz } from "$lib/quiz.svelte";

  let announce = $state("");
  let advancing = $state(false);

  // Questions come from the lazily-loaded dataset; quiz.total (persisted) gives an accurate count
  // for the header even before that chunk arrives.
  let questions = $state<Question[]>([]);
  const total = $derived(quiz.total || questions.length);

  const index = $derived(quiz.cursor);
  const question = $derived(questions[index]);
  const current = $derived(question ? quiz.answerFor(question.id) : undefined);
  const isLast = $derived(index >= total - 1);
  // Reached from the review screen to change one answer; we return there instead of advancing.
  // Guarded by `browser` so the prerendered (query-less) build never reads the URL's search params.
  const editing = $derived(browser && page.url.searchParams.has("edit"));

  const reduceMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The store hydrates from localStorage in the root layout's $effect, which runs *after* this
  // page's effects on a direct/hard load. So gate on `quiz.hydrated` rather than reading the store
  // eagerly: without this, a hard refresh sees a not-yet-hydrated (ballot-less) store and bounces to
  // /ballot, throwing away the resume position — even though the saved progress survives the reload.
  let dataLoaded = false;
  let loadError = $state(false);
  $effect(() => {
    if (!quiz.hydrated) return;
    if (!quiz.hasBallot) {
      goto("/ballot");
      return;
    }
    if (dataLoaded) return;
    dataLoaded = true;
    loadError = false;
    void loadData(election.id)
      .then((d) => {
        questions = d.questions;
        quiz.syncQuestions(d.activeQuestionIds);
      })
      .catch(() => {
        // Surface an error rather than hang on the loader forever; allow a retry (loadData evicts the
        // rejected promise, so re-running re-fetches).
        loadError = true;
        dataLoaded = false;
      });
  });

  function advance(): void {
    if (editing || isLast) {
      goto("/review");
    } else {
      quiz.setCursor(index + 1);
    }
  }

  function commit(points: AnswerPoints): void {
    if (!question || advancing) return;
    quiz.record(question.id, points);
    const label =
      points === 0
        ? "Skipped"
        : ["", "strongly disagree", "disagree", "equal merits", "agree", "strongly agree"][points];
    announce = editing
      ? `Answer updated: ${label}. Returning to your answers.`
      : `Answered: ${label}. Question ${Math.min(index + 2, total)} of ${total}.`;
    advancing = true;
    const delay = reduceMotion() ? 0 : 160;
    window.setTimeout(() => {
      advancing = false;
      advance();
    }, delay);
  }

  function back(): void {
    if (editing) goto("/review");
    else if (index === 0) goto("/ballot");
    else quiz.setCursor(index - 1);
  }

  function onkeydown(e: KeyboardEvent): void {
    // A modal surface owns the keyboard while it is up. This handler is on `window`, and key events
    // still bubble there from inside a `showModal()` dialog, so without this the answer keys keep
    // firing underneath one — reading the Terms over the quiz would silently answer questions.
    if (modal.isOpen) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowLeft") {
      back();
      return;
    }
    const action = keyToAction(e.key);
    if (!action) return;
    e.preventDefault();
    if (action.type === "answer") commit(action.points);
    else if (action.type === "skip") commit(0);
  }

  const policyUrl = $derived(
    question ? `https://theyvoteforyou.org.au/policies/${question.id}` : "#",
  );
</script>

<Meta title={total > 0 ? `Question ${index + 1} of ${total} — How2Vote` : "Quiz — How2Vote"} />
<svelte:window {onkeydown} />

<TopBar
  label={`Question ${index + 1} of ${total}`}
  onback={back}
  backLabel={editing ? "Back to your answers" : "Previous question"}
>
  {#snippet right()}
    <a class="pause ui" href="/">Pause</a>
  {/snippet}
</TopBar>
<Progress value={index + 1} max={total} label="Quiz progress" />

<div class="body" aria-live="off">
  {#if question}
    <div class="intro">
      {#if index === 0}
        <ProvenanceNotice electionId={election.id} />
      {/if}
      <p class="kicker ui">Parliament voted on this</p>
      <h1 class="q">{question.text}</h1>
      <ExternalLink href={policyUrl} class="src ui">
        See the parliamentary votes behind this
      </ExternalLink>
    </div>

    <div class="stack">
      <p class="kicker ui">How would you vote on this?</p>
      <AnswerOptions {current} onanswer={(p) => commit(p)} onskip={() => commit(0)} />
    </div>
  {:else if loadError}
    <p class="kicker ui" role="alert">
      Couldn't load the questions. Please check your connection and
      <a href="/quiz" onclick={() => location.reload()}>try again</a>.
    </p>
  {:else}
    <p class="kicker ui" role="status">Loading question…</p>
  {/if}
</div>

<p class="visually-hidden" role="status" aria-live="polite">{announce}</p>

<style>
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 12px var(--gutter) 16px;
    min-height: 0;
  }
  /* The question block reserves a constant height (kicker + up to the longest question + source
     link) so the answer options and the source link sit in exactly the same place on every
     question. Without this the block's height tracks the question length and everything below it
     shifts question-to-question (cumulative layout shift). Sized to the longest current question
     with a little headroom; kept as tight as that allows so short questions don't open a big gap. */
  .intro {
    min-height: 11.5em;
    flex: 0 0 auto;
  }
  .kicker {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--ink2);
    margin: 6px 0 8px;
  }
  .q {
    font-size: clamp(21px, 5.5vw, 24px);
    line-height: 1.22;
    letter-spacing: -0.01em;
    font-weight: 600;
  }
  .intro :global(.src) {
    /* WCAG 2.2 SC 2.5.8 Target Size (Minimum): 24px-tall hit area for the standalone source link,
       type unchanged (inline-flex so the underline still hugs the text). */
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    font-size: 11.5px;
    color: var(--ink2);
    text-decoration: underline;
    text-underline-offset: 3px;
    margin-top: 10px;
  }
  /* Sits directly beneath the reserved question block with only a small gap — no longer pinned to
     the bottom of the viewport (which opened a large, empty gap between the question and the
     options). The reserved .intro height keeps the options in a constant position, so there's no
     layout shift between questions. */
  .stack {
    margin-top: 10px;
    padding-top: 0;
  }
  .pause {
    /* WCAG 2.2 SC 2.5.8 Target Size (Minimum): 24px-tall hit area, type unchanged. */
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    font-size: 12px;
    color: var(--ink2);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
