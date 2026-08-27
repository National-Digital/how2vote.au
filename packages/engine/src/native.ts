import {
  CURRENT_ELECTION_ID,
  ELECTIONS,
  type Dataset,
  type Merge,
  type PartyKey,
  type Question,
  activeQuestions,
  electionPhase,
} from "@how2vote/data-schema";
import type { Answer } from "./answers.js";
import { type Card, generateCard, orderedQuestionIds } from "./card.js";
import { aboveTheLine, mapBallot } from "./ballot.js";
import { type ShareCard, decodeShare, encodeShare } from "./share.js";
import { matchPercentages } from "./scoring.js";

/**
 * The engine's entry point for a native host (ADR 0018 D2).
 *
 * The native iOS core runs THIS module inside JavaScriptCore rather than reimplementing scoring in
 * Swift, so that one implementation produces every result the product shows on any channel. The
 * boundary is deliberately JSON in, JSON out: a JavaScriptCore bridge can marshal live objects, but
 * doing so would spread the engine's shape across Swift call sites and make a change to an internal
 * type a silent native breakage. A string boundary keeps the contract narrow, versioned, and — the
 * reason that matters most — byte-comparable, so parity against the committed golden files
 * (`__golden__`) is an equality check rather than a structural walk that can agree while the
 * rendered output differs.
 *
 * This module must stay free of DOM and browser globals; `scripts/check-engine-bundle.mjs` asserts
 * that of the built bundle, because a stray reference stops it being evaluable in JavaScriptCore.
 */

/**
 * Contract version for the native bridge. Bump when a function's arguments or returned shape
 * change, so a stale bundle paired with a newer binary fails loudly at load rather than by
 * producing a subtly wrong card.
 */
export const NATIVE_API_VERSION = 4;

/**
 * Serialise a card to the exact bytes the golden files hold.
 *
 * The key order, the two-space indent and the trailing newline are all part of the artifact, and
 * `percentages` is a Map — which does not survive `JSON.stringify` — flattened to a key-sorted
 * object so the output cannot depend on insertion order. Mirrors the serialisation in
 * `golden-output.test.ts`; the parity check asserts the two agree rather than assuming it.
 */
function serialiseCard(card: Card): string {
  const obj = {
    state: card.state,
    electorate: card.electorate,
    house: card.house,
    senate: card.senate,
    senateAboveLine: card.senateAboveLine,
    percentages: Object.fromEntries(
      [...card.percentages.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    ),
    dataVersion: card.dataVersion,
    attribution: card.attribution,
  };
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/**
 * The questions a native screen may present, and the ordering the share codec is positional over.
 *
 * `active` is the presentable set — everything not withdrawn (ADR 0005) — and `orderedIds` is the
 * dataset's full ordering, withdrawn questions included, because a fragment encoded before a
 * withdrawal must keep decoding afterwards. The two lists therefore differ by design and the
 * native side must not derive one from the other.
 *
 * Party positions are deliberately omitted: the quiz never shows them, and carrying them would put
 * the bulk of a ~330 KB dataset across the bridge for every question screen.
 *
 * @param datasetJson - a compiled election dataset (`data/dist/<id>/dataset.json`)
 */
export function questions(datasetJson: string): string {
  const dataset = JSON.parse(datasetJson) as Dataset;
  const payload = {
    dataVersion: dataset.questions.dataVersion,
    attribution: dataset.questions.attribution,
    active: activeQuestions(dataset.questions).map((q) => ({
      id: q.id,
      text: q.text,
      divisionFirst: q.divisionFirst,
      divisionLast: q.divisionLast,
      divisionCount: q.divisionCount,
    })),
    orderedIds: orderedQuestionIds(dataset),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * The elections a landing screen offers, and which stage each is at.
 *
 * The stage is a date judgement over an AEC timetable — issue of writ, close of nominations,
 * polling day — and it decides what a screen may say: a provisional comparison against a Parliament
 * that has not been to an election, or a historical one against a result that already happened.
 * Deciding it natively would be a second reading of the same timetable, and the two would disagree
 * on exactly the days it matters most.
 *
 * @param nowIso - the moment to judge against; the current time when empty. Passed in so a screen
 *   and a test can ask about the same instant.
 */
export function elections(nowIso = ""): string {
  const now = nowIso === "" ? undefined : new Date(nowIso);
  const payload = ELECTIONS.map((meta) => ({
    id: meta.id,
    year: meta.year,
    label: meta.label,
    shortLabel: meta.shortLabel,
    current: meta.id === CURRENT_ELECTION_ID,
    phase: electionPhase(meta, now),
  }));
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * The electorates in one state, in the order a picker lists them.
 *
 * The ordering is `localeCompare`, which is implementation-defined at the edges — two engines can
 * both be correct and still disagree about where a name with a diacritic or a hyphen sits. Deciding
 * it here means the list is the same on every channel rather than the same in most places; it is
 * also why `EngineParity` runs the real engine under JavaScriptCore rather than trusting Node.
 *
 * The state code is compared case-insensitively: the compiled dataset writes "Qld" and "Tas" where
 * the picker uses "QLD" and "TAS", and a case-sensitive match would silently return an empty state.
 *
 * @param datasetJson - a compiled election dataset (`data/dist/<id>/dataset.json`)
 * @param stateCode - a state or territory code, in any case
 */
export function electorates(datasetJson: string, stateCode: string): string {
  const dataset = JSON.parse(datasetJson) as Dataset;
  const wanted = stateCode.toUpperCase();
  const list = dataset.ballots.electorates
    .filter((e) => e.state.toUpperCase() === wanted)
    .sort((a, b) => a.electorate.localeCompare(b.electorate))
    .map((e) => ({ state: e.state, electorate: e.electorate }));
  return `${JSON.stringify(list, null, 2)}\n`;
}

/** The card request, as the native side sends it. `suspended` is a list here, a Set internally. */
type CardRequest = {
  state: string;
  electorate: string;
  answers: Answer[];
  suspended?: PartyKey[];
  ballotSeed?: number;
};

/**
 * Build a printable card. Returns the serialised card, byte-identical to the golden artifact for
 * the same inputs.
 *
 * @param datasetJson - a compiled election dataset (`data/dist/<id>/dataset.json`)
 * @param requestJson - a {@link CardRequest}
 */
export function card(datasetJson: string, requestJson: string): string {
  const dataset = JSON.parse(datasetJson) as Dataset;
  const request = JSON.parse(requestJson) as CardRequest;
  return serialiseCard(
    generateCard(dataset, {
      state: request.state,
      electorate: request.electorate,
      answers: request.answers,
      suspended: new Set(request.suspended ?? []),
      ballotSeed: request.ballotSeed ?? 0,
    }),
  );
}

/**
 * The printed ballot paper for one electorate: candidates in ballot order, with no scoring applied.
 *
 * Deliberately separate from {@link card}. This is the paper's own facts — position, candidate,
 * party, column — and the blank-ballot design means the native ballot screen renders exactly this,
 * with every preference box empty until the voter fills it. Percentages are empty by construction
 * here, so no alignment figure can leak into a surface that is meant to carry none.
 */
export function ballotPaper(datasetJson: string, selectionJson: string): string {
  const dataset = JSON.parse(datasetJson) as Dataset;
  const selection = JSON.parse(selectionJson) as { state: string; electorate: string };
  const { house, senate } = mapBallot(
    dataset.ballots,
    dataset.parties.parties,
    new Map(),
    selection,
  );
  const paper = {
    state: selection.state,
    electorate: selection.electorate,
    house: house.map((r) => ({
      position: r.position,
      candidate: r.candidate,
      party: r.party,
      division: r.division,
      partyKey: r.partyKey,
    })),
    senate: senate.map((r) => ({
      position: r.position,
      group: r.group,
      candidate: r.candidate,
      party: r.party,
      partyKey: r.partyKey,
    })),
    senateAboveLine: aboveTheLine(senate).map((g) => ({
      group: g.group,
      party: g.party,
      partyKey: g.partyKey,
      candidates: g.candidates,
    })),
  };
  return `${JSON.stringify(paper, null, 2)}\n`;
}

/**
 * Per-party match percentages for the evidence view, as a key-sorted object. `-1` marks a party the
 * dataset has no position data for, exactly as on the web.
 */
export function percentages(answersJson: string, questionsJson: string, mergesJson = "[]"): string {
  const answers = JSON.parse(answersJson) as Answer[];
  const questions = JSON.parse(questionsJson) as Question[];
  const merges = JSON.parse(mergesJson) as Merge[];
  const result = matchPercentages(answers, questions, merges);
  const obj = Object.fromEntries([...result.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/**
 * Encode a card into the share fragment (without the leading `#`). The codec is versioned inside
 * `share.ts`; the payload is positional over `orderedIds`, so that list must be the election's full
 * ordering including withdrawn questions.
 */
export function share(cardJson: string, orderedIdsJson: string, electionId: string): string {
  const card = JSON.parse(cardJson) as ShareCard;
  const orderedIds = JSON.parse(orderedIdsJson) as number[];
  return encodeShare(card, orderedIds, electionId);
}

/**
 * Decode a share fragment, returning the decoded share as JSON or the JSON `null` when the fragment
 * is unreadable.
 *
 * The web passes `decodeShare` a lookup FUNCTION, which cannot cross a string bridge; the native
 * side sends the same information as a plain map of election id to ordered ids, and this rebuilds
 * the lookup on this side of the boundary. `dataVersions` is optional and only consulted by the
 * version-pinned v2 fragment.
 */
export function unshare(
  fragment: string,
  orderedIdsByElectionJson: string,
  dataVersionsByElectionJson = "{}",
): string {
  const ordered = JSON.parse(orderedIdsByElectionJson) as Record<string, number[]>;
  const versions = JSON.parse(dataVersionsByElectionJson) as Record<string, string>;
  const decoded = decodeShare(
    fragment,
    (electionId) => ordered[electionId],
    (electionId) => versions[electionId],
  );
  return `${JSON.stringify(decoded)}\n`;
}
