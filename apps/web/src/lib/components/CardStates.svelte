<script lang="ts">
  /**
   * The comparison card's wording, for the iOS app to draw both its stages in (ADR 0019 D4b): each
   * piece of `CARD_COPY`, `PARTY_PANEL_COPY` and `TERMS_GATE_COPY` once, as a template section named
   * for it, its values marked by `<data>` with a sample in each; and each of the card's paragraphs
   * that carry emphasis or links, once for each case the card renders, its values marked. Rendered at
   * build time by `routes/states/card.html`. It never reaches a browser as a page.
   */
  import CardAck from "$lib/components/CardAck.svelte";
  import CardAdvocacy from "$lib/components/CardAdvocacy.svelte";
  import CardArchiveBanner from "$lib/components/CardArchiveBanner.svelte";
  import CardCorrectionNotice from "$lib/components/CardCorrectionNotice.svelte";
  import CardHint from "$lib/components/CardHint.svelte";
  import CardSaveNote from "$lib/components/CardSaveNote.svelte";
  import CardShareWarning from "$lib/components/CardShareWarning.svelte";
  import CardVintage from "$lib/components/CardVintage.svelte";
  import CardWhyNote from "$lib/components/CardWhyNote.svelte";
  import CardWorksheetFoot from "$lib/components/CardWorksheetFoot.svelte";
  import PartyPanelLabel from "$lib/components/PartyPanelLabel.svelte";
  import TermsGateIntro from "$lib/components/TermsGateIntro.svelte";
  import { PARTY_ALIGNMENT_QUALIFIER } from "$lib/candidate-alignment";
  import { CARD_COPY } from "$lib/card-copy";
  import { RESEARCH_MIN_AGE } from "$lib/org";
  import { PARTY_PANEL_COPY } from "$lib/party-panel-copy";
  import { AUTHORISATION } from "$lib/org";
  import { PREFERENCE_SOURCE_NOTICE } from "$lib/print-auth";
  import { DOC_DIALOG_COPY } from "$lib/doc-dialog-copy";
  import { TERMS_GATE_COPY } from "$lib/terms-gate-copy";
  import { TERMS_ACCEPTANCE_LABEL, TERMS_GATE_LABEL } from "$lib/terms/terms";
  import { parts } from "$lib/template";

  /** A sample for each value a piece names, so a projected piece still reads as a sentence. */
  const SAMPLES: Record<string, string> = {
    electorate: "Bean",
    year: "2025",
    state: "Australian Capital Territory",
    score: "50",
    question: "Increase the Newstart rate",
    total: "8",
    ranked: "3",
    group: "A",
    n: "2",
    name: "Jane Citizen, Independent",
    party: "Example Party",
    detail: "50% party alignment.",
    title: "Terms of Use",
  };

  /** Every template, by the section id the app reads it from. */
  const templates: [string, string][] = [
    ...Object.entries(CARD_COPY).map(([key, text]): [string, string] => [`card-${key}`, text]),
    ...Object.entries(PARTY_PANEL_COPY).map(([key, text]): [string, string] => [
      `panel-${key}`,
      text,
    ]),
    ...Object.entries(TERMS_GATE_COPY).map(([key, text]): [string, string] => [
      `terms-${key}`,
      text,
    ]),
    ["terms-label", TERMS_ACCEPTANCE_LABEL],
    ["terms-group", TERMS_GATE_LABEL],
    ["card-qualifier", PARTY_ALIGNMENT_QUALIFIER],
    ["card-bandAuthorisation", `${AUTHORISATION} ${PREFERENCE_SOURCE_NOTICE}`],
    // The name of the control that closes a document opened over the card, as DocDialog names it.
    ["dialog-close", DOC_DIALOG_COPY.close],
  ];

  const sample = {
    label: "2025 federal election",
    year: 2025,
    vintage: "1 Apr 2025",
    age: RESEARCH_MIN_AGE,
  };
</script>

<div class="body">
  {#each templates as [id, template] (id)}
    <section class="template" {id}>
      <p>
        {#each parts(template) as part, i (i)}{#if "text" in part}{part.text}{:else}<data
              value={part.value}>{SAMPLES[part.value]}</data
            >{/if}{/each}
      </p>
    </section>
  {/each}

  <section class="template" id="card-archive">
    <p><CardArchiveBanner label={sample.label} year={sample.year} marked /></p>
  </section>
  <section class="template" id="card-correction"><p><CardCorrectionNotice /></p></section>
  <section class="template" id="card-hint-ballot">
    <p><CardHint electorateLess={false} /></p>
  </section>
  <section class="template" id="card-hint-parliament"><p><CardHint electorateLess /></p></section>
  {#each [false, true] as archived (archived)}
    {#each [0, 1, 2] as withdrawn (withdrawn)}
      <section
        class="template"
        id="card-vintage-{archived ? 'archived' : 'live'}-{['none', 'one', 'many'][withdrawn]}"
      >
        <p>
          <CardVintage vintage={sample.vintage} {archived} year={sample.year} {withdrawn} marked />
        </p>
      </section>
    {/each}
  {/each}
  <section class="template" id="card-advocacy-ballot">
    <CardAdvocacy age={sample.age} electorate="Bean" electorateLess={false} marked />
  </section>
  <section class="template" id="card-advocacy-parliament">
    <CardAdvocacy age={sample.age} electorate="" electorateLess marked />
  </section>
  <section class="template" id="card-share-warning"><p><CardShareWarning /></p></section>
  <section class="template" id="card-save-unsaved"><p><CardSaveNote saved={false} /></p></section>
  <section class="template" id="card-save-saved"><p><CardSaveNote saved /></p></section>
  <section class="template" id="card-why-note"><p><CardWhyNote /></p></section>
  <section class="template" id="panel-label-ballot">
    <p><PartyPanelLabel ballotOrdered /></p>
  </section>
  <section class="template" id="panel-label-registration">
    <p><PartyPanelLabel ballotOrdered={false} /></p>
  </section>
  <section class="template" id="terms-intro"><p><TermsGateIntro /></p></section>
  <section class="template" id="card-ack-live">
    <CardAck archived={false} year={sample.year} marked />
  </section>
  <section class="template" id="card-ack-archived">
    <CardAck archived year={sample.year} marked />
  </section>
  {#each [false, true] as archived (archived)}
    <section class="template" id="card-foot-{archived ? 'archived' : 'live'}">
      <CardWorksheetFoot
        built="28 Sept 2026"
        label={sample.label}
        dataVersion="2025-04-01"
        version="1.0.0"
        {archived}
        attribution="They Vote For You"
        marked
      />
    </section>
  {/each}
</div>
