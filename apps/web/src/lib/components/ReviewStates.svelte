<script lang="ts">
  /**
   * The review screen's wording, for the iOS app to draw its review from (ADR 0019 D4b): each piece
   * once — the page's and the app's own — as a template section named for it, with its values marked
   * by `<data>` and a sample in each; and the short label each answer is read back by, in points
   * order. Rendered at build time by `routes/states/review.html`. It never reaches a browser as a
   * page.
   */
  import type { AnswerPoints } from "@how2vote/engine";
  import { answerLabel } from "$lib/answers";
  import { REVIEW_COPY } from "$lib/review-copy";
  import { REVIEW_APP_COPY } from "$lib/review-copy.app";
  import { parts } from "$lib/template";

  const SAMPLES: Record<string, string> = {
    total: "12",
    recorded: "9",
    retry: REVIEW_COPY.retry,
    question: "This question",
  };
  const POINTS: AnswerPoints[] = [0, 1, 2, 3, 4, 5];
</script>

<div class="body">
  {#each Object.entries({ ...REVIEW_COPY, ...REVIEW_APP_COPY }) as [key, template] (key)}
    <section class="template" id="review-{key}">
      <p>
        {#each parts(template) as part, i (i)}{#if "text" in part}{part.text}{:else}<data
              value={part.value}>{SAMPLES[part.value]}</data
            >{/if}{/each}
      </p>
    </section>
  {/each}
  <section class="template" id="review-answers">
    <dl>
      {#each POINTS as points (points)}<dt>{points}</dt>
        <dd>{answerLabel(points, false)}</dd>{/each}
    </dl>
  </section>
</div>
