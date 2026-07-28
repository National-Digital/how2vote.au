/**
 * The plain-English glossary — the single source of the term list.
 *
 * It lives here, not in the route, because the same definitions are surfaced two ways: the
 * /glossary page renders the whole list, and GlossaryTerm.svelte shows ONE definition in place
 * when a reader clicks a term in body copy. A second copy for the in-place version would be a
 * copy that drifts, and these definitions are neutrality-checked copy.
 *
 * Every id is stable and kebab-case: body copy deep-links a first use as /glossary#division, and
 * those anchors are load-bearing (they are the no-JS fallback for the in-place definition).
 * glossary.test.ts fails if a term referenced in copy is not defined here.
 *
 * Definitions are factual and carry no party valence (neutrality check).
 */
export type GlossaryEntry = { id: string; term: string; def: string };

export const GLOSSARY: GlossaryEntry[] = [
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

/** Definition lookup by anchor id, for the in-place definition popover. */
export function glossaryEntry(id: string): GlossaryEntry | undefined {
  return GLOSSARY.find((entry) => entry.id === id);
}
