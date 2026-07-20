<script lang="ts">
  import { goto } from "$app/navigation";
  import Meta from "$lib/components/Meta.svelte";
  import Progress from "$lib/components/Progress.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import { answerLabel } from "$lib/answers";
  import { ageGate } from "$lib/age.svelte";
  import { loadData, type Question } from "$lib/data";
  import { election } from "$lib/election.svelte";
  import { quiz } from "$lib/quiz.svelte";

  let questions = $state<Question[]>([]);

  // Gate on `quiz.hydrated`: the store hydrates in the root layout's $effect, which runs after this
  // page's effects on a hard load, so reading the store eagerly would bounce a returning visitor to
  // /ballot before their saved answers are restored.
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
        loadError = true;
        dataLoaded = false;
      });
  });

  function edit(index: number): void {
    quiz.setCursor(index);
    // `edit` mode: answering this one question returns here, rather than walking the rest of the quiz.
    goto("/quiz?edit=1");
  }

  function getCard(): void {
    // The optional research survey is 18+ only (ADR 0008/0012), so an under-18 explorer skips it and
    // goes straight to their comparison. The layout guard would bounce them off /survey anyway; this
    // just avoids a redirect bounce and keeps the explore flow clean.
    goto(ageGate.canVote ? "/survey" : "/card");
  }
</script>

<Meta />

<TopBar label="Review your answers" onback={() => goto("/quiz")} />
<Progress value={1} max={1} label="Quiz complete" />

<div class="body">
  <h1>
    {quiz.recorded === quiz.total
      ? `All ${quiz.total} answered.`
      : `${quiz.recorded} of ${quiz.total} answered.`}
  </h1>
  <p class="note ui">
    Tap a question to change your answer. Star (★) the issues that matter most — only your strongest
    answers can count ten times as much.
  </p>

  {#if loadError}
    <p class="note ui" role="alert">
      Couldn't load your answers. Please check your connection and
      <a href="/review" onclick={() => location.reload()}>try again</a>.
    </p>
  {:else if questions.length === 0}
    <p class="note ui" role="status">Loading your answers…</p>
  {/if}
  <ol class="rev ui">
    {#each questions as q, i (q.id)}
      {@const a = quiz.answerFor(q.id)}
      {@const strong = a !== undefined && (a.points === 1 || a.points === 5)}
      <li>
        <button type="button" class="edit" onclick={() => edit(i)}>
          <span class="n">{i + 1}</span>
          <span class="q">{q.text}</span>
          <span class="a" class:dim={!a || a.points === 0}>
            {a ? answerLabel(a.points, false) : "Not answered"}
          </span>
        </button>
        {#if strong}
          <button
            type="button"
            class="star"
            class:on={a.important}
            aria-pressed={a.important}
            aria-label={`Mark "${q.text}" as extremely important`}
            title="Extremely important (×10)"
            onclick={() => quiz.toggleImportant(q.id)}>★</button
          >
        {:else}
          <span class="star-spacer" aria-hidden="true"></span>
        {/if}
      </li>
    {/each}
  </ol>

  <div class="cta">
    <button type="button" class="btn" onclick={getCard}>See how I compare</button>
  </div>
</div>

<style>
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 8px var(--gutter) 20px;
  }
  h1 {
    font-size: 23px;
    margin: 8px 0 4px;
  }
  .note {
    font-size: 13px;
    color: var(--ink2);
    margin: 0 0 10px;
  }
  .rev {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .rev li {
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--line);
  }
  .edit {
    display: grid;
    grid-template-columns: 26px 1fr auto;
    gap: 10px;
    align-items: center;
    flex: 1;
    min-width: 0;
    min-height: 46px;
    border: 0;
    background: none;
    font-family: inherit;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
    padding: 6px 2px;
  }
  .star,
  .star-spacer {
    flex: none;
    width: 34px;
    height: 34px;
  }
  .star {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line2);
    border-radius: 999px;
    background: none;
    color: var(--ink3);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    transition:
      background var(--dur-confirm) ease-out,
      color var(--dur-confirm) ease-out,
      border-color var(--dur-confirm) ease-out;
  }
  .star.on {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--on-fill);
  }
  .star:hover,
  .star:focus-visible {
    color: var(--ink);
  }
  .star.on:hover,
  .star.on:focus-visible {
    color: var(--on-fill);
  }
  .n {
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--ink3);
  }
  .q {
    color: var(--ink);
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .a {
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    color: var(--ink);
    border: 1px solid var(--line2);
    border-radius: 3px;
    padding: 3px 7px;
  }
  .a.dim {
    color: var(--ink3);
    border-style: dashed;
    font-weight: 400;
  }
  .cta {
    margin-top: 20px;
  }
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 52px;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-fill);
    font-family: var(--ui);
    font-size: 16px;
    font-weight: 600;
    border: 0;
    cursor: pointer;
  }
</style>
