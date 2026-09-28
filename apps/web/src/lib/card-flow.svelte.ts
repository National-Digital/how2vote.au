/**
 * The comparison card's state and its actions: the comparison, the plan the voter builds, and the
 * gates in front of every consequential action. The card page renders it, so every rule — who may
 * build, share, save or print, and what a suspension withholds — is held here, once.
 *
 * It is opened afresh each time the card is entered (`open`) and closed when the card is left
 * (`close`), as the page's own state once was.
 */
import { version } from "$app/environment";
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
import {
  alignmentPresentation,
  distinctPartyAlignments,
  groupByFederalGroup,
  type PartyAlignmentRow,
} from "$lib/candidate-alignment";
import { CARD_COPY } from "$lib/card-copy";
import { PARTY_PANEL_COPY } from "$lib/party-panel-copy";
import { fill } from "$lib/template";
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
import { NATIONAL_BALLOT, isElectorateLess, loadData, stateName, type Data } from "$lib/data";
import { election } from "$lib/election.svelte";
import { moveDown, moveUp, planStatus, prefOf, setRank, type PlanStatus } from "$lib/plan";
import { printAuth } from "$lib/print-auth.svelte";
import { quiz } from "$lib/quiz.svelte";
import { saved } from "$lib/saved.svelte";
import { termsAcceptance } from "$lib/terms.svelte";
import { isNativeShell } from "$lib/channel";

type Ready = { card: Card; answers: Answer[]; shared: boolean };

/** One of the plan's three ballots: the House, and the Senate above or below the line. */
export type PlanBallot = "house" | "above" | "below";

// Discriminated card session (see docs/adr/0010). The card is exactly one of:
//   - shared-readonly     — opened from a share link; carries someone else's answers, never a
//                           chosen order; can NEVER print (no owner capability, no build stage);
//   - owner-session       — this browser built this card from its own in-progress quiz; may build
//                           a plan and, after mandatory s321D authorisation, print it;
//   - print-authorisation — an owner is entering their s321D particulars before a print.
// It DEFAULTS to the least-privileged state so any bug fails closed to shared-readonly (which
// cannot print) rather than to owner-session. The actual print permission is the in-memory
// `printAuth.isOwner` capability (never persisted, never in a URL), asserted again at print time.
export type CardSession = "shared-readonly" | "owner-session" | "print-authorisation";

/** A party's row in an alignment panel, as the panel shows and speaks it. */
export type NativePanelRow = {
  /** The party as the panel names it: with its state branch, where it has one. */
  name: string;
  kind: "suspended" | "independent" | "no-party-record" | "aligned";
  showScore: boolean;
  /** The figure as the panel prints it, or null where none may be shown. */
  figure: string | null;
  badge: string;
  spoken: string;
};

/** An alignment panel: its chamber's heading, and its parties, a registered family together. */
export type NativePanel = {
  title: string;
  subtitle: string;
  caption: string;
  ballotOrdered: boolean;
  blocks: (
    | { kind: "single"; row: NativePanelRow }
    | { kind: "group"; label: string; note: string; rows: NativePanelRow[] }
  )[];
};

/** A row of the plan's ballot, with the name its controls are called by. */
export type NativePlanRow = {
  id: string;
  candidate: string;
  party: string;
  name: string;
  pref: number;
};

/**
 * The card as the iOS app draws it: what the page would show, its values and every label the page
 * computes, filled; the card's fixed wording is its states page. Only a card that is ready, or one
 * the page explains instead, is drawn.
 */
export type NativeCard =
  | { status: "error" | "unavailable" | "archived-link" }
  | {
      status: "ready";
      stage: "compare" | "build";
      stageLabel: string;
      heading: string;
      /** What follows the heading, as the page sets it smaller: the state, for a ballot. */
      stateSuffix: string;
      shared: boolean;
      canVote: boolean;
      archived: boolean;
      electorateLess: boolean;
      correction: boolean;
      electorate: string;
      label: string;
      year: string;
      vintage: string;
      withdrawn: number;
      panels: NativePanel[];
      plansEnabled: boolean;
      build: string;
      saveable: boolean;
      saved: boolean;
      /** Whether the Terms gate is showing, and whether its acceptance is ticked. */
      terms: { shown: boolean; ticked: boolean };
      shareWarning: boolean;
      why: boolean;
      evidence: {
        key: string;
        summary: string;
        lines: { id: number; question: string; agreement: string; href: string; label: string }[];
      }[];
      plan: {
        house: { title: string; subtitle: string; rows: NativePlanRow[]; status: string };
        senate: {
          title: string;
          subtitle: string;
          view: "above" | "below";
          above: NativePlanRow[];
          aboveStatus: string;
          below: { label: string; rows: NativePlanRow[] }[];
          belowStatus: string;
        };
        built: string;
        dataVersion: string;
        version: string;
        attribution: string;
      } | null;
    };

/** The name a plan row's controls are called by: its candidate, then their party. */
export const planRowName = (candidate: string, party: string): string =>
  `${candidate}, ${party || CARD_COPY.independent}`;

/** Where a question's parliamentary voting record is, on They Vote For You. */
export const TVFY_POLICY = "https://theyvoteforyou.org.au/policies";

/** Stable per-row id (candidate + printed position), used as the plan-order key. */
export const rowId = (candidate: string, position: number): string => `${candidate}|${position}`;

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
    isChamberAvailable(electionId, "senate") && isBallotAvailable(electionId, "senate", card.state);
  if (houseOk && senateOk) return card;
  return {
    ...card,
    house: houseOk ? card.house : [],
    senate: senateOk ? card.senate : [],
    senateAboveLine: senateOk ? card.senateAboveLine : [],
  };
}

/** A Senate plan's check: how many are numbered, and the minimum where the paper has one. */
function senateStatus(status: PlanStatus, territory: boolean, line: "above" | "below"): string {
  const template = territory
    ? CARD_COPY.territoryProgress
    : line === "above"
      ? CARD_COPY.aboveProgress
      : CARD_COPY.belowProgress;
  return fill(template, { ranked: status.ranked });
}

/** An alignment panel as the iOS app draws it: each row as `PartyAlignmentPanel` presents it. */
function nativePanel(
  title: string,
  subtitle: string,
  caption: string,
  parties: readonly PartyAlignmentRow[],
  ballotOrdered: boolean,
): NativePanel {
  const rows = parties.map((p) => {
    const presentation = alignmentPresentation({
      partyKey: p.partyKey,
      party: p.party,
      score: p.score,
      band: p.band,
      suspended: p.suspended,
    });
    const party = p.party || PARTY_PANEL_COPY.unnamed;
    const row: NativePanelRow = {
      name: p.region ? `${party}\u00a0(${p.region})` : party,
      kind: presentation.kind,
      showScore: presentation.showScore,
      figure: presentation.showScore ? `${presentation.score}%` : null,
      badge: presentation.badge,
      spoken: fill(PARTY_PANEL_COPY.spoken, { party: p.party, detail: presentation.detail }),
    };
    return { ...row, federalGroup: p.federalGroup };
  });
  return {
    title,
    subtitle,
    caption,
    ballotOrdered,
    blocks: groupByFederalGroup(rows).map((block) =>
      block.kind === "single"
        ? { kind: "single", row: strip(block.row) }
        : {
            kind: "group",
            label: block.label,
            note: fill(PARTY_PANEL_COPY.groupNote, { group: block.label }),
            rows: block.rows.map(strip),
          },
    ),
  };
}

const strip = ({ federalGroup: _group, ...row }: NativePanelRow & { federalGroup?: string }) => row;

class CardFlow {
  // "unavailable" is the fail-closed governance state: the runtime kill-switch control
  // plane has suspended this election / electorate / ballot, or decoding, or is itself
  // tampered/unsigned — the card REFUSES rather than rendering a withdrawn capability.
  status = $state<"loading" | "ready" | "error" | "archived-link" | "unavailable">("loading");
  data = $state<Ready | null>(null);
  // The election this card belongs to, kept for the reactive governance gates below.
  activeElectionId = $state<string | null>(null);
  // The loaded dataset, kept so "Why these numbers?" can pull per-candidate evidence on demand.
  dataset = $state<Data["dataset"] | null>(null);

  // Two separated stages: Compare shows alignment as evidence in ballot order, nothing crowned;
  // Build is where the voter authors their own preference order from a blank ballot. A shared link
  // only ever shows Compare — it carries answers (a comparison), never a chosen order.
  // Read-only from outside: each changes only through the steps below, which hold its gates.
  #stage = $state<"compare" | "build">("compare");
  #session = $state<CardSession>("shared-readonly");

  get stage(): "compare" | "build" {
    return this.#stage;
  }

  get session(): CardSession {
    return this.#session;
  }

  // Most voters vote above the line, so that is the default Senate view; below the line is one
  // toggle away. Only ever one method is shown/built at a time — marking both changes how the paper
  // is counted.
  senateView = $state<"above" | "below">("above");
  showWhy = $state(false);
  copied = $state(false);
  // Versioned Terms-of-Use acceptance before any consequential action. A gated action
  // (build / share / print) that is requested before the CURRENT Terms version has been accepted is
  // held in `pendingAction`; the reusable TermsGate records the versioned acceptance and then the
  // held action runs. Separate from research consent, which has its own gate on the survey.
  #pendingAction = $state<null | "build" | "share" | "print">(null);

  get pendingAction(): null | "build" | "share" | "print" {
    return this.#pendingAction;
  }
  // Non-revocable-link warning gate: once Terms are accepted, sharing still NEVER copies
  // straight away — share() opens this warning first, and only an explicit confirm inside it performs
  // the copy/native share, so a link can never leave this device before the user has been told it
  // cannot be recalled.
  #showShareWarning = $state(false);

  get showShareWarning(): boolean {
    return this.#showShareWarning;
  }
  // The Terms gate's acceptance box as the iOS app ticks it: the web's page holds its own. Only a
  // ticked box can accept.
  termsTicked = $state(false);
  // The shareable path (with fragment) for this comparison — the key it's saved under on-device.
  cardUrl = $state("");

  // The voter-authored orders, one per ballot/method. Each starts EMPTY — a blank ballot. A
  // candidate's preference is its 1-based index in its order (see $lib/plan); nothing is pre-filled.
  houseOrder = $state<string[]>([]);
  senateAboveOrder = $state<string[]>([]);
  senateBelowOrder = $state<string[]>([]);

  /** The card being opened, until it is closed: a second request to open it is the same one. */
  #opening: Promise<void> | null = null;
  // Liveness guard: the async loadData continuation can resolve AFTER the card has been left, or
  // left and entered again. Each opening is numbered, and close() moves the number on, so a late
  // resolution never mutates state or history.replaceState for a card that is no longer the one open.
  #opened = 0;

  // An electorate-less (provisional) election ships no ballot, so there are no candidate rows to
  // derive the party panel from. The comparison is party-level only, sourced straight from the
  // per-party percentages: show the registered PARTIES (single-member independents are a
  // per-electorate concern a national, ballot-less comparison does not rank).
  electorateLess = $derived(this.dataset ? isElectorateLess(this.dataset) : false);
  allPartyAlignments = $derived.by(() => {
    if (!this.data || !this.dataset || !this.activeElectionId) return [];
    const suspended = suspendedPartyKeys(this.activeElectionId);
    const byKey = new Map(this.dataset.parties.parties.map((p) => [p.key, p]));
    // Parties off the AEC register (deregistered/renamed) cannot contest, so they are removed from the
    // ballot-less comparison entirely — never shown as an option for the next election.
    const deregistered = new Set((this.dataset.parties.deregistered ?? []).map((d) => d.key));
    const rows: PartyAlignmentRow[] = [];
    for (const [key, score] of this.data.card.percentages) {
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

  // On-device save (explicit, never automatic). Reactive to the store so the label flips instantly.
  isSaved = $derived(this.cardUrl !== "" && saved.has(this.cardUrl));

  house = $derived<HouseBallotRow[]>(this.data ? this.data.card.house : []);
  senate = $derived<SenateBallotRow[]>(this.data ? this.data.card.senate : []);
  senateAtl = $derived<SenateGroupRow[]>(this.data ? this.data.card.senateAboveLine : []);
  senateGroups = $derived([
    ...new Map(
      this.senate.map((r) => [r.group, this.senate.filter((s) => s.group === r.group)]),
    ).entries(),
  ]);

  // Party-level alignment panels — the ONLY place a figure is shown. Alignment is a property of the
  // PARTY, so it is derived per DISTINCT party and never attached to a candidate row.
  //   - House: dedupe the candidate rows by partyKey; independents (null partyKey) have no party
  //     record and are dropped from the panel (they still appear in the neutral ballot list).
  //   - Senate: the above-the-line groups are already party/group-level, so they ARE the party panel.
  // Each derived party object explicitly carries partyKey + suspended so the fail-closed independent /
  // suspension treatments reach alignmentPresentation() inside the panel.
  houseParties = $derived(
    distinctPartyAlignments(
      this.house.map((r) => ({
        party: r.party,
        partyKey: r.partyKey,
        score: r.score,
        band: r.band,
        suspended: r.suspended,
      })),
    ),
  );
  senateParties = $derived(
    distinctPartyAlignments(
      this.senateAtl.map((r) => ({
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
  // from the per-party percentages), NOT `houseParties` — which is empty with no ballot.
  evidenceParties = $derived(this.electorateLess ? this.allPartyAlignments : this.houseParties);

  // Ballot-order id lists per ballot, for the plan reducers and the mechanical check.
  houseIds = $derived(this.house.map((r) => rowId(r.candidate, r.position)));
  senateAboveIds = $derived(this.senateAtl.map((r) => r.group));
  senateBelowIds = $derived(this.senate.map((r) => rowId(r.candidate, r.position)));

  houseStatus = $derived(planStatus(this.houseOrder, this.houseIds));
  senateAboveStatus = $derived(planStatus(this.senateAboveOrder, this.senateAboveIds));
  senateBelowStatus = $derived(planStatus(this.senateBelowOrder, this.senateBelowIds));

  // Territory (ACT/NT) Senate papers carry different numbering minimums, so the "at least 6 / 12"
  // guidance is shown only for states; territories defer to the ballot.
  isTerritory = $derived(
    this.data ? this.data.card.state === "ACT" || this.data.card.state === "NT" : false,
  );

  // Lifecycle phase, derived deterministically from the polling day + verified ballot-final flag
  // (never the `current` toggle). Archived = polling day passed → historical demonstration.
  phase = $derived(this.data ? electionPhase(election.meta) : "upcoming");
  isArchived = $derived(this.phase === "archived");

  // Ballot-order gating: the plan builder opens for a live or an archived election, but stays closed
  // for an `upcoming` one until its official candidate list and ballot order are final and verified.
  // An archived election's builder is a clearly-labelled historical demonstration, never an
  // instruction for a live vote. The printing capability is the runtime kill-switch: global
  // `printing`, this election, or this electorate can each be suspended, and a tampered control
  // plane refuses printing outright (fail closed).
  plansEnabled = $derived(
    this.data && this.activeElectionId
      ? isPrintingAllowed(this.activeElectionId, slugify(this.data.card.electorate)) &&
          this.phase !== "upcoming"
      : false,
  );

  // "Under review" correction banner: a granular suspension (withdrawn mapping /
  // proposition, or a suspended chamber/ballot) is affecting what this card shows.
  correctionNotice = $derived(
    this.data && this.activeElectionId
      ? hasCorrectionNotice(this.activeElectionId, slugify(this.data.card.electorate))
      : false,
  );

  vintage = $derived(
    new Date(election.manifest.dataVersion).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  );
  // Withdrawn questions are disabled outputs (ADR 0005): excluded from scoring and presentation,
  // disclosed on the card and listed on /corrections.
  withdrawnCount = $derived(
    this.dataset
      ? this.dataset.questions.questions.filter((q) => q.withdrawn !== undefined).length
      : 0,
  );

  // Date the plan is built/printed — recorded on the worksheet so a stale printout is obvious.
  // Set as the card opens, as the page once set it on each visit: a module's $derived of the clock
  // would never recompute, and a long-lived app would print the day it was first opened.
  builtOn = $state("");

  /** What the card's head calls the stage it is on. */
  stageLabel = $derived(
    this.stage === "build"
      ? this.isArchived
        ? CARD_COPY.demonstrationStage
        : CARD_COPY.buildStage
      : CARD_COPY.compareStage,
  );

  /** The House plan's check, as the page reports it under the ballot. */
  houseStatusText = $derived(
    this.houseStatus.complete
      ? fill(CARD_COPY.houseComplete, { total: this.houseStatus.total })
      : fill(CARD_COPY.houseProgress, {
          ranked: this.houseStatus.ranked,
          total: this.houseStatus.total,
        }),
  );
  aboveStatusText = $derived(senateStatus(this.senateAboveStatus, this.isTerritory, "above"));
  belowStatusText = $derived(senateStatus(this.senateBelowStatus, this.isTerritory, "below"));

  /** The above-the-line rows as the plan lists them: the group, and its column and size. */
  aboveRows = $derived(
    this.senateAtl.map((r) => ({
      id: r.group,
      candidate: r.party || fill(CARD_COPY.group, { group: r.group }),
      party: fill(r.candidates === 1 ? CARD_COPY.columnOne : CARD_COPY.columnMany, {
        group: r.group,
        n: r.candidates,
      }),
    })),
  );

  /** The card as the iOS app draws it, or null while there is nothing yet to draw. */
  nativeCard(): NativeCard | null {
    if (this.status === "loading") return null;
    if (this.status !== "ready") return { status: this.status };
    const data = this.data;
    if (!data) return null;
    const card = data.card;
    const state = stateName(card.state);
    const panels: NativePanel[] = this.electorateLess
      ? [
          nativePanel(
            CARD_COPY.parliamentPanel,
            CARD_COPY.parliamentPanelNote,
            CARD_COPY.parliamentCaption,
            this.allPartyAlignments,
            false,
          ),
        ]
      : [
          nativePanel(
            CARD_COPY.house,
            CARD_COPY.houseCompare,
            CARD_COPY.houseCaption,
            this.houseParties,
            true,
          ),
          nativePanel(
            CARD_COPY.senate,
            fill(CARD_COPY.senatePaper, { state }),
            CARD_COPY.senateCaption,
            this.senateParties,
            true,
          ),
        ];
    const row = (id: string, candidate: string, party: string, order: readonly string[]) => ({
      id,
      candidate,
      party: party || CARD_COPY.independent,
      name: planRowName(candidate, party),
      pref: prefOf(order, id),
    });
    const building = this.stage === "build";
    return {
      status: "ready",
      stage: this.stage,
      stageLabel: this.stageLabel,
      heading: this.electorateLess ? CARD_COPY.parliament : card.electorate,
      stateSuffix: this.electorateLess ? "" : ` · ${state}`,
      shared: data.shared,
      canVote: ageGate.canVote,
      archived: this.isArchived,
      electorateLess: this.electorateLess,
      correction: this.correctionNotice,
      electorate: card.electorate,
      label: election.meta.label,
      year: String(election.meta.year),
      vintage: this.vintage,
      withdrawn: this.withdrawnCount,
      panels,
      plansEnabled: this.plansEnabled,
      build: this.isArchived ? CARD_COPY.buildDemonstration : CARD_COPY.build,
      saveable: this.cardUrl !== "" && ageGate.canVote && !data.shared,
      saved: this.isSaved,
      terms: { shown: this.pendingAction !== null, ticked: this.termsTicked },
      shareWarning: this.showShareWarning,
      why: this.showWhy,
      evidence: this.showWhy
        ? this.evidenceParties
            .filter((p) => !p.suspended && p.partyKey)
            .map((p) => ({
              key: p.partyKey!,
              summary: `${p.party} — ${
                p.score < 0
                  ? CARD_COPY.noPartyVotes
                  : fill(CARD_COPY.partyScore, { score: p.score })
              }`,
              lines: this.evidence(p.partyKey).map((line) => ({
                id: line.questionId,
                question: line.question,
                agreement: line.agreement,
                href: `${TVFY_POLICY}/${line.questionId}`,
                label: fill(CARD_COPY.recordLabel, { question: line.question }),
              })),
            }))
        : [],
      plan: building
        ? {
            house: {
              title: CARD_COPY.house,
              subtitle: CARD_COPY.houseBuild,
              rows: this.house.map((r) =>
                row(rowId(r.candidate, r.position), r.candidate, r.party, this.houseOrder),
              ),
              status: this.houseStatusText,
            },
            senate: {
              title: CARD_COPY.senate,
              subtitle: fill(CARD_COPY.senatePaper, { state }),
              view: this.senateView,
              above: this.aboveRows.map((r) => ({
                ...row(r.id, r.candidate, r.party, this.senateAboveOrder),
                party: r.party,
              })),
              aboveStatus: this.aboveStatusText,
              below: this.senateGroups.map(([group, rows]) => ({
                label: fill(CARD_COPY.column, { group }),
                rows: rows.map((r) =>
                  row(rowId(r.candidate, r.position), r.candidate, r.party, this.senateBelowOrder),
                ),
              })),
              belowStatus: this.belowStatusText,
            },
            built: this.builtOn,
            dataVersion: election.manifest.dataVersion,
            version,
            attribution: card.attribution,
          }
        : null,
    };
  }

  /**
   * Opens the card the URL names: a shared comparison from its fragment, or the visitor's own from
   * their in-progress quiz. A second call before the card is closed is the same opening.
   *
   * @param goto - moves the router, for a visitor with no ballot to compare yet
   */
  open(url: URL, goto: (path: string) => void): Promise<void> {
    this.#opening ??= this.#open(url, goto);
    return this.#opening;
  }

  /** Leaves the card: a late load no longer touches it, and the next visit opens it afresh. */
  close(): void {
    this.#opened += 1;
    this.#opening = null;
    this.status = "loading";
    this.data = null;
    this.activeElectionId = null;
    this.dataset = null;
    this.#stage = "compare";
    this.#session = "shared-readonly";
    this.senateView = "above";
    this.showWhy = false;
    this.copied = false;
    this.#pendingAction = null;
    this.#showShareWarning = false;
    this.termsTicked = false;
    this.cardUrl = "";
    this.houseOrder = [];
    this.senateAboveOrder = [];
    this.senateBelowOrder = [];
  }

  async #open(url: URL, goto: (path: string) => void): Promise<void> {
    const opening = ++this.#opened;
    try {
      await this.#load(url, goto, opening);
    } catch {
      // A card that cannot be built is explained, never left loading: the page shows its error, and
      // the app's route is declined rather than left covering whatever came before.
      if (opening === this.#opened) this.status = "error";
    }
  }

  async #load(url: URL, goto: (path: string) => void, opening: number): Promise<void> {
    this.builtOn = new Date().toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    termsAcceptance.hydrate();
    // Old how2vote.com.au share links (?res=<id>) pointed at cards stored in that site's database,
    // which is gone — they can only be explained, not resolved.
    if (url.searchParams.has("res")) {
      this.status = "archived-link";
      return;
    }

    const hash = url.hash;
    const ownCard = !(hash && hash.length > 1);
    // Reading a shared comparison is legitimate without an in-progress quiz; only our own requires one.
    if (ownCard && !quiz.hasBallot) {
      goto("/ballot");
      return;
    }

    const electionId = ownCard ? election.id : shareElectionId(hash);
    if (!electionId) {
      this.status = "error";
      return;
    }
    if (!ownCard) election.set(electionId);

    let d: Data;
    try {
      d = await loadData(electionId);
    } catch {
      // A transient dataset import/fetch failure must surface an error state, not hang on "loading"
      // forever (loadData evicts the rejected promise, so a reload retries cleanly).
      if (opening === this.#opened) this.status = "error";
      return;
    }
    if (opening !== this.#opened) return; // left before the dataset resolved — do not touch state/history
    const { electorateFromSlug, questionIds } = d;
    this.dataset = d.dataset;

    if (!ownCard) {
      // Fail-closed decode gate: if the `decoding` scope (or this election) is suspended, or the
      // control plane is tampered, we NEVER decode the fragment — a shared link simply cannot be
      // opened while decoding is withdrawn.
      if (!isDecodingAllowed(electionId)) {
        this.status = "unavailable";
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
        this.status = "error";
        return;
      }
      // An electorate-less (provisional) election has no ballot to resolve a slug against: the
      // comparison is party-level only, so use the sentinel national selection.
      const electorate = isElectorateLess(d.dataset)
        ? { state: NATIONAL_BALLOT.state, electorate: NATIONAL_BALLOT.electorate }
        : electorateFromSlug(decoded.electorateSlug);
      if (!electorate) {
        this.status = "error";
        return;
      }
      // Election / electorate suspension (or a tampered plane) makes this card unavailable.
      if (
        !isElectionAvailable(electionId) ||
        !isElectorateAvailable(electionId, decoded.electorateSlug)
      ) {
        this.status = "unavailable";
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
      this.activeElectionId = electionId;
      this.data = { card, answers, shared: true };
      this.cardUrl = url.pathname + url.hash;
      // A shared link is read-only: drop any stale owner capability so it can never print.
      this.#session = "shared-readonly";
      printAuth.reset();
      this.status = "ready";
      return;
    }

    // Our own comparison, from the in-progress quiz for the active election. Progress tracks the
    // answerable (active) questions; the share fragment stays positional over the full codec list so
    // a withdrawal never shifts previously shared payloads.
    quiz.syncQuestions(d.activeQuestionIds);
    const answers = quiz.toAnswers();
    const electorateSlug = slugify(quiz.electorate!);
    // Election / electorate suspension (or a tampered plane) makes this card unavailable, even for
    // its owner building from their own quiz.
    if (!isElectionAvailable(electionId) || !isElectorateAvailable(electionId, electorateSlug)) {
      this.status = "unavailable";
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
    this.activeElectionId = electionId;
    this.data = { card, answers, shared: false };
    // This browser built this card from its own quiz: claim the in-memory owner capability that
    // (and only that) permits a print. It lives in memory only, is never persisted or put in a URL,
    // and is lost on reload — a reloaded /card#… link comes back as shared-readonly.
    this.#session = "owner-session";
    printAuth.claimOwnership();
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
    this.cardUrl = `/card#${fragment}`;
    this.status = "ready";
  }

  toggleSave(): void {
    // Saving a comparison on-device is a vote-capable capability (ADR 0012): an under-18 explorer
    // gets a session-only result, nothing persisted. Fail closed — the UI already hides the control.
    if (!ageGate.canVote) return;
    if (!this.data || this.data.shared || !this.cardUrl) return;
    if (saved.has(this.cardUrl)) saved.remove(this.cardUrl);
    else
      saved.save({
        url: this.cardUrl,
        electorate: this.data.card.electorate,
        state: this.data.card.state,
      });
  }

  // Creating a share link is a consequential action, so it requires a current-version Terms
  // acceptance first. If already accepted we share straight away; otherwise the gate is
  // shown and the share runs only once the visitor accepts.
  requestShare(): void {
    // Sharing produces a link others open — a vote-capable action, 18+ only (ADR 0012). Fail closed.
    if (!ageGate.canVote) return;
    if (!this.data || this.data.shared) return;
    if (termsAcceptance.accepted) this.share();
    else this.#pendingAction = "share";
  }

  // Terms are accepted by now; show the non-revocable-link warning before anything is copied/shared.
  // The actual copy happens only once the warning is confirmed.
  share(): void {
    if (!termsAcceptance.accepted) return;
    this.#showShareWarning = true;
  }

  /**
   * Confirms the non-revocable-link warning: closes it and says whether a link may now leave the
   * device. Only a warning actually shown can be confirmed.
   */
  confirmShare(): boolean {
    if (!this.showShareWarning || !ageGate.canVote || !termsAcceptance.accepted) return false;
    this.#showShareWarning = false;
    return true;
  }

  cancelShare(): void {
    this.#showShareWarning = false;
  }

  /** Reports a link copied to the clipboard, for as long as the page says so. */
  markCopied(): void {
    this.copied = true;
    setTimeout(() => (this.copied = false), 2000);
  }

  // Making your own from a shared card starts a CLEAN session — wipe any in-progress quiz that a
  // previous session left on this device first so nothing carries over, then send the
  // visitor to the blank ballot.
  startFresh(goto: (path: string) => void): void {
    quiz.reset();
    goto("/ballot");
  }

  /** The evidence behind a party's figure, as the "why" list shows it: each answered question. */
  evidence(partyKey: string | null) {
    if (!partyKey || !this.data || !this.dataset) return [];
    // Exclude any SUSPENDED proposition here too, so a withdrawn question never surfaces
    // in the evidence detail even though the stable share payload still carries the raw answer.
    const answers = this.activeElectionId
      ? withoutSuspendedPropositions(this.data.answers, this.activeElectionId)
      : this.data.answers;
    return evidenceFor(this.dataset, partyKey, answers).filter((l) => l.agreement !== "skipped");
  }

  // "Build my voting plan" — a plan-creation action, so it requires a current-version Terms
  // acceptance. If already accepted we go straight to the builder; otherwise the gate is
  // shown and the build begins only once the visitor accepts.
  requestBuild(): void {
    // The plan builder is the how-to-vote card — a vote-capable capability, 18+ only (ADR 0012). An
    // under-18 explorer never reaches this (the button is replaced by the advocacy note); guard anyway.
    if (!ageGate.canVote) return;
    if (!this.plansEnabled || !this.data || this.data.shared) return;
    if (termsAcceptance.accepted) this.startBuild();
    else this.#pendingAction = "build";
  }

  // The reusable TermsGate has recorded a current-version acceptance; run whichever action was held.
  onTermsAccepted(): void {
    const action = this.pendingAction;
    this.#pendingAction = null;
    if (action === "build") this.startBuild();
    else if (action === "share") this.share();
    else if (action === "print") this.openPrintAuthorisation();
  }

  cancelTerms(): void {
    this.#pendingAction = null;
    this.termsTicked = false;
  }

  /** Ticks or clears the Terms gate's acceptance, as the iOS app's box does. */
  tickTerms(on: boolean): void {
    if (this.#pendingAction === null) return;
    this.termsTicked = on;
  }

  /**
   * Accepts the Terms from the iOS app's gate: only a gate that is showing, with its box ticked,
   * records the acceptance, as the page's gate does, and then runs the action it was holding.
   */
  acceptTerms(): boolean {
    if (this.#pendingAction === null || !this.termsTicked) return false;
    this.termsTicked = false;
    termsAcceptance.accept();
    this.onTermsAccepted();
    return true;
  }

  startBuild(): void {
    // Fail closed: the build stage is the how-to-vote card, never opened for an under-18 (ADR 0012).
    if (!ageGate.canVote) return;
    if (!termsAcceptance.accepted || !this.plansEnabled || !this.data || this.data.shared) return;
    this.#stage = "build";
  }

  backToCompare(): void {
    this.#stage = "compare";
  }

  /** Numbers a row of one of the plan's ballots, as its box is typed into; NaN clears it. */
  setRank(ballot: PlanBallot, id: string, n: number): void {
    if (ballot === "house") this.houseOrder = setRank(this.houseOrder, id, n, this.houseIds.length);
    else if (ballot === "above")
      this.senateAboveOrder = setRank(this.senateAboveOrder, id, n, this.senateAboveIds.length);
    else this.senateBelowOrder = setRank(this.senateBelowOrder, id, n, this.senateBelowIds.length);
  }

  moveUp(ballot: PlanBallot, id: string): void {
    if (ballot === "house") this.houseOrder = moveUp(this.houseOrder, id);
    else if (ballot === "above") this.senateAboveOrder = moveUp(this.senateAboveOrder, id);
    else this.senateBelowOrder = moveUp(this.senateBelowOrder, id);
  }

  moveDown(ballot: PlanBallot, id: string): void {
    if (ballot === "house") this.houseOrder = moveDown(this.houseOrder, id);
    else if (ballot === "above") this.senateAboveOrder = moveDown(this.senateAboveOrder, id);
    else this.senateBelowOrder = moveDown(this.senateBelowOrder, id);
  }

  // Print acknowledgement gate (National Digital authoriser model; see docs/adr/0010). Printing is
  // NEVER wired directly to window.print(): the only path to a print is through this gate, and only an
  // owner session that actually holds the in-memory capability can open it. A shared-readonly card
  // can never get here.
  requestPrint(): void {
    // Printing is a web-PWA capability only. The shells offer no print action at all (printing from a
    // phone is not a real workflow, and the sanctioned share-image path replaces it), so fail closed
    // here as well as hiding the control — the gate must not depend on the markup alone.
    if (isNativeShell) return;
    // Printing a how-to-vote card is vote-capable, 18+ only (ADR 0012). An under-18 can never reach
    // the build stage that hosts the print action, but fail closed here regardless.
    if (!ageGate.canVote) return;
    if (this.session !== "owner-session" || !printAuth.isOwner) return;
    // Printing is a consequential action, so it also requires a current-version Terms acceptance,
    // asserted here before the print acknowledgement gate opens.
    if (!termsAcceptance.accepted) {
      this.#pendingAction = "print";
      return;
    }
    this.openPrintAuthorisation();
  }

  openPrintAuthorisation(): void {
    if (isNativeShell || !ageGate.canVote) return;
    if (this.session !== "owner-session" || !printAuth.isOwner || !termsAcceptance.accepted) return;
    printAuth.clearAcknowledgement();
    this.#session = "print-authorisation";
  }

  cancelPrint(): void {
    printAuth.clearAcknowledgement();
    if (this.#session === "print-authorisation") this.#session = "owner-session";
  }

  /**
   * Acknowledges the print from the acknowledgement screen and closes it, so the worksheet is what
   * prints. Only an owner at that screen can: it says whether the print may go ahead.
   */
  acknowledgePrint(): boolean {
    if (this.#session !== "print-authorisation" || !printAuth.isOwner) return false;
    printAuth.acknowledge();
    this.#session = "owner-session";
    return true;
  }
}

export const cardFlow = new CardFlow();
