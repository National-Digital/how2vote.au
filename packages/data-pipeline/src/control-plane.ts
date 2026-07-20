/**
 * Publication half of the runtime kill-switch control plane, for the build-time stats generator.
 *
 * The stats generator (bin/generate-stats.ts) must refuse to (re)publish public research aggregates
 * while the `publication` global scope is suspended — a data-poisoning or disclosure incident lever
 * that composes with the existing research-integrity alert (integrity.ts). Evaluation is FAIL-CLOSED:
 * an unreadable, malformed, unsigned, or tampered control plane, or an active `publication`
 * suspension, all SUSPEND publishing. Only an integrity-verified plane with no active `publication`
 * suspension permits a rewrite.
 *
 * The integrity check re-derives the same content digest the signer writes
 * (scripts/generate-control-plane.mjs) and the runtime recomputes
 * (apps/web/src/lib/governance/control-plane.ts). Pure and dependency-light so it is trivially tested.
 */

import { createHash } from "node:crypto";

const ENTRY_KEY_ORDER = [
  "scope",
  "electionId",
  "chamber",
  "electorate",
  "ballot",
  "partyKey",
  "propositionId",
  "mapId",
  "reason",
  "by",
  "flaggedAt",
  "ref",
  "liftedAt",
  "liftedBy",
] as const;

function canonicalEntry(s: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {};
  for (const k of ENTRY_KEY_ORDER) if (s[k] !== undefined) ordered[k] = s[k];
  return JSON.stringify(ordered);
}

/** Canonical string over the signed body — MUST match the signer and the runtime core. */
export function canonicalBody(body: { schemaVersion: unknown; suspensions: unknown[] }): string {
  const entries = (Array.isArray(body.suspensions) ? body.suspensions : [])
    .map((s) => canonicalEntry(s as Record<string, unknown>))
    .sort();
  return JSON.stringify({
    schemaVersion: body.schemaVersion,
    suspensions: entries.map((e) => JSON.parse(e)),
  });
}

/** The expected `integrity` value (`sha256-<hex>`) for a control-plane body. */
export function controlPlaneDigest(body: {
  schemaVersion: unknown;
  suspensions: unknown[];
}): string {
  return "sha256-" + createHash("sha256").update(canonicalBody(body)).digest("hex");
}

export interface PublicationVerdict {
  /** True ⇒ stat regeneration/publication must be suspended (fail closed). */
  suspended: boolean;
  reason: string;
}

/**
 * Decide whether public-stat publication is suspended, from the parsed control plane (or a parse
 * failure, passed as anything non-object). Fail-closed: only a well-formed, integrity-verified plane
 * with no active `publication` suspension permits publishing.
 */
export function evaluatePublicationSuspension(raw: unknown): PublicationVerdict {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { suspended: true, reason: "control plane is unreadable or malformed — failing closed" };
  }
  const plane = raw as Record<string, unknown>;
  if (plane.schemaVersion !== 1 || !Array.isArray(plane.suspensions)) {
    return { suspended: true, reason: "control plane has no valid body — failing closed" };
  }
  if (typeof plane.integrity !== "string" || !/^sha256-[0-9a-f]{64}$/.test(plane.integrity)) {
    return { suspended: true, reason: "control plane is unsigned — failing closed" };
  }
  let expected: string;
  try {
    expected = controlPlaneDigest({
      schemaVersion: plane.schemaVersion,
      suspensions: plane.suspensions,
    });
  } catch {
    return {
      suspended: true,
      reason: "control plane digest could not be recomputed — failing closed",
    };
  }
  if (expected !== plane.integrity) {
    return {
      suspended: true,
      reason: "control plane failed integrity verification (tampered) — failing closed",
    };
  }
  const active = plane.suspensions.filter(
    (s): s is Record<string, unknown> =>
      typeof s === "object" && s !== null && (s as Record<string, unknown>).liftedAt === undefined,
  );
  const pub = active.find((s) => s.scope === "publication");
  if (pub) {
    const reason = typeof pub.reason === "string" && pub.reason.trim() ? pub.reason : "unspecified";
    return { suspended: true, reason: `publication suspended by control plane — ${reason}` };
  }
  return { suspended: false, reason: "no active publication suspension" };
}
