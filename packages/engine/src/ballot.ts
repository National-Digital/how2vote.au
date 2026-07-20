import type {
  Ballots,
  HouseCandidate,
  Party,
  PartyKey,
  SenateCandidate,
} from "@how2vote/data-schema";
import { buildPartyResolver } from "@how2vote/data-schema";
import { NO_RESULT } from "./scoring.js";

/**
 * Display band for a candidate's match score. A business rule even though it
 * is rendered in the UI, because it drives the guidance shown.
 *   - `matched`  `score ≥ 50`
 *   - `low`      `0 ≤ score < 50` (lower alignment with the user's answers)
 *   - `no-data`  `score < 0` (no parliamentary record for this candidate)
 */
export type MatchBand = "matched" | "low" | "no-data";

export function bandFor(score: number): MatchBand {
  if (score < 0) return "no-data";
  if (score >= 50) return "matched";
  return "low";
}

/** A scored candidate row, carrying everything the card needs to render one ballot line. */
export type BallotRow = {
  state: string;
  candidate: string;
  /** AEC ballot party name as printed. */
  party: string;
  /** Printed ballot position (the number's original order on the paper). */
  position: number;
  /**
   * Resolved internal party key, or null when the candidate could not be matched to a party in the
   * registry (an independent / unmapped candidate). A null key MUST NOT be shown a party-position
   * alignment figure — there is no party record to attribute one to.
   */
  partyKey: PartyKey | null;
  /** Match percentage 0–100, or -1 for no data. */
  score: number;
  band: MatchBand;
  /**
   * True when this candidate's party-position alignment is SUSPENDED pending a correction / right of
   * reply (a data-driven suspension list the runtime reads). A suspended row is forced
   * to no-alignment (score -1 / band `no-data`) so the disputed figure can never be shown, even by a
   * surface that forgets to check this flag — fail-closed.
   */
  suspended: boolean;
};

export type HouseBallotRow = BallotRow & { division: string };
export type SenateBallotRow = BallotRow & { group: string };

/**
 * One above-the-line box on the Senate paper: a whole group/column, scored by the party that heads
 * it. Most voters vote above the line (number at least 6 groups) rather than below (number at least
 * 12 individual candidates), so this is the card's default Senate view. It is a faithful reduction
 * of what the engine actually knows — the scoring is party-level, and an ATL box *is* a party — so
 * it introduces no new judgement: it simply annotates the columns (kept in printed column order)
 * with the same party percentages the below-the-line rows already use.
 */
export type SenateGroupRow = {
  state: string;
  /** Ballot column code, e.g. "A", "AB". */
  group: string;
  /** AEC party/group name printed above the line (from the group's lead candidate). */
  party: string;
  partyKey: PartyKey | null;
  score: number;
  band: MatchBand;
  /** Suspended pending correction / right of reply — see {@link BallotRow.suspended}. */
  suspended: boolean;
  /** Number of candidates standing in this group (context for the voter). */
  candidates: number;
};

/** AEC ballot code for the ungrouped column — those candidates have no box above the line. */
const UNGROUPED = "UG";

const eq = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Deterministic, seed-driven ordering for candidates whose OFFICIAL ballot order does not yet exist —
 * a `provisional` (pre-draw) list. It is emphatically NOT score ranking and NOT the official order:
 * before the AEC ballot draw there is no lawful order at all, and an alphabetical or incumbency order
 * would bias the list, so a neutral randomised order is the least-biased option (docs/adr/0013, which
 * extends the no-ranking rule of docs/adr/0006 to the pre-draw state).
 *
 * It first sorts by a stable key so the result never depends on the dataset's array order, then
 * applies a Fisher–Yates shuffle driven by a small seeded PRNG (mulberry32 — no Math.random, so it is
 * pure and prerender-safe). Same `(items, seed)` → same order: a session that fixes one seed sees a
 * stable order across re-renders and a shared link recomputes identically; a different seed reshuffles.
 */
function seededOrder<T>(items: readonly T[], seed: number, keyOf: (t: T) => string): T[] {
  const sorted = [...items].sort((a, b) => keyOf(a).localeCompare(keyOf(b), "en"));
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = sorted[i]!;
    sorted[i] = sorted[j]!;
    sorted[j] = tmp;
  }
  return sorted;
}

/** Distinct sub-seed per chamber so House and Senate never share a shuffle stream for one session seed. */
const SENATE_SEED_SALT = 0x9e3779b9;

function scoreFor(key: PartyKey | null, percentages: ReadonlyMap<PartyKey, number>): number {
  if (key === null) return NO_RESULT;
  return percentages.get(key) ?? NO_RESULT;
}

/**
 * Maps computed party percentages onto the candidates on the user's ballot, in
 * OFFICIAL BALLOT ORDER — the engine does NOT rank by score and assigns no preference numbers. The
 * alignment score/band is carried as a per-row annotation (evidence only). Ordering the rows by
 * match, crowning a top pick or filling in preference numbers is exactly what the tool must not do
 * (Commonwealth Electoral Act 1918 s 351; see docs/adr/0006). The voter builds
 * their own order later, from a blank ballot.
 *
 * House: candidates in the user's `division`, in printed ballot position order.
 * Senate: candidates in the user's `state`, in ballot column order (group-code length, then group
 * code alphabetically, then position) — i.e. down the paper as printed.
 *
 * When `ballots.ballotStatus` is `provisional` (candidates nominated but the AEC draw not yet
 * declared, so `position` is not authoritative), the official-order sorts are replaced by a neutral
 * per-session {@link seededOrder} driven by `seed`; the alignment annotations are unchanged. A
 * `pending` ballot has no candidates, so both lists come back empty. `drawn` (the default) keeps the
 * strict official order. `seed` is ignored unless the status is `provisional`.
 */
export function mapBallot(
  ballots: Ballots,
  parties: readonly Party[],
  percentages: ReadonlyMap<PartyKey, number>,
  selection: { state: string; electorate: string },
  suspended: ReadonlySet<PartyKey> = new Set(),
  seed = 0,
): { house: HouseBallotRow[]; senate: SenateBallotRow[] } {
  const resolver = buildPartyResolver(parties);
  const provisional = (ballots.ballotStatus ?? "drawn") === "provisional";

  const toRow = (c: HouseCandidate | SenateCandidate): BallotRow => {
    const partyKey = resolver.resolve(c);
    // A suspended party's alignment is withdrawn pending a correction / right of reply: force the
    // row to no-alignment so the disputed figure never reaches any surface (fail-closed).
    const isSuspended = partyKey !== null && suspended.has(partyKey);
    const score = isSuspended ? NO_RESULT : scoreFor(partyKey, percentages);
    return {
      state: c.state,
      candidate: c.candidate,
      party: c.party,
      position: c.position,
      partyKey,
      score,
      band: bandFor(score),
      suspended: isSuspended,
    };
  };

  const houseRows: HouseBallotRow[] = ballots.house
    .filter((c) => eq(c.division, selection.electorate))
    .map((c) => ({ ...toRow(c), division: c.division }));
  const house = provisional
    ? seededOrder(houseRows, seed, (r) => r.candidate)
    : houseRows.sort((a, b) => a.position - b.position);

  const senateRows: SenateBallotRow[] = ballots.senate
    .filter((c) => eq(c.state, selection.state))
    .map((c) => ({ ...toRow(c), group: c.group }));
  const senate = provisional
    ? seededOrder(senateRows, seed ^ SENATE_SEED_SALT, (r) => r.candidate)
    : senateRows.sort(
        (a, b) =>
          a.group.length - b.group.length ||
          a.group.localeCompare(b.group, "en") ||
          a.position - b.position,
      );

  return { house, senate };
}

/**
 * Collapses scored below-the-line Senate candidates into above-the-line group boxes, in BALLOT
 * COLUMN order (group-code length, then group code alphabetically) — not ranked by score. The
 * ungrouped column is dropped because it has no box above the line. Each group carries the alignment
 * of its lead candidate (the lowest ballot position — the top of the ticket) as an annotation, whose
 * party is the name printed above the line; every candidate in a registered group ticket shares that
 * party, so this matches the paper. Pure and deterministic, like {@link mapBallot}.
 */
export function aboveTheLine(senate: readonly SenateBallotRow[]): SenateGroupRow[] {
  const byGroup = new Map<string, SenateBallotRow[]>();
  for (const row of senate) {
    if (row.group === UNGROUPED) continue;
    const rows = byGroup.get(row.group);
    if (rows) rows.push(row);
    else byGroup.set(row.group, [row]);
  }

  const groups: SenateGroupRow[] = [];
  for (const [group, rows] of byGroup) {
    const lead = rows.reduce((a, b) => (a.position <= b.position ? a : b));
    groups.push({
      state: lead.state,
      group,
      party: lead.party,
      partyKey: lead.partyKey,
      score: lead.score,
      band: lead.band,
      suspended: lead.suspended,
      candidates: rows.length,
    });
  }

  return groups.sort(
    (a, b) => a.group.length - b.group.length || a.group.localeCompare(b.group, "en"),
  );
}
