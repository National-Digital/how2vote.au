<script lang="ts">
  /**
   * The research survey's wording, for the iOS app to draw its steps in (ADR 0019 D4b): the page's
   * top bar; each piece of `SURVEY_COPY` once, as a template section named for it, its values marked
   * by `<data>` with a sample in each; the collection notice for a past election, its year marked,
   * and for any other; and the Terms acceptance. Rendered at build time by
   * `routes/states/survey.html`. It never reaches a browser as a page.
   */
  import SurveyNotes from "$lib/components/SurveyNotes.svelte";
  import SurveyTermsLabel from "$lib/components/SurveyTermsLabel.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import { DOC_DIALOG_COPY } from "$lib/doc-dialog-copy";
  import { RESEARCH_MIN_AGE } from "$lib/org";
  import { SURVEY_COPY } from "$lib/survey-copy";
  import { parts } from "$lib/template";

  const SAMPLES: Record<string, string> = { age: String(RESEARCH_MIN_AGE) };
</script>

<TopBar label="" onback={() => undefined} />

<div class="body">
  {#each Object.entries(SURVEY_COPY) as [key, template] (key)}
    <section class="template" id="survey-{key}">
      <p>
        {#each parts(template) as part, i (i)}{#if "text" in part}{part.text}{:else}<data
              value={part.value}>{SAMPLES[part.value]}</data
            >{/if}{/each}
      </p>
    </section>
  {/each}
  <section class="template" id="survey-notes-archived">
    <SurveyNotes archived year={2022} marked />
  </section>
  <section class="template" id="survey-notes-live">
    <SurveyNotes archived={false} year={2025} />
  </section>
  <section class="template" id="survey-terms"><p><SurveyTermsLabel /></p></section>
  <!-- The name of the control that closes a document opened over the gate, as DocDialog names it. -->
  <section class="template" id="survey-close">
    <p>
      {#each parts(DOC_DIALOG_COPY.close) as part, i (i)}{#if "text" in part}{part.text}{:else}<data
            value={part.value}>Privacy policy</data
          >{/if}{/each}
    </p>
  </section>
</div>
