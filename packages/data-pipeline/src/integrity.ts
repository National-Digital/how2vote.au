/**
 * Research integrity alert — the fail-closed switch that SUSPENDS public-stat regeneration during a
 * suspected ingestion-poisoning or integrity incident.
 *
 * The alert lives in docs/research/integrity-alert.json. While it is active, the stats generator
 * (bin/generate-stats.ts) must not regenerate or publish any snapshot, so a poisoned counter set can
 * never be baked into a published file. Evaluation is fail-closed: an unreadable or malformed alert is
 * treated as ACTIVE (suspended), because we would rather stop publishing than publish blind.
 *
 * Pure and dependency-free so it is trivially unit-tested.
 */

export interface IntegrityAlert {
  schemaVersion: number;
  active: boolean;
  scope?: string;
  declaredAt?: string | null;
  declaredBy?: string | null;
  reason?: string | null;
}

export interface SuspensionVerdict {
  /** True ⇒ stat regeneration must be suspended (fail closed). */
  suspended: boolean;
  reason: string;
}

/**
 * Decide whether stat regeneration is suspended, from the parsed alert (or a parse failure, passed as
 * anything non-object). Fail-closed: only an explicit, well-formed `active: false` permits publishing.
 */
export function evaluateIntegrityAlert(raw: unknown): SuspensionVerdict {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      suspended: true,
      reason: "integrity alert is unreadable or malformed — failing closed",
    };
  }
  const alert = raw as Record<string, unknown>;
  if (typeof alert.active !== "boolean") {
    return {
      suspended: true,
      reason: "integrity alert has no boolean `active` field — failing closed",
    };
  }
  if (alert.active) {
    const reason =
      typeof alert.reason === "string" && alert.reason.trim() ? alert.reason : "unspecified";
    const scope = typeof alert.scope === "string" && alert.scope.trim() ? alert.scope : "all";
    return {
      suspended: true,
      reason: `research integrity alert is ACTIVE (scope: ${scope}) — ${reason}`,
    };
  }
  return { suspended: false, reason: "no active integrity alert" };
}
