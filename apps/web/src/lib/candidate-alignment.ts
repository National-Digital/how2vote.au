/**
 * Candidate/party alignment wording — the SINGLE source of the copy that qualifies every alignment
 * figure shown on the card.
 *
 * The alignment score attached to a ballot row is a property of the candidate's PARTY's recorded
 * parliamentary voting, never of the individual candidate's personal views or future votes
 * (defamation / political-misattribution risk). To keep that qualification impossible to
 * drift, both the visible card copy AND the per-row presentation derive from the constants and the
 * pure {@link alignmentPresentation} function here, and the candidate-party-distinction guard
 * (scripts/check-candidate-distinction.mjs) asserts the party panel is the only surface that shows a
 * figure — the results screen lists no candidates at all.
 *
 * Four mutually-exclusive treatments, chosen fail-closed so a disputed or absent record can never be
 * shown as a number:
 *   - `suspended`         — the party's alignment is withdrawn pending a correction / right of reply
 *                           (a data-driven suspension list the runtime reads); NEVER a figure.
 *   - `independent`       — no party mapping (an independent / unmapped candidate); there is no party
 *                           record to attribute an alignment to, so we say so — never a fabricated
 *                           number.
 *   - `no-party-record`   — a mapped party with no recorded parliamentary votes on these questions.
 *   - `aligned`           — a mapped party with a record; the figure is shown, qualified as the
 *                           PARTY's alignment.
 */
import type { MatchBand } from "@how2vote/engine";

/**
 * The candidate/party predictive-claim limit, shown next to the scores — not only in the
 * Terms. A party record is not evidence of a candidate's own views or future votes. Kept as a
 * negated disclaimer so the neutrality lint (scripts/check-neutrality-claims.mjs) reads it as the
 * legitimate limitation it is.
 */
export const PARTY_ALIGNMENT_QUALIFIER =
  "Party alignment scores reflect selected historical parliamentary voting records associated with the party. They are not evidence of an individual candidate's personal views and do not predict how that candidate would vote in future.";

/** The independent / unmapped treatment — no party-position record exists, so none is invented. */
export const NO_PARTY_ALIGNMENT_BADGE = "No party alignment";
export const NO_PARTY_ALIGNMENT_DETAIL =
  "No party-position alignment available — this candidate is not mapped to a party voting record.";

/** A mapped party that has no recorded parliamentary votes on the scored propositions. */
export const NO_PARTY_RECORD_BADGE = "No voting record";
export const NO_PARTY_RECORD_DETAIL =
  "No recorded parliamentary votes for this party on these propositions.";

/** Alignment withdrawn pending a correction / right of reply (runtime suspension). */
export const SUSPENDED_BADGE = "Under review";
export const SUSPENDED_DETAIL =
  "This party's alignment is temporarily withdrawn while a correction is reviewed. See the corrections page.";

/**
 * The unit label shown after a figure. Every shown figure is the SAME measure — the percentage of
 * your answers a party's recorded votes align with — and carries the same label ("31% alignment",
 * "55% alignment") so the figures read as ranked off one scale. The wording never varies by band,
 * which would obscure that every percentage is on that one scale.
 */
export const ALIGNMENT_BADGE = "alignment";

export type AlignmentInput = {
  /** Resolved internal party key, or null for an independent / unmapped candidate. */
  partyKey: string | null;
  /** AEC ballot party name as printed (used to name whose record the figure describes). */
  party: string;
  score: number;
  band: MatchBand;
  suspended: boolean;
  /**
   * Display label of the parliamentary bloc this party belongs to (e.g. "Coalition"), when the
   * registry records one. Rows sharing a label are presented together as a registered family — each
   * keeps its own figure; the grouping never pools scores and never ranks.
   */
  federalGroup?: string;
  /** Short state/territory label for a state branch (e.g. "Qld", "NT"), shown as a muted suffix. */
  region?: string;
};

export type AlignmentPresentation = {
  kind: "suspended" | "independent" | "no-party-record" | "aligned";
  /** Whether a numeric alignment figure may be shown for this row. */
  showScore: boolean;
  /** The figure to show, or null when none may be shown (fail-closed). */
  score: number | null;
  /** Short pill label. */
  badge: string;
  /** Full sentence for screen readers / the "why" view — always qualifies the figure as the party's. */
  detail: string;
};

/**
 * Decide how one ballot row's alignment is presented. Pure and total, so it is the single place the
 * candidate/party distinction and the never-fabricate-a-number rule are enforced. Order matters:
 * suspension wins over everything, then a missing party mapping, then a mapped-but-recordless party,
 * then a real figure.
 */
export function alignmentPresentation(row: AlignmentInput): AlignmentPresentation {
  if (row.suspended) {
    return {
      kind: "suspended",
      showScore: false,
      score: null,
      badge: SUSPENDED_BADGE,
      detail: SUSPENDED_DETAIL,
    };
  }
  // No party mapping → an independent / unmapped candidate. There is no party record to attribute an
  // alignment to, so we never show (or infer) a number.
  if (row.partyKey === null) {
    return {
      kind: "independent",
      showScore: false,
      score: null,
      badge: NO_PARTY_ALIGNMENT_BADGE,
      detail: NO_PARTY_ALIGNMENT_DETAIL,
    };
  }
  // Mapped to a party, but the party has no recorded parliamentary votes on these questions.
  if (row.band === "no-data" || row.score < 0) {
    return {
      kind: "no-party-record",
      showScore: false,
      score: null,
      badge: NO_PARTY_RECORD_BADGE,
      detail: NO_PARTY_RECORD_DETAIL,
    };
  }
  // A mapped party with a record: show the figure, qualified as the PARTY's recorded alignment.
  const partyName = row.party.trim().length > 0 ? row.party.trim() : "this party";
  return {
    kind: "aligned",
    showScore: true,
    score: row.score,
    badge: ALIGNMENT_BADGE,
    detail: `Aligns with ${row.score}% of your answers with ${partyName}'s recorded parliamentary positions — not this candidate's personal views.`,
  };
}

/**
 * A single distinct party's alignment, as consumed by the party-level alignment panel. This is the
 * only shape the alignment figure is now attached to — never an individual candidate row (a
 * party record is not evidence of a candidate's personal views). Structurally identical to
 * {@link AlignmentInput}; kept as its own name so the party panel reads as party-keyed.
 */
export type PartyAlignmentRow = AlignmentInput;

/**
 * Reduce a chamber's ballot rows to the DISTINCT parties present, keyed by {@link AlignmentInput.partyKey}.
 *
 * Independents / unmapped candidates (partyKey === null) are DROPPED — they have no party voting
 * record to attribute a figure to, so they never appear in the party-level panel (they still appear
 * on the blank build-stage ballot the voter numbers, which carries no figure). The party-level score
 * is a property of the party, so every
 * candidate mapped to the same party carries the same figure; we keep the first occurrence in ballot
 * order. Pure, so the party-panel derivation is unit-testable and cannot drift.
 */
export function distinctPartyAlignments(rows: readonly PartyAlignmentRow[]): PartyAlignmentRow[] {
  const byParty = new Map<string, PartyAlignmentRow>();
  for (const row of rows) {
    if (row.partyKey === null) continue; // no party record → not a party-panel entry
    if (!byParty.has(row.partyKey)) byParty.set(row.partyKey, row);
  }
  return [...byParty.values()];
}

/**
 * One block of the party panel: either a standalone party or a registered family (e.g. the
 * Coalition) whose branches are shown TOGETHER. Grouping is factual and register-derived — it keeps
 * every member's own figure and never pools or ranks — so it presents the state brands as one
 * political force under several registrations without crowning any party (CEA 1918 s351).
 */
export type AlignmentBlock<T> =
  { kind: "single"; row: T } | { kind: "group"; label: string; rows: T[] };

/**
 * Cluster rows that share a {@link AlignmentInput.federalGroup} label into a single block, preserving
 * the incoming order otherwise: an ungrouped row keeps its place, and a family's block takes the
 * position of its FIRST member (members are never reordered relative to each other). Rows with no
 * label pass through as `single` blocks, so a ballot with no families renders exactly as before.
 * Pure, so the grouping is unit-testable and cannot drift.
 */
export function groupByFederalGroup<T extends { federalGroup?: string }>(
  rows: readonly T[],
): AlignmentBlock<T>[] {
  const blocks: AlignmentBlock<T>[] = [];
  const groupAt = new Map<string, number>();
  for (const row of rows) {
    const label = row.federalGroup;
    if (label === undefined) {
      blocks.push({ kind: "single", row });
      continue;
    }
    const at = groupAt.get(label);
    if (at === undefined) {
      groupAt.set(label, blocks.length);
      blocks.push({ kind: "group", label, rows: [row] });
    } else {
      (blocks[at] as { kind: "group"; label: string; rows: T[] }).rows.push(row);
    }
  }
  return blocks;
}
