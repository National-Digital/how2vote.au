<script lang="ts">
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import { version } from "$app/environment";
  import { beforeNavigate, goto } from "$app/navigation";
  import { onDestroy, onMount, tick } from "svelte";
  import { ageGate } from "$lib/age.svelte";
  import PartyAlignmentPanel from "$lib/components/PartyAlignmentPanel.svelte";
  import { PARTY_ALIGNMENT_QUALIFIER } from "$lib/candidate-alignment";
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
  import Logo from "$lib/components/Logo.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import PlanAuthorisationBand from "$lib/components/PlanAuthorisationBand.svelte";
  import PlanRow from "$lib/components/PlanRow.svelte";
  import PrintAuthorisationDialog from "$lib/components/PrintAuthorisationDialog.svelte";
  import TermsGate from "$lib/components/TermsGate.svelte";
  import { cardFlow as flow, rowId, TVFY_POLICY } from "$lib/card-flow.svelte";
  import { CARD_COPY } from "$lib/card-copy";
  import { stateName } from "$lib/data";
  import { election } from "$lib/election.svelte";
  import { printAuth } from "$lib/print-auth.svelte";
  import { RESEARCH_MIN_AGE } from "$lib/org";
  import { prefOf } from "$lib/plan";
  import { isNativeShell, nativeSharePlugin } from "$lib/channel";
  import { ogImageFor, shareUrl } from "$lib/seo";
  import { fill } from "$lib/template";

  // The card's state, its rules and its gates are the flow's (`$lib/card-flow`), which the iOS app
  // draws from too; this page renders it and owns only what a browser does: navigation, the share
  // sheet or clipboard, and printing.
  onMount(() => {
    void flow.open(new URL(window.location.href), (path) => void goto(path));
  });
  onDestroy(() => flow.close());

  const data = $derived(flow.data);

  const metaTitle = $derived(
    flow.status === "archived-link"
      ? CARD_COPY.metaArchivedLink
      : data
        ? flow.electorateLess
          ? CARD_COPY.metaParliament
          : fill(CARD_COPY.metaElectorate, {
              electorate: data.card.electorate,
              year: election.meta.year,
            })
        : undefined,
  );

  // In-memory-only teardown of the print acknowledgement (National Digital authoriser model; see
  // docs/adr/0010). The acknowledgement is held only for the current print and must not outlive it:
  // it is cleared when a print completes (afterprint) and when the tab is unloaded
  // (pagehide/beforeunload). A route change tears the whole capability down via
  // onDestroy/beforeNavigate below.
  onMount(() => {
    const clearAck = () => printAuth.clearAcknowledgement();
    window.addEventListener("afterprint", clearAck);
    window.addEventListener("pagehide", clearAck);
    window.addEventListener("beforeunload", clearAck);
    return () => {
      window.removeEventListener("afterprint", clearAck);
      window.removeEventListener("pagehide", clearAck);
      window.removeEventListener("beforeunload", clearAck);
    };
  });
  // Leaving /card drops BOTH the particulars and the owner capability — owner-ness never leaks
  // across routes, and the next visit must re-establish it from a fresh own-quiz build.
  beforeNavigate(() => printAuth.reset());
  onDestroy(() => printAuth.reset());

  // A user who dismisses a share sheet meant to cancel — never silently fall through to another
  // share surface or copy the answers-bearing link to the clipboard. Only a genuine
  // unavailability/failure (not a cancel) should try the next mechanism.
  function isShareCancel(err: unknown): boolean {
    if (err instanceof DOMException && err.name === "AbortError") return true;
    const message = err instanceof Error ? err.message : String(err ?? "");
    return /cancel/i.test(message);
  }

  // Actually copy/share the link — reached ONLY from the non-revocable warning's confirm,
  // i.e. after the user has been told the link cannot be recalled.
  async function copyShareLink(): Promise<void> {
    if (!flow.confirmShare()) return;
    // Always the canonical https origin — never window.location, whose origin is the local
    // WebView scheme in the native shells and would produce a link recipients cannot open.
    const url = shareUrl(window.location.pathname, window.location.hash);
    const title = "My How2Vote comparison";

    // Pick exactly ONE share surface: the Capacitor plugin inside a shell, else the Web Share API
    // on the web (also present in iOS WKWebView). Never chain them — chaining would re-open a
    // second sheet after the user dismissed the first.
    const nativeShare = nativeSharePlugin();
    const shareFn = nativeShare
      ? (): Promise<unknown> => nativeShare.share({ title, url })
      : navigator.share
        ? (): Promise<unknown> => navigator.share({ title, url })
        : null;

    if (shareFn) {
      try {
        await shareFn();
        return; // shared
      } catch (err) {
        if (isShareCancel(err)) return; // cancel means cancel — no clipboard fallback
        /* genuine failure — fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      flow.markCopied();
    } catch {
      /* clipboard unavailable */
    }
  }

  function startBuild(): void {
    flow.requestBuild();
    if (flow.stage === "build") window.scrollTo({ top: 0 });
  }

  function onTermsAccepted(): void {
    // Only a build the gate was holding starts the plan at its top; a print keeps the voter's place.
    const building = flow.pendingAction === "build";
    flow.onTermsAccepted();
    if (building && flow.stage === "build") window.scrollTo({ top: 0 });
  }

  // The stamp actually PRINTED on the plan — National Digital's authorisation plus the "preference
  // order selected by the user" notice — non-empty ONLY once the voter has acknowledged the print,
  // so a mid-form native (Ctrl+P) print never carries an un-acknowledged authorisation stamp.
  const authStamp = $derived(printAuth.stamp);
  // Fail-safe for a native (Ctrl+P) print that side-steps the in-app gate: until the print is
  // acknowledged, the printed worksheet carries a clear "not authorised" notice instead, so no
  // unauthorised how-to-vote material can be produced without being marked as such.
  const printAuthorised = $derived(printAuth.acknowledged);

  async function confirmPrint(): Promise<void> {
    // Fail closed: the owner capability is re-asserted before printing, and the acknowledgement is
    // enforced by the dialog's confirm button, which only invokes this once the declaration is
    // ticked. Only NOW does the printed authorisation stamp become non-empty; the acknowledgement
    // screen closes so the WORKSHEET (not the modal) is what prints, the stamp once at its end.
    if (!flow.acknowledgePrint()) return;
    await tick();
    window.print();
    // Belt-and-braces: also clear here in case a browser fires no `afterprint`.
    printAuth.clearAcknowledgement();
  }
</script>

<Meta title={metaTitle} image={ogImageFor(election.id)} />

{#if flow.status === "loading"}
  <p class="pad ui">{CARD_COPY.loading}</p>
{:else if flow.status === "archived-link"}
  <div class="pad archived-link">
    <p class="kicker ui">{CARD_COPY.archivedLinkKicker}</p>
    <h1>{CARD_COPY.archivedLinkTitle}</h1>
    <p class="ui note">{CARD_COPY.archivedLinkOld}</p>
    <p class="ui note">{CARD_COPY.archivedLinkNow}</p>
    <a class="btn" href="/ballot">{CARD_COPY.archivedLinkAction}</a>
  </div>
{:else if flow.status === "error"}
  <div class="pad">
    <h1>{CARD_COPY.errorTitle}</h1>
    <p class="ui note">{CARD_COPY.errorNote}</p>
    <a class="btn" href="/ballot">{CARD_COPY.errorAction}</a>
  </div>
{:else if flow.status === "unavailable"}
  <!-- Fail-closed governance state: a capability this card needs has been suspended by
       the signed runtime kill-switch control plane (or the plane is tampered/unsigned). We refuse to
       render rather than show a withdrawn ballot / comparison. -->
  <div class="pad">
    <h1>{CARD_COPY.unavailableTitle}</h1>
    <p class="ui note">{CARD_COPY.unavailableNote}</p>
    <a class="btn" href="/">{CARD_COPY.unavailableAction}</a>
  </div>
{:else if data}
  <div class="card-head">
    <div class="ch-top ui">
      <a class="home" href="/" aria-label={CARD_COPY.home}><Logo size="sm" /></a>
      <span>{flow.stageLabel}</span>
    </div>
    <h1>
      {#if flow.electorateLess}{CARD_COPY.parliament}{:else}{data.card.electorate}<span
          class="st ui"
        >
          · {stateName(data.card.state)}</span
        >{/if}
    </h1>
  </div>

  <!-- Persistent historical-use warning. Shown on both stages and, deliberately, on the
       printed worksheet — an archived election's plan is a demonstration, never a live instruction. -->
  {#if flow.isArchived}
    <div class="archive-banner ui" role="note">
      <CardArchiveBanner label={election.meta.label} year={election.meta.year} />
    </div>
  {/if}

  <!-- "Under review" correction banner: a granular kill-switch suspension is affecting
       what this card shows — a withdrawn party alignment / proposition, or a suspended ballot. The
       affected figures are already withheld by the engine + card build; this explains why. -->
  {#if flow.correctionNotice}
    <div class="archive-banner ui" role="note"><CardCorrectionNotice /></div>
  {/if}

  {#if flow.stage === "compare"}
    <p class="hint ui pad-x"><CardHint electorateLess={flow.electorateLess} /></p>
    <!-- Candidate-level predictive-claim limit, shown next to the scores, not only in the
         Terms — a party record is not evidence of a candidate's own views or future votes. Single-
         sourced from $lib/candidate-alignment so the visible copy, the per-row wording and the
         guard can never drift apart. -->
    <p class="disclaimer ui pad-x">{PARTY_ALIGNMENT_QUALIFIER}</p>

    <section class="ballot">
      {#if flow.electorateLess}
        <!-- No ballot yet (provisional/upcoming): there is no House/Senate split to show, so the
             comparison is a single party voting-record panel sourced from the per-party percentages
             (the current Parliament's record), not from candidate rows. -->
        <div class="chamber">
          <header class="chamber-head ui">
            <span class="chamber-n" aria-hidden="true">✓</span>
            <span class="chamber-t">
              <b>{CARD_COPY.parliamentPanel}</b>
              <small>{CARD_COPY.parliamentPanelNote}</small>
            </span>
          </header>
          <!-- Each row carries its partyKey and suspended flag from the flow (`allPartyAlignments`). -->
          <PartyAlignmentPanel
            parties={flow.allPartyAlignments}
            caption={CARD_COPY.parliamentCaption}
            ballotOrdered={false}
          />
        </div>
      {:else}
        <div class="chamber">
          <header class="chamber-head ui">
            <span class="chamber-n" aria-hidden="true">1</span>
            <span class="chamber-t">
              <b>{CARD_COPY.house}</b>
              <small>{CARD_COPY.houseCompare}</small>
            </span>
          </header>
          <!-- The results screen shows party voting-record alignment only — no candidate list. A
               ballot order shown here, with no selection against it, reads as a ranking; the ballot
               (with blank preference boxes) belongs in the build stage, where the voter authors it.
               Each row carries its partyKey and suspended flag from the flow (`houseParties`). -->
          <PartyAlignmentPanel parties={flow.houseParties} caption={CARD_COPY.houseCaption} />
        </div>

        <div class="chamber">
          <header class="chamber-head ui">
            <span class="chamber-n" aria-hidden="true">2</span>
            <span class="chamber-t">
              <b>{CARD_COPY.senate}</b>
              <small>{fill(CARD_COPY.senatePaper, { state: stateName(data.card.state) })}</small>
            </span>
          </header>

          <!-- Party alignment only here too. The Senate above-the-line groups ARE party/group-level,
               so the party panel is the whole surface; above/below-the-line ballot order belongs in
               the build stage, where the voter numbers it themselves. Each row carries its partyKey
               and suspended flag from the flow (`senateParties`). -->
          <PartyAlignmentPanel parties={flow.senateParties} caption={CARD_COPY.senateCaption} />
        </div>
      {/if}
    </section>

    <p class="vintage ui pad-x">
      <CardVintage
        vintage={flow.vintage}
        archived={flow.isArchived}
        year={election.meta.year}
        withdrawn={flow.withdrawnCount}
      />
    </p>

    {#if ageGate.canVote}
      <div class="actions ui">
        {#if data.shared}
          <!-- A shared comparison is someone else's answers: it stays comparison-only, and the
               recipient is directed to make their own (the link below). Building a plan on top of
               another person's comparison is deliberately not offered. -->
          <p class="gated ui">{CARD_COPY.shared}</p>
        {:else if flow.plansEnabled}
          <button type="button" class="btn" onclick={startBuild}>
            {flow.isArchived ? CARD_COPY.buildDemonstration : CARD_COPY.build}
          </button>
        {:else}
          <p class="gated ui">{CARD_COPY.plansClosed}</p>
        {/if}
        {#if !data.shared}
          <!-- Sharing is only offered on your OWN comparison. A shared card is already someone
               else's answers; the recipient makes their own (button below) rather than re-sharing. -->
          <!-- Full-width when it is the only button in the row. A build button sits beside it only
               when plansEnabled; otherwise (the upcoming / gated case) the share button is alone
               under a full-width note and should span the whole row rather than a lone 50% column. -->
          <button
            type="button"
            class="btn ghost"
            class:span-full={!flow.plansEnabled}
            onclick={() => flow.requestShare()}
            aria-expanded={flow.showShareWarning}
            aria-controls="share-warning"
          >
            {flow.copied ? CARD_COPY.copied : CARD_COPY.share}
          </button>
        {/if}
      </div>
    {:else}
      <!-- Under-18 explore mode (ADR 0012): the comparison IS the result. -->
      <div class="advocacy ui" role="note">
        <CardAdvocacy
          age={RESEARCH_MIN_AGE}
          electorate={data.card.electorate}
          electorateLess={flow.electorateLess}
        />
      </div>
    {/if}

    {#if flow.pendingAction}
      <!-- Versioned Terms acceptance before a build / share / print. Separate from
           research consent, which has its own gate on the survey. -->
      <TermsGate onaccept={onTermsAccepted} oncancel={() => flow.cancelTerms()} />
    {/if}

    {#if flow.showShareWarning}
      <!-- Non-revocable-link warning, shown BEFORE any copy/share. The link carries the
           answers in its own fragment and lives on no server of ours, so it cannot be expired or
           recalled once sent — the user is told this and must confirm before the link is copied. -->
      <div
        class="share-warning ui"
        id="share-warning"
        role="group"
        aria-label={CARD_COPY.shareWarning}
      >
        <p class="sw-head"><b>{CARD_COPY.shareWarningTitle}</b></p>
        <p><CardShareWarning /></p>
        <div class="sw-actions">
          <button type="button" class="btn" onclick={copyShareLink}>{CARD_COPY.copyLink}</button>
          <button type="button" class="btn ghost" onclick={() => flow.cancelShare()}>
            {CARD_COPY.cancel}
          </button>
        </div>
      </div>
    {/if}

    {#if flow.cardUrl && ageGate.canVote && !data.shared}
      <div class="save ui">
        <button
          type="button"
          class="save-btn"
          class:on={flow.isSaved}
          onclick={() => flow.toggleSave()}
        >
          {flow.isSaved ? CARD_COPY.savedOn : CARD_COPY.save}
        </button>
        <p class="save-note"><CardSaveNote saved={flow.isSaved} /></p>
      </div>
    {/if}

    <div class="why ui">
      <button
        type="button"
        class="why-toggle"
        onclick={() => (flow.showWhy = !flow.showWhy)}
        aria-expanded={flow.showWhy}
      >
        {flow.showWhy ? CARD_COPY.whyHide : CARD_COPY.whyShow}
      </button>
      {#if flow.showWhy}
        <p class="why-note"><CardWhyNote /></p>
        {#each flow.evidenceParties.filter((p) => !p.suspended) as p (p.partyKey)}
          <details class="evi">
            <summary>
              <b>{p.party}</b> — {p.score < 0
                ? CARD_COPY.noPartyVotes
                : fill(CARD_COPY.partyScore, { score: p.score })}
            </summary>
            <ul>
              {#each flow.evidence(p.partyKey) as line (line.questionId)}
                <li>
                  <span class="ag ag-{line.agreement}">{line.agreement}</span>
                  <span class="q">
                    {line.question}
                    <ExternalLink
                      href="{TVFY_POLICY}/{line.questionId}"
                      class="rec"
                      ariaLabel={fill(CARD_COPY.recordLabel, { question: line.question })}
                    >
                      {CARD_COPY.record}
                    </ExternalLink>
                  </span>
                </li>
              {/each}
            </ul>
          </details>
        {/each}
      {/if}
    </div>

    {#if !data.shared}
      <p class="restart ui"><a href="/review">{CARD_COPY.changeAnswers}</a></p>
    {:else}
      <!-- Making your own from a shared card starts a CLEAN session — startFresh() wipes any
           in-progress quiz on this device first so nothing carries over. -->
      <p class="restart ui">
        <button
          type="button"
          class="restart-btn"
          onclick={() => flow.startFresh((path) => void goto(path))}
        >
          {CARD_COPY.makeOwn}
        </button>
      </p>
    {/if}
  {:else}
    <!-- BUILD STAGE — the voter authors their own order from a blank ballot. -->
    <!-- Fail-closed native print: the whole worksheet is display:none in @media print until the voter
         has completed the s321D authorisation gate (printAuthorised true). A native Ctrl+P that
         side-steps the in-app flow therefore prints ONLY the "not authorised" notice that follows the
         wrapper — never distributable how-to-vote material. Marking output "not authorised" is not a
         compliance mechanism on its own, so the material itself must not reach paper unauthorised. -->
    <div class="worksheet" class:print-locked={!printAuthorised}>
      <div class="ack ui pad-x" role="note">
        <CardAck archived={flow.isArchived} year={election.meta.year} />
      </div>

      <section class="ballot">
        <div class="chamber">
          <header class="chamber-head ui">
            <span class="chamber-n" aria-hidden="true">1</span>
            <span class="chamber-t">
              <b>{CARD_COPY.house}</b>
              <small>{CARD_COPY.houseBuild}</small>
            </span>
          </header>
          <ol class="rows">
            {#each flow.house as r (r.candidate + r.position)}
              {@const id = rowId(r.candidate, r.position)}
              <PlanRow
                uid={`h-${id}`}
                candidate={r.candidate}
                party={r.party}
                pref={prefOf(flow.houseOrder, id)}
                total={flow.houseIds.length}
                onset={(n) => flow.setRank("house", id, n)}
                onup={() => flow.moveUp("house", id)}
                ondown={() => flow.moveDown("house", id)}
              />
            {/each}
          </ol>
          <p class="check ui" role="status">{flow.houseStatusText}</p>
        </div>

        <div class="chamber">
          <header class="chamber-head ui">
            <span class="chamber-n" aria-hidden="true">2</span>
            <span class="chamber-t">
              <b>{CARD_COPY.senate}</b>
              <small>{fill(CARD_COPY.senatePaper, { state: stateName(data.card.state) })}</small>
            </span>
          </header>

          <div class="senate-mode ui" role="group" aria-label={CARD_COPY.senateMethod}>
            <button
              type="button"
              class:on={flow.senateView === "above"}
              aria-pressed={flow.senateView === "above"}
              onclick={() => (flow.senateView = "above")}
            >
              {CARD_COPY.above}
            </button>
            <button
              type="button"
              class:on={flow.senateView === "below"}
              aria-pressed={flow.senateView === "below"}
              onclick={() => (flow.senateView = "below")}
            >
              {CARD_COPY.below}
            </button>
          </div>
          <p class="senate-note ui">{CARD_COPY.senateOneMethod}</p>

          {#if flow.senateView === "above"}
            <ol class="rows">
              {#each flow.aboveRows as r (r.id)}
                <PlanRow
                  uid={`sa-${r.id}`}
                  candidate={r.candidate}
                  party={r.party}
                  pref={prefOf(flow.senateAboveOrder, r.id)}
                  total={flow.senateAboveIds.length}
                  onset={(n) => flow.setRank("above", r.id, n)}
                  onup={() => flow.moveUp("above", r.id)}
                  ondown={() => flow.moveDown("above", r.id)}
                />
              {/each}
            </ol>
            <p class="check ui" role="status">{flow.aboveStatusText}</p>
          {:else}
            {#each flow.senateGroups as [group, rows] (group)}
              <p class="col ui">{fill(CARD_COPY.column, { group })}</p>
              <ol class="rows">
                {#each rows as r (r.candidate + r.position)}
                  {@const id = rowId(r.candidate, r.position)}
                  <PlanRow
                    uid={`sb-${id}`}
                    candidate={r.candidate}
                    party={r.party}
                    pref={prefOf(flow.senateBelowOrder, id)}
                    total={flow.senateBelowIds.length}
                    onset={(n) => flow.setRank("below", id, n)}
                    onup={() => flow.moveUp("below", id)}
                    ondown={() => flow.moveDown("below", id)}
                  />
                {/each}
              </ol>
            {/each}
            <p class="check ui" role="status">{flow.belowStatusText}</p>
          {/if}
        </div>
      </section>

      <!-- Worksheet footer — travels with the printed plan. Carries the accuracy warning, jurisdiction,
         build date and data/method versions, and the statement that the PREFERENCE ORDER IS THE
         USER'S. National Digital's electoral authorisation of the material it publishes is stamped
         once at the end of the document (National Digital authoriser model; docs/adr/0010). -->
      <div class="worksheet-foot ui">
        <CardWorksheetFoot
          built={flow.builtOn}
          label={election.meta.label}
          dataVersion={election.manifest.dataVersion}
          {version}
          archived={flow.isArchived}
          attribution={data.card.attribution}
        />
      </div>

      <div class="actions ui">
        <!-- Web PWA only. The shells carry no print action: the authorisation band pinned to the
             viewport is the on-screen guarantee there, and a sanctioned share-image is the intended
             way a plan leaves the device. requestPrint() fails closed on native regardless. -->
        {#if !isNativeShell}
          <button type="button" class="btn" onclick={() => flow.requestPrint()}>
            {flow.isArchived ? CARD_COPY.printDemonstration : CARD_COPY.print}
          </button>
        {/if}
        <button type="button" class="btn ghost" onclick={() => flow.backToCompare()}>
          {CARD_COPY.backToCompare}
        </button>
      </div>

      {#if flow.pendingAction}
        <!-- Fail-closed Terms re-acceptance before a print — e.g. if the Terms version
           changed after the plan was built. Normally already accepted at build, so unseen here. -->
        <TermsGate onaccept={onTermsAccepted} oncancel={() => flow.cancelTerms()} />
      {/if}
    </div>
    <!-- /.worksheet — everything above is hidden in print until the print acknowledgement is given. -->

    <!-- The on-SCREEN authorisation, fixed to the viewport for as long as the plan is displayed.
         Everything below this point is print-only: the stamp and the watermark are `@media print`,
         so without this band a screenshot of the plan would carry neither the s321D particulars
         nor (for a historical election) any marker saying so. See PlanAuthorisationBand.svelte. -->
    <PlanAuthorisationBand archived={flow.isArchived} />

    <!-- Archived-election watermark — a large, print-only diagonal overlay repeated on EVERY printed
         page, shown only when this is a historical (archived) election so a printed demonstration can
         never be mistaken for a live how-to-vote instruction. Hidden on screen (the band above is
         its on-screen counterpart). -->
    {#if flow.isArchived}
      <div class="print-watermark" aria-hidden="true">
        HISTORICAL EXAMPLE — NOT VALID FOR VOTING
      </div>
    {/if}

    <!-- Authorisation stamp — National Digital's authorisation of the material it publishes, plus the
         "preference order selected by the user" notice. Rendered ONCE at the END of the document in
         @media print, hidden (display:none) at all other times. Non-empty ONLY once the print is
         acknowledged; empty otherwise, so a stale/unacknowledged stamp can never print. -->
    <div class="print-stamp" data-testid="print-stamp">{authStamp}</div>
    {#if !printAuthorised}
      <!-- Only visible in print, and only when the print has not been acknowledged (e.g. a native
           Ctrl+P that side-stepped the in-app gate): the printed worksheet is then marked as
           unauthorised rather than passing as authorised how-to-vote material. -->
      <div class="print-unauthorised" aria-hidden="true">
        <b>This voting plan was not printed.</b>
        A how-to-vote plan can only be printed through the on-screen “Print my voting plan” button, which
        carries National Digital's electoral authorisation of the material it publishes. Printing from
        the browser menu is disabled so that unauthorised electoral matter cannot be produced.
      </div>
    {/if}

    {#if flow.session === "print-authorisation"}
      <!-- Print acknowledgement (National Digital authoriser model; see docs/adr/0010), as a
           focus-trapping modal. No user particulars are collected — the plan carries National
           Digital's authorisation; the voter acknowledges that the preference order is their own
           selection and that the plan is not a ballot paper. Declaration prose is subject to final
           legal sign-off before public release. -->
      <PrintAuthorisationDialog onconfirm={confirmPrint} oncancel={() => flow.cancelPrint()} />
    {/if}
  {/if}
{/if}

<style>
  .pad {
    padding: 40px var(--gutter);
  }
  .pad-x {
    padding-left: var(--gutter);
    padding-right: var(--gutter);
  }
  .note {
    color: var(--ink2);
    font-size: 14px;
  }
  .archived-link {
    max-width: 560px;
  }
  .archived-link .kicker {
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink2);
    margin: 0 0 8px;
  }
  .archived-link h1 {
    margin-bottom: 12px;
  }
  .archived-link .note {
    line-height: 1.55;
    margin: 0 0 12px;
  }
  .archived-link .btn {
    margin-top: 8px;
  }
  .card-head {
    padding: 16px var(--gutter) 12px;
    border-bottom: 1.5px solid var(--rule);
  }
  .ch-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink2);
    margin-bottom: 8px;
  }
  .home {
    display: inline-flex;
    color: var(--ink);
    border-radius: var(--radius);
  }
  .home:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 3px;
  }
  h1 {
    font-size: 27px;
  }
  .st {
    font-size: 15px;
    color: var(--ink2);
    font-weight: 400;
  }
  .hint {
    font-size: 12.5px;
    color: var(--ink2);
    line-height: 1.5;
    margin: 12px 0;
  }
  .ack {
    margin: 14px 0;
    padding-top: 12px;
    padding-bottom: 12px;
    border-left: 3px solid var(--rule);
  }
  .ack :global(p) {
    font-size: 13px;
    color: var(--ink2);
    line-height: 1.55;
    margin: 0;
  }
  .ack :global(p + p) {
    margin-top: 8px;
  }
  /* Persistent historical-use warning. Prominent (not muted), and kept visible in print so the
     printed demonstration cannot be mistaken for a live how-to-vote instruction. */
  .archive-banner {
    margin: 12px var(--gutter) 0;
    padding: 12px 14px;
    border: 1.5px solid var(--rule);
    border-radius: var(--radius);
    background: var(--fill2, transparent);
    font-size: 12.5px;
    color: var(--ink);
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .disclaimer {
    font-size: 12px;
    color: var(--ink2);
    line-height: 1.5;
    margin: 0 0 4px;
  }
  .ballot {
    padding: 0 var(--gutter);
  }
  .chamber {
    margin-top: 26px;
  }
  .chamber:first-child {
    margin-top: 6px;
  }
  .chamber-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 14px;
    background: var(--ink);
    color: var(--on-fill);
    border-radius: var(--radius);
    break-inside: avoid;
    break-after: avoid;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .chamber-n {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1.5px solid var(--on-fill);
    border-radius: 50%;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
  }
  .chamber-t {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .chamber-t b {
    font-family: var(--ui);
    font-size: 14.5px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .chamber-t small {
    font-size: 11px;
    opacity: 0.82;
    margin-top: 2px;
  }
  .senate-mode {
    display: inline-flex;
    border: 1px solid var(--line2);
    border-radius: var(--radius);
    overflow: hidden;
    margin: 14px 0 4px;
  }
  .senate-mode button {
    background: none;
    border: 0;
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink2);
    cursor: pointer;
  }
  .senate-mode button.on {
    background: var(--ink);
    color: var(--on-fill);
  }
  .senate-note {
    font-size: 12px;
    color: var(--ink2);
    line-height: 1.5;
    margin: 6px 0 8px;
  }
  .col {
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink3);
    padding: 12px 0 2px;
    margin: 0;
  }
  .rows {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .check {
    font-size: 12px;
    color: var(--ink2);
    margin: 10px 0 0;
  }
  .vintage {
    font-size: 11px;
    color: var(--ink3);
    padding-top: 12px;
    margin: 0;
  }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 16px var(--gutter) 4px;
  }
  .gated {
    grid-column: 1 / -1;
    font-size: 12.5px;
    color: var(--ink2);
    line-height: 1.5;
    margin: 0;
  }
  /* A lone action (share with no build button beside it) fills the row instead of a 50% column. */
  .actions .btn.span-full {
    grid-column: 1 / -1;
  }
  /* Under-18 explore mode (ADR 0012): shown in place of the build/share actions. */
  .advocacy {
    margin: 16px var(--gutter) 4px;
    padding: 14px 16px;
    border: 1.5px solid var(--rule);
    border-radius: var(--radius);
    background: var(--raise);
    font-size: 13.5px;
    color: var(--ink2);
    line-height: 1.55;
  }
  .advocacy :global(p) {
    margin: 0 0 10px;
  }
  /* The note's heading and its sub-heading, first and third of its paragraphs (CardAdvocacy). */
  .advocacy :global(p:first-child) {
    color: var(--ink);
    font-size: 15px;
  }
  .advocacy :global(p:nth-of-type(3)) {
    color: var(--ink);
    margin-top: 4px;
  }
  .advocacy :global(ul) {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .advocacy :global(a) {
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
    font-weight: 600;
  }
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 50px;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-fill);
    font-family: var(--ui);
    font-size: 15px;
    font-weight: 600;
    border: 0;
    cursor: pointer;
    text-decoration: none;
  }
  .btn.ghost {
    background: transparent;
    color: var(--ink);
    border: 1.5px solid var(--rule);
  }
  .worksheet-foot {
    padding: 14px var(--gutter) 0;
  }
  .worksheet-foot :global(p) {
    font-size: 11.5px;
    color: var(--ink2);
    line-height: 1.5;
    margin: 0 0 8px;
  }
  .save {
    padding: 10px var(--gutter) 2px;
  }
  .save-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    min-height: 44px;
    border: 1.5px dashed var(--line2);
    border-radius: var(--radius);
    background: none;
    color: var(--ink);
    font-family: var(--ui);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .save-btn.on {
    border-style: solid;
    border-color: var(--rule);
  }
  .save-note {
    font-size: 12px;
    color: var(--ink3);
    line-height: 1.5;
    margin: 8px 0 0;
    text-align: center;
  }
  .save-note :global(a) {
    color: var(--ink2);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .why {
    padding: 8px var(--gutter) 4px;
  }
  .why-toggle {
    background: none;
    border: 0;
    color: var(--ink2);
    font-size: 13.5px;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    padding: 8px 0;
  }
  .why-note {
    font-size: 12.5px;
    color: var(--ink2);
    margin: 4px 0 10px;
  }
  .evi {
    border-bottom: 1px solid var(--line);
    padding: 6px 0;
    font-size: 13px;
  }
  .evi summary {
    cursor: pointer;
  }
  .evi ul {
    margin: 8px 0 4px;
    padding-left: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .evi li {
    font-size: 12.5px;
    color: var(--ink2);
    line-height: 1.4;
    display: flex;
    gap: 8px;
  }
  .ag {
    flex: 0 0 66px;
    box-sizing: border-box;
    text-align: center;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border: 1px solid var(--line2);
    border-radius: 3px;
    padding: 1px 5px;
    height: fit-content;
    color: var(--ink2);
  }
  .q {
    flex: 1 1 auto;
    min-width: 0;
  }
  .rec {
    white-space: nowrap;
    font-size: 11.5px;
    color: var(--ink2);
    text-decoration: underline;
    text-underline-offset: 2px;
    margin-left: 4px;
  }
  .ag-opposed {
    border-style: dashed;
  }
  .ag-no-data {
    border-style: dotted;
  }
  .restart {
    text-align: center;
    padding: 10px var(--gutter) 4px;
    font-size: 13px;
  }
  .restart a {
    color: var(--ink2);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  /* "Make my own comparison" on a shared card is a button (it runs startFresh to wipe residual
     state) but reads like the sibling link — reset the native button chrome so it matches. */
  .restart-btn {
    appearance: none;
    border: 0;
    background: none;
    padding: 0;
    margin: 0;
    font: inherit;
    cursor: pointer;
    color: var(--ink2);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .restart-btn:hover {
    color: var(--ink);
  }

  /* Non-revocable share-link warning, shown before any copy/native share. */
  .share-warning {
    margin: 4px var(--gutter) 0;
    padding: 14px;
    border: 1.5px solid var(--rule);
    border-radius: var(--radius);
  }
  .share-warning p {
    font-size: 13px;
    color: var(--ink2);
    line-height: 1.55;
    margin: 0 0 10px;
  }
  .share-warning .sw-head {
    color: var(--ink);
    margin-bottom: 6px;
  }
  .sw-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  /* The printed authorisation stamp, its fail-safe counterpart and the archived watermark. All hidden
     on screen; shown only in @media print. The stamp is National Digital's authorisation of the
     material it publishes, rendered ONCE at the end of the document (not a per-page fixed footer), so
     the long operator entity name can never overflow a reserved foot area. */
  .print-stamp,
  .print-unauthorised,
  .print-watermark {
    display: none;
  }

  @media print {
    /* FAIL CLOSED: an unauthorised worksheet never reaches paper. A native Ctrl+P before the print is
       acknowledged prints nothing but the notice below. */
    .worksheet.print-locked {
      display: none !important;
    }
    /* Authorisation stamp — a bounded, legible block at the end of the document. `overflow-wrap`
       guards against the long operator legal name overflowing the page. */
    .print-stamp {
      display: block;
      margin: 12mm 12mm 0;
      padding: 8px 0 0;
      font-size: 11px;
      line-height: 1.4;
      text-align: center;
      color: #000;
      background: #fff;
      border-top: 0.75px solid #000;
      overflow-wrap: anywhere;
      word-break: break-word;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    /* An empty stamp must not render an empty bordered block (belt-and-braces alongside printAuthorised). */
    .print-stamp:empty {
      display: none;
    }
    /* The notice is the ONLY printed content on a blocked native print — a centred, legible block, so
       the reason the worksheet is absent is unmistakable. */
    .print-unauthorised {
      display: block;
      margin: 40mm 12mm 0;
      padding: 10mm;
      border: 1.5px solid #000;
      font-size: 12px;
      line-height: 1.5;
      text-align: center;
      color: #000;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    /* Archived-election watermark: a large, semi-transparent diagonal overlay fixed to the page, so it
       repeats on EVERY printed page of a historical demonstration. It sits above the worksheet but is
       non-interactive and does not affect the on-screen layout (display:none outside print). */
    .print-watermark {
      display: flex;
      align-items: center;
      justify-content: center;
      position: fixed;
      inset: 0;
      z-index: 9000;
      pointer-events: none;
      transform: rotate(-32deg);
      transform-origin: center;
      font-family: var(--ui);
      font-size: 34px;
      font-weight: 800;
      letter-spacing: 0.04em;
      line-height: 1.2;
      text-align: center;
      /* Large bold text, so it must clear WCAG AA 3:1 against the near-white worksheet (a faint tint
         does not — and this "NOT VALID FOR VOTING" stamp should be legible, not merely decorative).
         Black at 45% over the page resolves to a mid-grey that meets 3:1 while still reading as a
         diagonal watermark. */
      color: rgb(0 0 0 / 0.45);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }

  @media print {
    /* Print the voting plan as a clean worksheet: drop all controls and the global chrome, keep the
       numbered boxes and the worksheet footer. The global site footer is hidden here; the plan's own
       National Digital authorisation stamp is rendered once at the end of the document instead. */
    :global(.skip),
    :global(footer),
    .senate-mode,
    .actions,
    .advocacy,
    .save,
    .why,
    .restart,
    .hint {
      display: none !important;
    }
    :global(.moves) {
      display: none !important;
    }
    :global(body) {
      background: #fff;
      color: #000;
    }
    .chamber-head {
      background: #000;
      color: #fff;
    }
    .chamber-n {
      border-color: #fff;
    }
  }
</style>
