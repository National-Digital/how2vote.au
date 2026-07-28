/**
 * Stale-DATA predicate — is the dataset bundled in THIS build old enough to warn the voter?
 *
 * The dataset ships inside the binary with no OTA path (see docs/store-distribution.md), so an old
 * install is not a stale UI — it is stale candidate data, and it is most wrong exactly when it
 * matters most (opening a months-old install in the week before a poll). This module answers "should
 * we say something, and how loudly?" purely from data we already ship — the current election's
 * `dataVersion`, its `timetable`/`provisionalStage`, and the clock. It is IDENTICAL on every channel.
 *
 * INVARIANTS (enforced by scripts/check-staleness.mjs and the cross-channel unit test):
 *   - NO `fetch`/network — the "nothing is fetched at runtime" guarantee is absolute here.
 *   - NO channel branch (`isNativeShell` / `PUBLIC_DIST_CHANNEL` / `Capacitor`) — WHEN the notice
 *     fires and the `dataVersion` it fires on must not be able to drift per platform. Only the
 *     *remedy* (reload vs open store) differs, and that lives in the component, not here.
 */
import type { ElectionMeta } from "@how2vote/data-schema";

export type StalenessLevel = "none" | "notice" | "prominent";

export type StalenessVerdict = {
  /** none = stay silent; notice = low-key banner; prominent = the one case worth interrupting for. */
  level: StalenessLevel;
  /** The current election's bundled data date — the key a dismissal is remembered against. */
  dataVersion: string;
  /** Short, stable machine reason (for the unit tests and any telemetry). */
  reason: string;
};

const DAY_MS = 86_400_000;
/** Below the declaration the candidate list still churns by design; only nag past this age. */
const CHURN_STALE_DAYS = 14;

/** Parse a `YYYY-MM-DD` data date at AEST midnight, so it lines up with the +10:00 timetable stamps. */
function dataDateMs(dataVersion: string): number {
  return Date.parse(`${dataVersion}T00:00:00+10:00`);
}

/**
 * Assess the bundled data for the CURRENT election against `now`. Pure and channel-independent.
 * `elections` is the full bundled index; the verdict is computed from its `current: true` record.
 */
export function assessStaleness(elections: readonly ElectionMeta[], now: Date): StalenessVerdict {
  const current = elections.find((e) => e.current);
  const nowMs = now.getTime();

  if (!current) return { level: "none", dataVersion: "", reason: "no-current-election" };
  const dv = current.dataVersion;
  const verdict = (level: StalenessLevel, reason: string): StalenessVerdict => ({
    level,
    dataVersion: dv,
    reason,
  });

  // Clock behind the newest data we ship (device clock wrong/rewound) → fail closed to silence.
  const newestMs = Math.max(...elections.map((e) => dataDateMs(e.dataVersion)));
  if (nowMs < newestMs) return verdict("none", "clock-behind-data");

  const ageDays = (nowMs - dataDateMs(dv)) / DAY_MS;

  // Placeholder election with no timetable. "pending" has nothing volatile to be stale about;
  // once the draw is provisional/drawn the list is forming, so nag only if the bundle is old.
  if (current.provisionalStage) {
    if (current.provisionalStage === "pending") return verdict("none", "pending-placeholder");
    return ageDays > CHURN_STALE_DAYS
      ? verdict("notice", "provisional-list-stale")
      : verdict("none", "provisional-list-fresh");
  }

  const t = current.timetable;
  if (!t) return verdict("none", "no-timetable"); // schema guarantees one of timetable|provisionalStage

  const closeMs = dataDateMs(t.closeOfNominations);
  const declMs = Date.parse(t.declarationOfNominations);
  const pollsMs = Date.parse(t.pollsCloseAt);

  // Polls have closed for the bundled current election: a newer election generation exists upstream.
  if (nowMs > pollsMs) return verdict("notice", "past-polls");

  // The declared campaign. Either the bundle predates the declared candidates — the one case worth
  // interrupting for, because the ballot data is provably incomplete — or it carries them, in which
  // case it is FINAL and there is nothing to nag about: the list cannot change again before the poll,
  // so the churn rule below must not reach this window. Nagging here would put "a newer version may
  // be available" on the freshest possible build during poll week, with no newer version to get.
  if (nowMs >= declMs) {
    // Compare whole DAYS. `dataVersion` is date-only (parsed at AEST midnight) while the declaration
    // is a timestamp — noon +10:00 in every real timetable — so a same-day comparison against the
    // raw stamp reads the afternoon rebuild that FIRST carries the declared candidates as predating
    // them, and then says so prominently for the rest of the campaign.
    const declaredOnMs = dataDateMs(t.declarationOfNominations.slice(0, 10));
    return dataDateMs(dv) < declaredOnMs
      ? verdict("prominent", "predates-declaration")
      : verdict("none", "declared-list-final");
  }

  // Below the declaration only. Before nominations close the list still churns; between close and
  // declaration it is near-final. Either way, only nag when the bundle is genuinely old.
  if (nowMs < closeMs) {
    return ageDays > CHURN_STALE_DAYS
      ? verdict("notice", "pre-close-stale")
      : verdict("none", "pre-close-fresh");
  }
  return ageDays > CHURN_STALE_DAYS
    ? verdict("notice", "pre-declaration-stale")
    : verdict("none", "pre-declaration-fresh");
}
