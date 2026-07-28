<script lang="ts">
  // The term list lives in $lib/content/glossary.ts so this page and the in-place definition
  // popover (GlossaryTerm.svelte) render the SAME words. Each <dt> keeps its stable kebab-case id,
  // because body copy deep-links a first use as /glossary#division and that anchor is the no-JS
  // fallback for the popover.
  import ContentPage from "$lib/components/ContentPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import { GLOSSARY } from "$lib/content/glossary";
</script>

<Meta />

<ContentPage title="Glossary">
  <p>
    Plain-English meanings for the words How2Vote uses. If a term on the site is unfamiliar, look it
    up here.
  </p>

  <dl class="glossary">
    {#each GLOSSARY as { id, term, def } (id)}
      <dt {id}>{term}</dt>
      <dd>{def}</dd>
    {/each}
  </dl>
</ContentPage>

<style>
  .glossary {
    margin: 8px 0 0;
  }
  dt {
    font-weight: 700;
    color: var(--ink);
    /* Give each entry breathing room. Clearing the pinned top bar on a #term deep link is now the
       job of the global scroll-padding-top (app.css), which knows the real chrome height and is 0
       where nothing is pinned — this only adds the small gap above the landed term. */
    margin-top: 22px;
    scroll-margin-top: 12px;
  }
  dt:first-of-type {
    margin-top: 0;
  }
  dd {
    margin: 4px 0 0;
    color: var(--ink2);
    line-height: 1.6;
  }
</style>
