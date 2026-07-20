import type {
  Ballots,
  Merge,
  Party,
  PartyKey,
  PartyRegistry,
  Position,
  QuestionSet,
} from "@how2vote/data-schema";
import { buildPartyResolver } from "@how2vote/data-schema";

/**
 * Migration of the original how2vote.com.au datasets (2019, 2022, 2025) into the clean schema.
 *
 * This transforms *data* only — the original JSON is the ODbL-licensed dataset and is reused as the
 * seed; no code is carried over. It consolidates the original join tables into a single
 * forward-keyed party registry, drops the inert procedural-office keys (they never map to a ballot),
 * and stores only scorable positions (1–5) — an absent key means "no data".
 *
 * The historical (2019/2022) positions were compiled by the original site at the time of each
 * election, so migrating each election's committed data reproduces its as-of-election-date result
 * faithfully. Party resolution uses each election's own match/split/combine tables, and any ballot
 * party string that does not resolve is recorded in `noRecord` — exactly reproducing the original
 * behaviour of scoring an unmatched candidate as "no data" (-1).
 */

// — v0 data shapes —
export type V0Question = { id: number; question: string } & Record<string, number>;
export type V0Match = Record<string, string>; // key → AEC name | "NULL"
export type V0Split = Record<string, string>; // variant → key
export type V0House = {
  State: string;
  Division: string;
  Candidate: string;
  Party: string;
  Position: number;
};
export type V0Senate = {
  State: string;
  Group: string;
  Candidate: string;
  Party: string;
  Position: number;
};
export type V0Electorate = { State: string; Electorate: string };

export type V0Input = {
  questionData: V0Question[];
  manualMatch: V0Match;
  manualSplit: V0Split;
  house: V0House[];
  senate: V0Senate[];
  electorates: V0Electorate[];
  /** Data vintage (ISO date) — the latest division the positions are compiled from. */
  dataVersion: string;
  attribution: string;
};

/** Procedural-office keys in the v0 data — never on a ballot, so dropped entirely. */
const OFFICE_KEYS = new Set(["pres", "spk", "dpres", "cwm"]);

/** The v0 `manualCombineParties` shape: `{ master: [merger, …] }`. */
export type V0Combine = Record<string, string[]>;

/** Flattens a v0 combine table into the schema's flat master/merger pairs. */
export function combineToMerges(combine: V0Combine): Merge[] {
  const merges: Merge[] = [];
  for (const [master, mergers] of Object.entries(combine)) {
    for (const merger of mergers) merges.push({ master, merger });
  }
  return merges;
}

/** Per-election knobs for {@link buildRegistry}. All optional; historical elections use empty. */
export type RegistryOptions = {
  /** Party pairs merged after scoring. */
  merges?: Merge[] | undefined;
  /** Ballot party strings that resolve to an existing key under a new label (added as aliases). */
  aliasAdditions?: Record<string, PartyKey> | undefined;
  /** Ballot party strings acknowledged to have no parliamentary record (score -1). */
  noRecord?: string[] | undefined;
};

const isIndependentKey = (key: PartyKey, aecName: string): boolean =>
  aecName.includes(", ") || /_mp$/.test(key) || /^senator_/.test(key);

function displayName(aecName: string): string {
  if (aecName.includes(", ")) {
    const [last, first] = aecName.split(", ");
    return `${(first ?? "").trim()} ${(last ?? "").trim()}`.trim();
  }
  return aecName;
}

export function buildRegistry(
  match: V0Match,
  split: V0Split,
  opts: RegistryOptions = {},
): PartyRegistry {
  const { merges = [], aliasAdditions = {}, noRecord = [] } = opts;
  // Group v0 variant names by their target key → aliases, plus any curated additions.
  const aliasesByKey = new Map<PartyKey, string[]>();
  const addAlias = (variant: string, key: PartyKey): void => {
    const list = aliasesByKey.get(key) ?? [];
    list.push(variant);
    aliasesByKey.set(key, list);
  };
  for (const [variant, key] of Object.entries(split)) addAlias(variant, key);
  for (const [variant, key] of Object.entries(aliasAdditions)) addAlias(variant, key);

  const parties: Party[] = [];
  for (const [key, aecName] of Object.entries(match)) {
    if (OFFICE_KEYS.has(key) || aecName === "NULL") continue; // drop procedural offices
    const kind = isIndependentKey(key, aecName) ? "independent" : "party";
    // Don't duplicate the canonical name into aliases.
    const aliases = (aliasesByKey.get(key) ?? []).filter((a) => a !== aecName);
    parties.push({ key, displayName: displayName(aecName), aecName, aliases, kind });
  }

  // Deregistration is a curated, AEC-backed decision applied only to a ballot-less upcoming election;
  // the v0-seed migration for the historical elections never needs it (their ballots bound the parties).
  return { parties, merges, noRecord: [...new Set(noRecord)].sort(), deregistered: [] };
}

export function buildQuestions(
  questionData: V0Question[],
  dataVersion: string,
  attribution: string,
  /**
   * Registry keys that may carry a position. v0 question data compiles positions for every
   * parliamentarian who ever voted on a policy — including former MPs and defunct party labels not
   * contesting this election. Those keys resolve to no ballot candidate, so their positions are
   * unreachable by scoring; dropping them keeps the dataset self-consistent (every position key is a
   * real party/independent) and reproduces the original site, which never surfaced them. When
   * omitted, every scorable position is kept (used only where the data is already clean).
   */
  validKeys?: ReadonlySet<PartyKey>,
): QuestionSet {
  const questions = questionData.map((q) => {
    const positions: Record<string, Position> = {};
    for (const [key, value] of Object.entries(q)) {
      if (key === "id" || key === "question") continue;
      if (OFFICE_KEYS.has(key)) continue; // inert
      if (validKeys && !validKeys.has(key)) continue; // non-contesting entity — never scored
      // Store only scorable positions; -1 / 0 / absent all mean "no data".
      if (typeof value === "number" && value >= 1 && value <= 5) positions[key] = value as Position;
    }
    return { id: q.id, text: q.question, positions };
  });
  return { schemaVersion: 1, dataVersion, attribution, questions };
}

export function buildBallots(
  house: V0House[],
  senate: V0Senate[],
  electorates: V0Electorate[],
  dataVersion: string,
): Ballots {
  return {
    schemaVersion: 1,
    dataVersion,
    source: "Australian Electoral Commission (candidate nominations)",
    house: house.map((c) => ({
      state: c.State,
      division: c.Division,
      candidate: c.Candidate,
      party: c.Party,
      position: c.Position,
    })),
    senate: senate.map((c) => ({
      state: c.State,
      group: c.Group,
      candidate: c.Candidate,
      party: c.Party,
      position: c.Position,
    })),
    electorates: electorates.map((e) => ({ state: e.State, electorate: e.Electorate })),
  };
}

/**
 * Finds candidate party strings that the registry cannot resolve. These would score -1 (no data)
 * in production; listing them lets a human decide, per candidate, whether the name is a missing
 * alias (a party that DOES have a record) or a genuinely record-less party for the `noRecord`
 * allowlist.
 */
export function findUnresolved(registry: PartyRegistry, ballots: Ballots): string[] {
  const resolver = buildPartyResolver(registry.parties);
  const noRecord = new Set(registry.noRecord.map((s) => s.trim().toLowerCase()));
  const unresolved = new Set<string>();
  for (const c of [...ballots.house, ...ballots.senate]) {
    const party = c.party.trim();
    // Only party-affiliated candidates need a mapping decision; a nameless-party candidate not
    // matched by name is a record-less independent (legitimately -1).
    if (party === "" || noRecord.has(party.toLowerCase())) continue;
    if (resolver.resolve(c) === null) unresolved.add(party);
  }
  return [...unresolved].sort();
}
