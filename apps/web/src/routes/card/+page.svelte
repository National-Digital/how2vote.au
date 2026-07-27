<script lang="ts">
  import { version } from "$app/environment";
  import { beforeNavigate, goto } from "$app/navigation";
  import { onDestroy, onMount, tick } from "svelte";
  import { electionPhase } from "@how2vote/data-schema";
  import {
    bandFor,
    decodeShare,
    encodeShare,
    encodeShareV2,
    evidenceFor,
    generateCard,
    shareElectionId,
    slugify,
    type Answer,
    type Card,
    type HouseBallotRow,
    type SenateBallotRow,
    type SenateGroupRow,
  } from "@how2vote/engine";
  import { ageGate } from "$lib/age.svelte";
  import PartyAlignmentPanel from "$lib/components/PartyAlignmentPanel.svelte";
  import {
    distinctPartyAlignments,
    PARTY_ALIGNMENT_QUALIFIER,
    type PartyAlignmentRow,
  } from "$lib/candidate-alignment";
  import { suspendedPartyKeys } from "$lib/corrections";
  import {
    hasCorrectionNotice,
    isBallotAvailable,
    isChamberAvailable,
    isDecodingAllowed,
    isElectionAvailable,
    isElectorateAvailable,
    isPrintingAllowed,
    suspendedPropositionIds,
  } from "$lib/governance";
  import Logo from "$lib/components/Logo.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import PlanRow from "$lib/components/PlanRow.svelte";
  import PrintAuthorisationDialog from "$lib/components/PrintAuthorisationDialog.svelte";
  import TermsGate from "$lib/components/TermsGate.svelte";
  import { NATIONAL_BALLOT, isElectorateLess, loadData, stateName, type Data } from "$lib/data";
  import { election } from "$lib/election.svelte";
  import { printAuth } from "$lib/print-auth.svelte";
  import { termsAcceptance } from "$lib/terms.svelte";
  import { CIVIC_LINKS, RESEARCH_MIN_AGE } from "$lib/org";
  import { moveDown, moveUp, planStatus, prefOf, setRank } from "$lib/plan";
  import { quiz } from "$lib/quiz.svelte";
  import { saved } from "$lib/saved.svelte";
  import { ogImageFor } from "$lib/seo";

  type Ready = { card: Card; answers: Answer[]; shared: boolean };

  // "unavailable" is the fail-closed governance state: the runtime kill-switch control
  // plane has suspended this election / electorate / ballot, or decoding, or is itself
  // tampered/unsigned — the card REFUSES rather than rendering a withdrawn capability.
  let status = $state<"loading" | "ready" | "error" | "archived-link" | "unavailable">("loading");
  let data = $state<Ready | null>(null);
  // The election this card belongs to, kept for the reactive governance gates below.
  let activeElectionId = $state<string | null>(null);
  // The loaded dataset, kept so "Why these numbers?" can pull per-candidate evidence on demand.
  let dataset = $state<Data["dataset"] | null>(null);

  // Two separated stages: Compare shows alignment as evidence in ballot order, nothing crowned;
  // Build is where the voter authors their own preference order from a blank ballot. A shared link
  // only ever shows Compare — it carries answers (a comparison), never a chosen order.
  let stage = $state<"compare" | "build">("compare");

  // Discriminated card session (see docs/adr/0010). The card is exactly one of:
  //   - shared-readonly     — opened from a share link; carries someone else's answers, never a
  //                           chosen order; can NEVER print (no owner capability, no build stage);
  //   - owner-session       — this browser built this card from its own in-progress quiz; may build
  //                           a plan and, after mandatory s321D authorisation, print it;
  //   - print-authorisation — an owner is entering their s321D particulars before a print.
  // It DEFAULTS to the least-privileged state so any bug fails closed to shared-readonly (which
  // cannot print) rather than to owner-session. The actual print permission is the in-memory
  // `printAuth.isOwner` capability (never persisted, never in a URL), asserted again at print time.
  type CardSession = "shared-readonly" | "owner-session" | "print-authorisation";
  let session = $state<CardSession>("shared-readonly");

  // Most voters vote above the line, so that is the default Senate view; below the line is one
  // toggle away. Only ever one method is shown/built at a time — marking both changes how the paper
  // is counted.
  let senateView = $state<"above" | "below">("above");
  let showWhy = $state(false);
  let copied = $state(false);
  // Versioned Terms-of-Use acceptance before any consequential action. A gated action
  // (build / share / print) that is requested before the CURRENT Terms version has been accepted is
  // held in `pendingAction`; the reusable TermsGate records the versioned acceptance and then the
  // held action runs. Separate from research consent, which has its own gate on the survey.
  let pendingAction = $state<null | "build" | "share" | "print">(null);
  // Non-revocable-link warning gate: once Terms are accepted, sharing still NEVER copies
  // straight away — share() opens this warning first, and only an explicit confirm inside it performs
  // the copy/native share, so a link can never leave this device before the user has been told it
  // cannot be recalled.
  let showShareWarning = $state(false);
  // The shareable path (with fragment) for this comparison — the key it's saved under on-device.
  let cardUrl = $state("");

  // The voter-authored orders, one per ballot/method. Each starts EMPTY — a blank ballot. A
  // candidate's preference is its 1-based index in its order (see $lib/plan); nothing is pre-filled.
  let houseOrder = $state<string[]>([]);
  let senateAboveOrder = $state<string[]>([]);
  let senateBelowOrder = $state<string[]>([]);

  /** Stable per-row id (candidate + printed position), used as the plan-order key. */
  const rowId = (candidate: string, position: number): string => `${candidate}|${position}`;

  // Governance kill-switch — proposition + chamber/ballot exclusion, applied when a card
  // is built so a suspended capability never renders on any surface (compare, build, or print).

  /** Drop answers to SUSPENDED propositions before scoring, so a withdrawn question never counts. */
  function withoutSuspendedPropositions(answers: Answer[], electionId: string): Answer[] {
    const suspended = suspendedPropositionIds(electionId);
    return suspended.size === 0 ? answers : answers.filter((a) => !suspended.has(a.id));
  }

  /**
   * Empty a chamber's rows when that chamber — or this card's specific ballot within it (House: the
   * electorate; Senate: the state) — is suspended, so neither the comparison nor the plan builder can
   * show or print a withdrawn ballot. Election/electorate-wide suspensions are handled earlier by the
   * "unavailable" state; this covers the finer chamber/ballot scopes.
   */
  function applyChamberSuspensions(card: Card, electionId: string, electorateSlug: string): Card {
    const houseOk =
      isChamberAvailable(electionId, "house") &&
      isBallotAvailable(electionId, "house", electorateSlug);
    const senateOk =
      isChamberAvailable(electionId, "senate") &&
      isBallotAvailable(electionId, "senate", card.state);
    if (houseOk && senateOk) return card;
    return {
      ...card,
      house: houseOk ? card.house : [],
      senate: senateOk ? card.senate : [],
      senateAboveLine: senateOk ? card.senateAboveLine : [],
    };
  }

  // Liveness guard: the async loadData continuation below can resolve AFTER the user has navigated
  // away. Cleared in onDestroy so a late resolution never mutates state or history.replaceState on a
  // page that is no longer mounted (pattern mirrors ElectorateMap.svelte).
  let live = true;
  onDestroy(() => {
    live = false;
  });

  onMount(() => {
    termsAcceptance.hydrate();
    // Old how2vote.com.au share links (?res=<id>) pointed at cards stored in that site's database,
    // which is gone — they can only be explained, not resolved.
    if (new URLSearchParams(window.location.search).has("res")) {
      status = "archived-link";
      return;
    }

    const hash = window.location.hash;
    const ownCard = !(hash && hash.length > 1);
    // Reading a shared comparison is legitimate without an in-progress quiz; only our own requires one.
    if (ownCard && !quiz.hasBallot) {
      goto("/ballot");
      return;
    }

    const electionId = ownCard ? election.id : shareElectionId(hash);
    if (!electionId) {
      status = "error";
      return;
    }
    if (!ownCard) election.set(electionId);

    void loadData(electionId)
      .then((d) => {
        if (!live) return; // navigated away before the dataset resolved — do not touch state/history
        const { electorateFromSlug, questionIds } = d;
        dataset = d.dataset;

        if (!ownCard) {
          // Fail-closed decode gate: if the `decoding` scope (or this election) is
          // suspended, or the control plane is tampered, we NEVER decode the fragment — a shared link
          // simply cannot be opened while decoding is withdrawn.
          if (!isDecodingAllowed(electionId)) {
            status = "unavailable";
            return;
          }
          // A shared comparison: reconstruct entirely from the fragment (no server, works offline).
          // A provisional (upcoming) quiz uses the version-pinned v2 codec: decodeShare fails closed
          // unless the election's CURRENT dataVersion still matches the link, so a changed quiz shows
          // "start again" rather than silently rebinding stale answers.
          const decoded = decodeShare(
            hash,
            (id) => (id === electionId ? questionIds : undefined),
            (id) => (id === electionId ? d.dataset.questions.dataVersion : undefined),
          );
          if (!decoded) {
            status = "error";
            return;
          }
          // An electorate-less (provisional) election has no ballot to resolve a slug against: the
          // comparison is party-level only, so use the sentinel national selection.
          const electorate = isElectorateLess(d.dataset)
            ? { state: NATIONAL_BALLOT.state, electorate: NATIONAL_BALLOT.electorate }
            : electorateFromSlug(decoded.electorateSlug);
          if (!electorate) {
            status = "error";
            return;
          }
          // Election / electorate suspension (or a tampered plane) makes this card unavailable.
          if (
            !isElectionAvailable(electionId) ||
            !isElectorateAvailable(electionId, decoded.electorateSlug)
          ) {
            status = "unavailable";
            return;
          }
          const answers = decoded.answers;
          const card = applyChamberSuspensions(
            generateCard(d.dataset, {
              state: electorate.state,
              electorate: electorate.electorate,
              answers: withoutSuspendedPropositions(answers, electionId),
              suspended: suspendedPartyKeys(electionId),
            }),
            electionId,
            decoded.electorateSlug,
          );
          activeElectionId = electionId;
          data = { card, answers, shared: true };
          cardUrl = window.location.pathname + window.location.hash;
          // A shared link is read-only: drop any stale owner capability so it can never print.
          session = "shared-readonly";
          printAuth.reset();
          status = "ready";
          return;
        }

        // Our own comparison, from the in-progress quiz for the active election. Progress tracks
        // the answerable (active) questions; the share fragment stays positional over the full
        // codec list so a withdrawal never shifts previously shared payloads.
        quiz.syncQuestions(d.activeQuestionIds);
        const answers = quiz.toAnswers();
        const electorateSlug = slugify(quiz.electorate!);
        // Election / electorate suspension (or a tampered plane) makes this card unavailable, even for
        // its owner building from their own quiz.
        if (
          !isElectionAvailable(electionId) ||
          !isElectorateAvailable(electionId, electorateSlug)
        ) {
          status = "unavailable";
          return;
        }
        const card = applyChamberSuspensions(
          generateCard(d.dataset, {
            state: quiz.state!,
            electorate: quiz.electorate!,
            answers: withoutSuspendedPropositions(answers, electionId),
            suspended: suspendedPartyKeys(electionId),
          }),
          electionId,
          electorateSlug,
        );
        activeElectionId = electionId;
        data = { card, answers, shared: false };
        // This browser built this card from its own quiz: claim the in-memory owner capability that
        // (and only that) permits a print. It lives in memory only, is never persisted or put in a
        // URL, and is lost on reload — a reloaded /card#… link comes back as shared-readonly.
        session = "owner-session";
        printAuth.claimOwnership();
        status = "ready";
        // Make the URL shareable without a navigation (carries the election id + answers, no order).
        // A provisional (upcoming) quiz can still change, so it uses the version-pinned v2 codec: the
        // link stamps the dataVersion and stops decoding once the quiz changes (fail closed to "start
        // again"). A live/archived election keeps the durable positional v1 codec.
        const fragment =
          electionPhase(election.meta) === "upcoming"
            ? encodeShareV2(
                { electorate: quiz.electorate!, answers },
                questionIds,
                electionId,
                d.dataset.questions.dataVersion,
              )
            : encodeShare({ electorate: quiz.electorate!, answers }, questionIds, electionId);
        history.replaceState(history.state, "", `/card#${fragment}`);
        cardUrl = `/card#${fragment}`;
      })
      .catch(() => {
        // A transient dataset import/fetch failure must surface an error state, not hang on "loading"
        // forever (loadData now evicts the rejected promise, so a reload retries cleanly).
        status = "error";
      });
  });

  // An electorate-less (provisional) election ships no ballot, so there are no candidate rows to
  // derive the party panel from. The comparison is party-level only, sourced straight from the
  // per-party percentages: show the registered PARTIES (single-member independents are a
  // per-electorate concern a national, ballot-less comparison does not rank).
  const electorateLess = $derived(dataset ? isElectorateLess(dataset) : false);
  const allPartyAlignments = $derived.by(() => {
    if (!data || !dataset || !activeElectionId) return [];
    const suspended = suspendedPartyKeys(activeElectionId);
    const byKey = new Map(dataset.parties.parties.map((p) => [p.key, p]));
    // Parties off the AEC register (deregistered/renamed) cannot contest, so they are removed from the
    // ballot-less comparison entirely — never shown as an option for the next election.
    const deregistered = new Set((dataset.parties.deregistered ?? []).map((d) => d.key));
    const rows: PartyAlignmentRow[] = [];
    for (const [key, score] of data.card.percentages) {
      const party = byKey.get(key);
      if (!party || party.kind !== "party" || deregistered.has(key)) continue;
      const isSusp = suspended.has(key);
      const s = isSusp ? -1 : score;
      rows.push({
        party: party.displayName,
        partyKey: key,
        score: s,
        band: bandFor(s),
        suspended: isSusp,
        // A registered family (e.g. the Coalition brands) is shown together in the panel — each
        // still keeps its own figure. Only carried for the ballot-less panel; the House/Senate
        // ballot panels stay in ballot order and never regroup.
        ...(party.federalGroup ? { federalGroup: party.federalGroup } : {}),
        ...(party.region ? { region: party.region } : {}),
      });
    }
    return distinctPartyAlignments(rows);
  });

  const metaTitle = $derived(
    status === "archived-link"
      ? "A card from the old How2Vote"
      : data
        ? electorateLess
          ? "The current Parliament — How2Vote comparison"
          : `${data.card.electorate} — How2Vote ${election.meta.year} comparison`
        : undefined,
  );

  // On-device save (explicit, never automatic). Reactive to the store so the label flips instantly.
  const isSaved = $derived(cardUrl !== "" && saved.has(cardUrl));

  function toggleSave(): void {
    // Saving a comparison on-device is a vote-capable capability (ADR 0012): an under-18 explorer
    // gets a session-only result, nothing persisted. Fail closed — the UI already hides the control.
    if (!ageGate.canVote) return;
    if (!data || !cardUrl) return;
    if (saved.has(cardUrl)) saved.remove(cardUrl);
    else saved.save({ url: cardUrl, electorate: data.card.electorate, state: data.card.state });
  }

  const house = $derived<HouseBallotRow[]>(data ? data.card.house : []);
  const senate = $derived<SenateBallotRow[]>(data ? data.card.senate : []);
  const senateAtl = $derived<SenateGroupRow[]>(data ? data.card.senateAboveLine : []);
  const senateGroups = $derived([
    ...new Map(senate.map((r) => [r.group, senate.filter((s) => s.group === r.group)])).entries(),
  ]);

  // Party-level alignment panels — the ONLY place a figure is shown. Alignment is a property of the
  // PARTY, so it is derived per DISTINCT party and never attached to a candidate row.
  //   - House: dedupe the candidate rows by partyKey; independents (null partyKey) have no party
  //     record and are dropped from the panel (they still appear in the neutral ballot list).
  //   - Senate: the above-the-line groups are already party/group-level, so they ARE the party panel.
  // Each derived party object explicitly carries partyKey + suspended so the fail-closed independent /
  // suspension treatments reach alignmentPresentation() inside the panel.
  const houseParties = $derived(
    distinctPartyAlignments(
      house.map((r) => ({
        party: r.party,
        partyKey: r.partyKey,
        score: r.score,
        band: r.band,
        suspended: r.suspended,
      })),
    ),
  );
  const senateParties = $derived(
    distinctPartyAlignments(
      senateAtl.map((r) => ({
        party: r.party,
        partyKey: r.partyKey,
        score: r.score,
        band: r.band,
        suspended: r.suspended,
      })),
    ),
  );

  // The parties the "Why do these parties align?" evidence lists, matching whichever alignment panel
  // is actually on screen. The ballot-less (provisional) flow shows `allPartyAlignments` (derived
  // from the per-party percentages), NOT `houseParties` — which is empty with no ballot, so the
  // evidence section rendered blank when it iterated houseParties directly.
  const evidenceParties = $derived(electorateLess ? allPartyAlignments : houseParties);

  // Ballot-order id lists per ballot, for the plan reducers and the mechanical check.
  const houseIds = $derived(house.map((r) => rowId(r.candidate, r.position)));
  const senateAboveIds = $derived(senateAtl.map((r) => r.group));
  const senateBelowIds = $derived(senate.map((r) => rowId(r.candidate, r.position)));

  const houseStatus = $derived(planStatus(houseOrder, houseIds));
  const senateAboveStatus = $derived(planStatus(senateAboveOrder, senateAboveIds));
  const senateBelowStatus = $derived(planStatus(senateBelowOrder, senateBelowIds));

  // Territory (ACT/NT) Senate papers carry different numbering minimums, so the "at least 6 / 12"
  // guidance is shown only for states; territories defer to the ballot.
  const isTerritory = $derived(
    data ? data.card.state === "ACT" || data.card.state === "NT" : false,
  );

  // Lifecycle phase, derived deterministically from the polling day + verified ballot-final flag
  // (never the `current` toggle). Archived = polling day passed → historical demonstration.
  const phase = $derived(data ? electionPhase(election.meta) : "upcoming");
  const isArchived = $derived(phase === "archived");

  // Ballot-order gating: the plan builder opens for a live or an archived
  // election, but stays closed for an `upcoming` one until its official candidate list and ballot
  // order are final and verified. An archived election's builder is a clearly-labelled historical
  // demonstration (see the banner + build-stage copy below), never an instruction for a live vote.
  // The printing capability is now the runtime kill-switch: global `printing` (the former
  // EXPORTS_ENABLED lever), this election, or this electorate can each be suspended, and a tampered
  // control plane refuses printing outright (fail closed).
  const plansEnabled = $derived(
    data && activeElectionId
      ? isPrintingAllowed(activeElectionId, slugify(data.card.electorate)) && phase !== "upcoming"
      : false,
  );

  // "Under review" correction banner: a granular suspension (withdrawn mapping /
  // proposition, or a suspended chamber/ballot) is affecting what this card shows.
  const correctionNotice = $derived(
    data && activeElectionId
      ? hasCorrectionNotice(activeElectionId, slugify(data.card.electorate))
      : false,
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

  // Creating a share link is a consequential action, so it requires a current-version Terms
  // acceptance first. If already accepted we share straight away; otherwise the gate is
  // shown and the share runs only once the visitor accepts.
  function requestShare(): void {
    // Sharing produces a link others open — a vote-capable action, 18+ only (ADR 0012). Fail closed.
    if (!ageGate.canVote) return;
    if (termsAcceptance.accepted) void share();
    else pendingAction = "share";
  }

  // Terms are accepted by now; show the non-revocable-link warning before anything is copied/shared.
  // The actual copy happens only from copyShareLink(), reached by an explicit confirm.
  function share(): void {
    showShareWarning = true;
  }

  // Actually copy/share the link — reached ONLY from the non-revocable warning's confirm,
  // i.e. after the user has been told the link cannot be recalled.
  async function copyShareLink(): Promise<void> {
    showShareWarning = false;
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: "My How2Vote comparison", url });
        return;
      } catch {
        /* cancelled — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
      window.setTimeout(() => (copied = false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  // Making your own from a shared card starts a CLEAN session — wipe any in-progress quiz that a
  // previous session left on this device first so nothing carries over, then send the
  // visitor to the blank ballot.
  function startFresh(): void {
    quiz.reset();
    void goto("/ballot");
  }

  // "Why do I align with these candidates?" — evidence for each scored House candidate (the
  // receipts). Each question's id is its They Vote For You policy id, so it links to the record.
  const TVFY_POLICY = "https://theyvoteforyou.org.au/policies";
  function evidence(partyKey: string | null) {
    if (!partyKey || !data || !dataset) return [];
    // Exclude any SUSPENDED proposition here too, so a withdrawn question never surfaces
    // in the evidence detail even though the stable share payload still carries the raw answer.
    const answers = activeElectionId
      ? withoutSuspendedPropositions(data.answers, activeElectionId)
      : data.answers;
    return evidenceFor(dataset, partyKey, answers).filter((l) => l.agreement !== "skipped");
  }

  const vintage = $derived(
    new Date(election.manifest.dataVersion).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  );
  // Withdrawn questions are disabled outputs (ADR 0005): excluded from scoring and presentation,
  // disclosed here and listed on /corrections.
  const withdrawnCount = $derived(
    dataset ? dataset.questions.questions.filter((q) => q.withdrawn !== undefined).length : 0,
  );
  // Date the plan is built/printed — recorded on the worksheet so a stale printout is obvious.
  const builtOn = $derived(
    new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }),
  );

  // "Build my voting plan" — a plan-creation action, so it requires a current-version Terms
  // acceptance. If already accepted we go straight to the builder; otherwise the gate is
  // shown and the build begins only once the visitor accepts.
  function requestBuild(): void {
    // The plan builder is the how-to-vote card — a vote-capable capability, 18+ only (ADR 0012). An
    // under-18 explorer never reaches this (the button is replaced by the advocacy note); guard anyway.
    if (!ageGate.canVote) return;
    if (termsAcceptance.accepted) startBuild();
    else pendingAction = "build";
  }

  // The reusable TermsGate has recorded a current-version acceptance; run whichever action was held.
  function onTermsAccepted(): void {
    const action = pendingAction;
    pendingAction = null;
    if (action === "build") startBuild();
    else if (action === "share") void share();
    else if (action === "print") openPrintAuthorisation();
  }

  function startBuild(): void {
    // Fail closed: the build stage is the how-to-vote card, never opened for an under-18 (ADR 0012).
    if (!ageGate.canVote) return;
    stage = "build";
    window.scrollTo({ top: 0 });
  }

  // The stamp actually PRINTED on the plan — National Digital's authorisation plus the "preference
  // order selected by the user" notice — non-empty ONLY once the voter has acknowledged the print,
  // so a mid-form native (Ctrl+P) print never carries an un-acknowledged authorisation stamp.
  const authStamp = $derived(printAuth.stamp);
  // Fail-safe for a native (Ctrl+P) print that side-steps the in-app gate: until the print is
  // acknowledged, the printed worksheet carries a clear "not authorised" notice instead, so no
  // unauthorised how-to-vote material can be produced without being marked as such.
  const printAuthorised = $derived(printAuth.acknowledged);

  // Print acknowledgement gate (National Digital authoriser model; see docs/adr/0010). Printing is
  // NEVER wired directly to window.print(): the only path to a print is through this gate, and only an
  // owner session that actually holds the in-memory capability can open it. A shared-readonly card
  // can never get here.
  function requestPrint(): void {
    // Printing a how-to-vote card is vote-capable, 18+ only (ADR 0012). An under-18 can never reach
    // the build stage that hosts the print action, but fail closed here regardless.
    if (!ageGate.canVote) return;
    if (session !== "owner-session" || !printAuth.isOwner) return;
    // Printing is a consequential action, so it also requires a current-version Terms acceptance,
    // asserted here before the print acknowledgement gate opens.
    if (!termsAcceptance.accepted) {
      pendingAction = "print";
      return;
    }
    openPrintAuthorisation();
  }

  function openPrintAuthorisation(): void {
    if (!ageGate.canVote) return;
    if (session !== "owner-session" || !printAuth.isOwner || !termsAcceptance.accepted) return;
    printAuth.clearAcknowledgement();
    session = "print-authorisation";
  }

  function cancelPrint(): void {
    printAuth.clearAcknowledgement();
    session = "owner-session";
  }

  async function confirmPrint(): Promise<void> {
    // Fail closed: re-assert the owner capability before printing. The acknowledgement is enforced by
    // the dialog's confirm button, which only invokes this once the declaration is ticked.
    if (session !== "print-authorisation" || !printAuth.isOwner) return;
    // Acknowledge the print — only NOW does the printed authorisation stamp become non-empty.
    printAuth.acknowledge();
    // Close the acknowledgement screen so the WORKSHEET (not the modal) is what prints; the
    // authorisation stamp is rendered once at the end of the document.
    session = "owner-session";
    await tick();
    window.print();
    // Belt-and-braces: also clear here in case a browser fires no `afterprint`.
    printAuth.clearAcknowledgement();
  }
</script>

<Meta title={metaTitle} image={ogImageFor(election.id)} />

{#if status === "loading"}
  <p class="pad ui">Preparing your comparison…</p>
{:else if status === "archived-link"}
  <div class="pad archived-link">
    <p class="kicker ui">A link from the old how2vote.com.au</p>
    <h1>This card can't be opened any more</h1>
    <p class="ui note">
      This link points to a How2Vote card made on our old site. Cards made there were stored on that
      site's server, which has since been retired — so the card behind this link can't be retrieved.
    </p>
    <p class="ui note">
      Today, How2Vote works differently: your answers travel in the link itself, nothing is stored
      on a server, and a shared comparison keeps working — even offline.
    </p>
    <a class="btn" href="/ballot">Make a new card</a>
  </div>
{:else if status === "error"}
  <div class="pad">
    <h1>That link didn't work</h1>
    <p class="ui note">We couldn't read the comparison from this link. You can build your own.</p>
    <a class="btn" href="/ballot">Start</a>
  </div>
{:else if status === "unavailable"}
  <!-- Fail-closed governance state: a capability this card needs has been suspended by
       the signed runtime kill-switch control plane (or the plane is tampered/unsigned). We refuse to
       render rather than show a withdrawn ballot / comparison. -->
  <div class="pad">
    <h1>Temporarily unavailable</h1>
    <p class="ui note">
      This comparison is temporarily unavailable while it is under review. This is a precaution —
      the material has been withdrawn until a check is complete. Please try again later.
    </p>
    <a class="btn" href="/">Back to home</a>
  </div>
{:else if data}
  <div class="card-head">
    <div class="ch-top ui">
      <a class="home" href="/" aria-label="How2Vote home"><Logo size="sm" /></a>
      <span
        >{stage === "build"
          ? isArchived
            ? "Historical demonstration plan"
            : "Your voting plan"
          : "Your comparison"}</span
      >
    </div>
    <h1>
      {#if electorateLess}The current Parliament{:else}{data.card.electorate}<span class="st ui">
          · {stateName(data.card.state)}</span
        >{/if}
    </h1>
  </div>

  <!-- Persistent historical-use warning. Shown on both stages and, deliberately, on the
       printed worksheet — an archived election's plan is a demonstration, never a live instruction. -->
  {#if isArchived}
    <div class="archive-banner ui" role="note">
      <b>Historical demonstration — {election.meta.label}.</b> This election has already been held.
      What you see and build here is a retrospective demonstration using the {election.meta.year}
      candidates and ballot as they stood then, scored on the parliamentary record of the time. It is
      not current and cannot be used to vote.
    </div>
  {/if}

  <!-- "Under review" correction banner: a granular kill-switch suspension is affecting
       what this card shows — a withdrawn party alignment / proposition, or a suspended ballot. The
       affected figures are already withheld by the engine + card build above; this explains why. -->
  {#if correctionNotice}
    <div class="archive-banner ui" role="note">
      <b>Some figures are under review.</b> One or more items on this card have been temporarily withdrawn
      while a correction or right-of-reply is assessed. They are shown as unavailable rather than left
      standing, and will return once the review is complete.
    </div>
  {/if}

  {#if stage === "compare"}
    <p class="hint ui pad-x">
      {#if electorateLess}
        This shows how often the <b>parties'</b> recorded votes in the current Parliament align with
        your answers — as <b>evidence only</b>. The next election hasn't been announced, so there
        are no candidates or ballot yet; this is a provisional comparison against the parties, not a
        recommendation.
      {:else}
        For each chamber, this shows how often the <b>parties'</b> recorded votes align with your
        answers — as <b>evidence only</b>. Nothing here is ranked or recommended: How2Vote does not
        tell you who to put first. When you're ready, you build your own order.
      {/if}
    </p>
    <!-- Candidate-level predictive-claim limit, shown next to the scores, not only in the
         Terms — a party record is not evidence of a candidate's own views or future votes. Single-
         sourced from $lib/candidate-alignment so the visible copy, the per-row wording and the
         guard can never drift apart. -->
    <p class="disclaimer ui pad-x">{PARTY_ALIGNMENT_QUALIFIER}</p>

    <section class="ballot">
      {#if electorateLess}
        <!-- No ballot yet (provisional/upcoming): there is no House/Senate split to show, so the
             comparison is a single party voting-record panel sourced from the per-party percentages
             (the current Parliament's record), not from candidate rows. -->
        <div class="chamber">
          <header class="chamber-head ui">
            <span class="chamber-n" aria-hidden="true">✓</span>
            <span class="chamber-t">
              <b>Party voting-record alignment</b>
              <small>Current Parliament · House and Senate combined</small>
            </span>
          </header>
          <PartyAlignmentPanel
            parties={allPartyAlignments}
            caption="Party voting-record alignment (current Parliament)"
            ballotOrdered={false}
          />
        </div>
      {:else}
        <div class="chamber">
          <header class="chamber-head ui">
            <span class="chamber-n" aria-hidden="true">1</span>
            <span class="chamber-t">
              <b>House of Representatives</b>
              <small>Green ballot paper · your local member</small>
            </span>
          </header>
          <!-- The results screen shows party voting-record alignment only — no candidate list. A
               ballot order shown here, with no selection against it, reads as a ranking; the ballot
               (with blank preference boxes) belongs in the build stage, where the voter authors it. -->
          <PartyAlignmentPanel
            parties={houseParties}
            caption="Party voting-record alignment (House parties)"
          />
        </div>

        <div class="chamber">
          <header class="chamber-head ui">
            <span class="chamber-n" aria-hidden="true">2</span>
            <span class="chamber-t">
              <b>Senate</b>
              <small>White ballot paper · {stateName(data.card.state)}</small>
            </span>
          </header>

          <!-- Party alignment only here too. The Senate above-the-line groups ARE party/group-level,
               so the party panel is the whole surface; above/below-the-line ballot order belongs in
               the build stage, where the voter numbers it themselves. -->
          <PartyAlignmentPanel
            parties={senateParties}
            caption="Party voting-record alignment (Senate groups)"
          />
        </div>
      {/if}
    </section>

    <p class="vintage ui pad-x">
      Compared against parliamentary <a href="/glossary#division">divisions</a> up to {vintage}.{#if isArchived}{" "}This
        is a historical comparison for the {election.meta.year} election, not a current recommendation.{/if}
      {#if withdrawnCount > 0}{" "}{withdrawnCount === 1
          ? "One question has been withdrawn pending correction and is excluded from this comparison"
          : `${withdrawnCount} questions have been withdrawn pending correction and are excluded from this comparison`}
        — see <a href="/corrections">corrections</a>.{/if}
    </p>

    {#if ageGate.canVote}
      <div class="actions ui">
        {#if data.shared}
          <!-- A shared comparison is someone else's answers: it stays comparison-only, and the
               recipient is directed to make their own (the link below). Building a plan on top of
               another person's comparison is deliberately not offered. -->
          <p class="gated ui">
            This is a shared comparison. To build your own voting plan, make your own comparison
            first.
          </p>
        {:else if plansEnabled}
          <button type="button" class="btn" onclick={requestBuild}>
            {isArchived ? "Build a demonstration plan" : "Build my voting plan"}
          </button>
        {:else}
          <p class="gated ui">
            Building a printable voting plan is not available right now. It becomes available once
            this election's official candidate list and ballot order are confirmed and verified and
            the printable-plan feature is switched on.
          </p>
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
            class:span-full={!plansEnabled}
            onclick={requestShare}
            aria-expanded={showShareWarning}
            aria-controls="share-warning"
          >
            {copied ? "Link copied ✓" : "Share this comparison"}
          </button>
        {/if}
      </div>
    {:else}
      <!-- Under-18 explore mode (ADR 0012): the comparison IS the result. No how-to-vote card is
           built, printed, shared or saved for someone too young to vote — that would be electoral
           material for a non-voter. Point to lawful, non-partisan ways to take part instead. -->
      <div class="advocacy ui" role="note">
        <p class="adv-head">
          <b>This comparison is yours to explore — How2Vote won't build you a how-to-vote plan.</b>
        </p>
        <p>
          You told us you're under {RESEARCH_MIN_AGE}, so you can't vote at a federal election yet,
          and a how-to-vote card is material for casting a vote. The comparison above still shows
          how your answers line up with the parties' recorded votes. When you're old enough to vote,
          come back and build your plan.
        </p>
        <p class="adv-sub"><b>Want your voice heard now?</b></p>
        <ul>
          <li>
            <a href={CIVIC_LINKS.enrol} target="_blank" rel="noopener noreferrer">
              Enrol early with the AEC ↗
            </a>
            — at 16 or 17 you can provisionally enrol, so you're ready to vote the day you turn {RESEARCH_MIN_AGE}.
          </li>
          <li>
            <a href={CIVIC_LINKS.findMember} target="_blank" rel="noopener noreferrer">
              {electorateLess
                ? "Contact your local federal member ↗"
                : `Contact the member for ${data.card.electorate} ↗`}
            </a>
            — tell the person who represents your area what matters to you.
          </li>
          <li>
            <a href={CIVIC_LINKS.votingRecord} target="_blank" rel="noopener noreferrer">
              See how Parliament has voted ↗
            </a>
            — the parliamentary records behind this quiz, on They Vote For You.
          </li>
        </ul>
      </div>
    {/if}

    {#if pendingAction}
      <!-- Versioned Terms acceptance before a build / share / print. Separate from
           research consent, which has its own gate on the survey. -->
      <TermsGate onaccept={onTermsAccepted} oncancel={() => (pendingAction = null)} />
    {/if}

    {#if showShareWarning}
      <!-- Non-revocable-link warning, shown BEFORE any copy/share. The link carries the
           answers in its own fragment and lives on no server of ours, so it cannot be expired or
           recalled once sent — the user is told this and must confirm before the link is copied. -->
      <div class="share-warning ui" id="share-warning" role="group" aria-label="Before you share">
        <p class="sw-head"><b>This link can't be recalled</b></p>
        <p>
          Your share link contains your answers and <b>does not expire</b>. Anyone you send it to
          can open this comparison, and you <b>cannot deactivate or recall it</b> afterwards — clearing
          your own device does not remove a copy someone else already has. Only share it with people you
          choose.
        </p>
        <div class="sw-actions">
          <button type="button" class="btn" onclick={copyShareLink}>Copy link</button>
          <button type="button" class="btn ghost" onclick={() => (showShareWarning = false)}>
            Cancel
          </button>
        </div>
      </div>
    {/if}

    {#if cardUrl && ageGate.canVote && !data.shared}
      <div class="save ui">
        <button type="button" class="save-btn" class:on={isSaved} onclick={toggleSave}>
          {isSaved ? "Saved on this device ✓" : "Save on this device"}
        </button>
        <p class="save-note">
          {#if isSaved}
            Kept only in this browser, never uploaded.
            <a href="/saved">Your saved comparisons</a>
          {:else}
            Kept only in this browser, on this device — never uploaded, and yours to delete any
            time.
          {/if}
        </p>
      </div>
    {/if}

    <div class="why ui">
      <button
        type="button"
        class="why-toggle"
        onclick={() => (showWhy = !showWhy)}
        aria-expanded={showWhy}
      >
        {showWhy ? "Hide the evidence" : "Why do these parties align with my answers?"}
      </button>
      {#if showWhy}
        <p class="why-note">
          Each figure compares your answers with that <b>party's</b> recorded parliamentary votes — not
          any individual candidate's personal views. Independents and any party whose alignment is under
          review for a correction are not shown a figure.
        </p>
        {#each evidenceParties.filter((p) => !p.suspended) as p (p.partyKey)}
          <details class="evi">
            <summary>
              <b>{p.party}</b> — {p.score < 0
                ? "no recorded party votes"
                : `${p.score}% party alignment`}
            </summary>
            <ul>
              {#each evidence(p.partyKey) as line (line.questionId)}
                <li>
                  <span class="ag ag-{line.agreement}">{line.agreement}</span>
                  <span class="q">
                    {line.question}
                    <a
                      class="rec"
                      href="{TVFY_POLICY}/{line.questionId}"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="See the parliamentary voting record for “{line.question}” on They Vote For You"
                    >
                      record&nbsp;↗
                    </a>
                  </span>
                </li>
              {/each}
            </ul>
          </details>
        {/each}
      {/if}
    </div>

    {#if !data.shared}
      <p class="restart ui"><a href="/review">Change my answers</a></p>
    {:else}
      <!-- Making your own from a shared card starts a CLEAN session — startFresh() wipes any
           in-progress quiz on this device first so nothing carries over. -->
      <p class="restart ui">
        <button type="button" class="restart-btn" onclick={startFresh}>
          Make my own comparison
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
        {#if isArchived}
          <p>
            <b>These numbers are your choice.</b> How2Vote does not recommend a candidate or a
            preference order — every box starts blank and you decide each number. This is a
            historical demonstration of the {election.meta.year} ballot: the election is over, this is
            not a ballot paper, and it cannot be used to vote.
          </p>
        {:else}
          <p>
            <b>These numbers are your choice.</b> How2Vote does not recommend a candidate or a preference
            order — every box starts blank and you decide each number. A voting plan is not a ballot paper:
            copy your numbers onto the official paper at the polling place and follow the AEC's instructions.
          </p>
        {/if}
        <p class="ack-order">
          The candidates below are listed in the same order as the official ballot paper — so you
          can match each one box for box. That order is the ballot's, not a ranking by How2Vote.
        </p>
      </div>

      <section class="ballot">
        <div class="chamber">
          <header class="chamber-head ui">
            <span class="chamber-n" aria-hidden="true">1</span>
            <span class="chamber-t">
              <b>House of Representatives</b>
              <small>Green ballot paper · number every box</small>
            </span>
          </header>
          <ol class="rows">
            {#each house as r (r.candidate + r.position)}
              {@const id = rowId(r.candidate, r.position)}
              <PlanRow
                uid={`h-${id}`}
                candidate={r.candidate}
                party={r.party}
                pref={prefOf(houseOrder, id)}
                total={houseIds.length}
                onset={(n) => (houseOrder = setRank(houseOrder, id, n, houseIds.length))}
                onup={() => (houseOrder = moveUp(houseOrder, id))}
                ondown={() => (houseOrder = moveDown(houseOrder, id))}
              />
            {/each}
          </ol>
          <p class="check ui" role="status">
            {#if houseStatus.complete}
              All {houseStatus.total} boxes numbered. Check them against your ballot paper.
            {:else}
              {houseStatus.ranked} of {houseStatus.total} numbered — number every box for a formal House
              vote.
            {/if}
          </p>
        </div>

        <div class="chamber">
          <header class="chamber-head ui">
            <span class="chamber-n" aria-hidden="true">2</span>
            <span class="chamber-t">
              <b>Senate</b>
              <small>White ballot paper · {stateName(data.card.state)}</small>
            </span>
          </header>

          <div class="senate-mode ui" role="group" aria-label="Senate voting method">
            <button
              type="button"
              class:on={senateView === "above"}
              aria-pressed={senateView === "above"}
              onclick={() => (senateView = "above")}
            >
              Above the line
            </button>
            <button
              type="button"
              class:on={senateView === "below"}
              aria-pressed={senateView === "below"}
              onclick={() => (senateView = "below")}
            >
              Below the line
            </button>
          </div>
          <p class="senate-note ui">
            Choose one method only — if you number above the line, leave the boxes below it blank.
          </p>

          {#if senateView === "above"}
            <ol class="rows">
              {#each senateAtl as r (r.group)}
                <PlanRow
                  uid={`sa-${r.group}`}
                  candidate={r.party || `Group ${r.group}`}
                  party={`Column ${r.group} · ${r.candidates} candidate${r.candidates === 1 ? "" : "s"}`}
                  pref={prefOf(senateAboveOrder, r.group)}
                  total={senateAboveIds.length}
                  onset={(n) =>
                    (senateAboveOrder = setRank(
                      senateAboveOrder,
                      r.group,
                      n,
                      senateAboveIds.length,
                    ))}
                  onup={() => (senateAboveOrder = moveUp(senateAboveOrder, r.group))}
                  ondown={() => (senateAboveOrder = moveDown(senateAboveOrder, r.group))}
                />
              {/each}
            </ol>
            <p class="check ui" role="status">
              {senateAboveStatus.ranked} numbered{#if !isTerritory}
                — number at least 6 boxes above the line{/if}.
            </p>
          {:else}
            {#each senateGroups as [group, rows] (group)}
              <p class="col ui">Column {group}</p>
              <ol class="rows">
                {#each rows as r (r.candidate + r.position)}
                  {@const id = rowId(r.candidate, r.position)}
                  <PlanRow
                    uid={`sb-${id}`}
                    candidate={r.candidate}
                    party={r.party}
                    pref={prefOf(senateBelowOrder, id)}
                    total={senateBelowIds.length}
                    onset={(n) =>
                      (senateBelowOrder = setRank(senateBelowOrder, id, n, senateBelowIds.length))}
                    onup={() => (senateBelowOrder = moveUp(senateBelowOrder, id))}
                    ondown={() => (senateBelowOrder = moveDown(senateBelowOrder, id))}
                  />
                {/each}
              </ol>
            {/each}
            <p class="check ui" role="status">
              {senateBelowStatus.ranked} numbered{#if !isTerritory}
                — number at least 12 boxes below the line{/if}.
            </p>
          {/if}
        </div>
      </section>

      <!-- Worksheet footer — travels with the printed plan. Carries the accuracy warning, jurisdiction,
         build date and data/method versions, and the statement that the PREFERENCE ORDER IS THE
         USER'S. National Digital's electoral authorisation of the material it publishes is stamped
         once at the end of the document (National Digital authoriser model; docs/adr/0010). -->
      <div class="worksheet-foot ui">
        <p>
          <b>Preference order selected by the user.</b> You chose every number — How2Vote does not recommend
          a candidate or a preference order. This how-to-vote plan is published and authorised by National
          Digital, which authorises the fixed plan template and comparison it contains. A voting plan
          is not a ballot paper and does not cast a vote.
        </p>
        <p>
          Built {builtOn} · {election.meta.label} (AEC) · data {election.manifest.dataVersion} · app
          {version}.
          {#if isArchived}
            This is a historical demonstration of an election that has already been held — it cannot
            be used to vote.
          {:else}
            Candidates and ballot order can change — always check your actual ballot paper and the
            current AEC instructions before voting.
          {/if}
        </p>
        <!-- Data attribution travels with the printed worksheet (ODbL/AEC obligation): the worksheet
             footer is NOT hidden in print, so the required credits appear on the printed output too. -->
        <p class="worksheet-attribution">
          Vote data © {data.card.attribution}. Candidates and ballot: Australian Electoral
          Commission.
        </p>
      </div>

      <div class="actions ui">
        <button type="button" class="btn" onclick={requestPrint}>
          {isArchived ? "Print this demonstration" : "Print my voting plan"}
        </button>
        <button type="button" class="btn ghost" onclick={() => (stage = "compare")}>
          Back to the comparison
        </button>
      </div>

      {#if pendingAction}
        <!-- Fail-closed Terms re-acceptance before a print — e.g. if the Terms version
           changed after the plan was built. Normally already accepted at build, so unseen here. -->
        <TermsGate onaccept={onTermsAccepted} oncancel={() => (pendingAction = null)} />
      {/if}
    </div>
    <!-- /.worksheet — everything above is hidden in print until the print acknowledgement is given. -->

    <!-- Archived-election watermark — a large, print-only diagonal overlay repeated on EVERY printed
         page, shown only when this is a historical (archived) election so a printed demonstration can
         never be mistaken for a live how-to-vote instruction. Hidden on screen. -->
    {#if isArchived}
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

    {#if session === "print-authorisation"}
      <!-- Print acknowledgement (National Digital authoriser model; see docs/adr/0010), as a
           focus-trapping modal. No user particulars are collected — the plan carries National
           Digital's authorisation; the voter acknowledges that the preference order is their own
           selection and that the plan is not a ballot paper. Declaration prose is subject to final
           legal sign-off before public release. -->
      <PrintAuthorisationDialog onconfirm={confirmPrint} oncancel={cancelPrint} />
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
  .ack p {
    font-size: 13px;
    color: var(--ink2);
    line-height: 1.55;
    margin: 0;
  }
  .ack p + p {
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
  .advocacy p {
    margin: 0 0 10px;
  }
  .advocacy .adv-head {
    color: var(--ink);
    font-size: 15px;
  }
  .advocacy .adv-sub {
    color: var(--ink);
    margin-top: 4px;
  }
  .advocacy ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .advocacy a {
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
  .worksheet-foot p {
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
  .save-note a {
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
