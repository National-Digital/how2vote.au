<script lang="ts">
  /**
   * The quiz's own wording, for the iOS app to draw its quiz from (ADR 0019 D4b): each piece once,
   * as a template section named for it, with its values marked by `<data>` and the page's sample in
   * each; the answer spoken for each answer; and the answer scale itself. Rendered at build time by
   * `routes/states/quiz.html`. It never reaches a browser as a page.
   */
  import AnswerOptions from "$lib/components/AnswerOptions.svelte";
  import { QUIZ_COPY, SPOKEN_ANSWERS } from "$lib/quiz-copy";
  import { parts } from "$lib/template";

  const SAMPLES: Record<string, string> = {
    n: "1",
    total: "29",
    answer: SPOKEN_ANSWERS[5],
    retry: QUIZ_COPY.retry,
  };
</script>

<div class="body">
  {#each Object.entries(QUIZ_COPY) as [key, template] (key)}
    <section class="template" id="quiz-{key}">
      <p>
        {#each parts(template) as part, i (i)}{#if "text" in part}{part.text}{:else}<data
              value={part.value}>{SAMPLES[part.value]}</data
            >{/if}{/each}
      </p>
    </section>
  {/each}
  {#each SPOKEN_ANSWERS as answer, points (points)}
    <section class="template" id="quiz-spoken-{points}"><p>{answer}</p></section>
  {/each}
  <AnswerOptions current={undefined} onanswer={() => {}} onskip={() => {}} />
</div>
