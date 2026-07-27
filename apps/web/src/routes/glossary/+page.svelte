<script lang="ts">
  import ContentPage from "$lib/components/ContentPage.svelte";
  import Meta from "$lib/components/Meta.svelte";

  // Plain-English glossary. Every term here appears in user-facing copy elsewhere on the site
  // (methodology, the data pages, the card, privacy/terms), so the body copy can stay precise and
  // concise while a reader who hits an unfamiliar word has a one-click, plain definition. Each <dt>
  // carries a stable kebab-case id so other pages can deep-link a first use (e.g.
  // /glossary#division). Definitions are factual and carry no party valence (neutrality check).
  const terms: { id: string; term: string; def: string }[] = [
    {
      id: "above-and-below-the-line",
      term: "Above the line and below the line",
      def: "The two ways to fill in a Senate ballot paper. Above the line, you number the parties or groups. Below the line, you number individual candidates. You choose one way or the other.",
    },
    {
      id: "aggregate-counts",
      term: "Aggregate counts",
      def: "Group totals only — for example, “about 300 people agreed” — with nothing kept about any one person. How2Vote's optional research stores aggregate counts, never individual records.",
    },
    {
      id: "agreement-figure",
      term: "Agreement figure",
      def: "A number from 0 to 100, published by They Vote For You, for how often a member of parliament has voted the way a proposition describes. How2Vote averages these to score each party.",
    },
    {
      id: "alignment",
      term: "Alignment (match)",
      def: "How closely your answers line up with a party's recorded votes, shown as a percentage. It is background information, not a recommendation — How2Vote never tells you who to put first.",
    },
    {
      id: "checksum",
      term: "Checksum",
      def: "A short code worked out from a file. If even one character of the file changes, the code changes too, so it shows whether the data has been altered.",
    },
    {
      id: "data-vintage",
      term: "Data vintage",
      def: "The date the voting data was captured. It tells you how up to date a comparison is.",
    },
    {
      id: "de-identified",
      term: "De-identified",
      def: "Held in a way that is not tied to you as a person. How2Vote's research is de-identified: it keeps group totals, not a record about any individual.",
    },
    {
      id: "division",
      term: "Division",
      def: "A formal, recorded vote in parliament, where members are counted for and against. They Vote For You publishes these votes, and How2Vote's scores are built from them.",
    },
    {
      id: "estimand",
      term: "Estimand",
      def: "The exact thing a piece of research sets out to measure, decided and written down before any data is collected.",
    },
    {
      id: "hansard",
      term: "Hansard",
      def: "The official written record of what is said and done in parliament.",
    },
    {
      id: "how-to-vote-plan",
      term: "How-to-vote plan",
      def: "The order you choose to number candidates on your ballot. You build your own; How2Vote never chooses it for you, and it is not an official ballot paper.",
    },
    {
      id: "preference",
      term: "Preference",
      def: "A number you write next to a candidate to show the order you want them counted — 1 for your first choice, 2 for your next, and so on.",
    },
    {
      id: "proposition",
      term: "Proposition",
      def: "A specific policy statement that parliament has actually voted on. How2Vote's questions are propositions, so every answer maps to a real vote.",
    },
    {
      id: "they-vote-for-you",
      term: "They Vote For You",
      def: "A free public website, run by the OpenAustralia Foundation, that records how members of parliament have voted. It is How2Vote's source for voting records.",
    },
  ];
</script>

<Meta />

<ContentPage title="Glossary">
  <p>
    Plain-English meanings for the words How2Vote uses. If a term on the site is unfamiliar, look it
    up here.
  </p>

  <dl class="glossary">
    {#each terms as { id, term, def } (id)}
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
    /* Clear the fixed top bar when a #term deep link jumps here, and give each entry breathing room. */
    margin-top: 22px;
    scroll-margin-top: 72px;
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
