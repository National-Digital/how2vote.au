/**
 * Runtime kill-switch CONTROL PLANE — pure, fail-closed core.
 *
 * A signed, tamper-evident suspension register that lets an operator withdraw a capability at a
 * chosen SCOPE without a full redeploy of new code — a data edit + regenerate of the signed artefact
 * (data/governance/control-plane.json) is enough. When a scope is suspended the runtime REFUSES that
 * capability rather than degrading silently:
 *
 *   global   — research | publication | printing | decoding (share-link decode)
 *   granular — election | chamber | electorate | ballot | mapping | proposition | map
 *
 * This GENERALISES the data-driven correction-suspension list
 * (data/corrections/suspensions.json → $lib/corrections): a `mapping` suspension here is exactly a
 * withdrawn party alignment, and the two sources are unioned in $lib/governance so nothing regresses.
 *
 * FAIL CLOSED is the governing rule. Every decision here first re-verifies the artefact's content
 * digest with the synchronous SHA-256 in ./sha256 (mirrors the Node signer in
 * scripts/generate-control-plane.mjs). If the digest does not verify — a tampered or unsigned
 * artefact — EVERY capability is refused: a suspension that an attacker deleted cannot come back to
 * life, and a broken control plane never silently enables anything.
 *
 * This module is PURE: it takes a parsed control plane as an argument and never reads a file, so the
 * incident-rehearsal suite can drive every scope (and tampering, and restore) with plain objects.
 * The wired singletons that read the committed artefact live in $lib/governance.
 */

import { sha256Hex } from "./sha256";

export const CONTROL_PLANE_SCHEMA_VERSION = 1;

/** Every scope at which a capability can be suspended. */
export const SCOPES = [
  "research",
  "publication",
  "printing",
  "decoding",
  "election",
  "chamber",
  "electorate",
  "ballot",
  "mapping",
  "proposition",
  "map",
] as const;
export type Scope = (typeof SCOPES)[number];

/** The four global scopes carry no selector — they suspend a whole capability everywhere. */
export const GLOBAL_SCOPES = ["research", "publication", "printing", "decoding"] as const;

export type Chamber = "house" | "senate";

/** One audited suspension entry. Selector fields are scope-specific (validated by the CI guard). */
export interface Suspension {
  scope: Scope;
  electionId?: string;
  chamber?: Chamber;
  /** Electorate slug (House division), for the `electorate` scope. */
  electorate?: string;
  /** Ballot identifier within a chamber (House: electorate slug; Senate: state code), for `ballot`. */
  ballot?: string;
  /** Party-match key, for the `mapping` scope (subsumes the correction/right-of-reply list). */
  partyKey?: string;
  /** Proposition (question) id, for the `proposition` scope. */
  propositionId?: number;
  /** Map identifier (`<electionId>/<STATE>`), for the `map` scope. */
  mapId?: string;
  reason: string;
  /** Who authorised the suspension (audit trail). */
  by: string;
  /** ISO date/datetime the suspension was raised (audit trail). */
  flaggedAt: string;
  /** Optional reference — an incident id, a correction ticket, a ballot-dispute ref. */
  ref?: string;
  /** Set when a suspension has been lifted; kept as an audited RESTORE record rather than deleted. */
  liftedAt?: string;
  liftedBy?: string;
}

export interface ControlPlane {
  schemaVersion: number;
  updated?: string;
  note?: string;
  suspensions: Suspension[];
  /** Content digest over the `{schemaVersion, suspensions}` body: `sha256-<hex>`. */
  integrity: string;
}

/** The capability a caller wants to exercise; `capabilityVerdict` answers whether it is allowed. */
export type Capability =
  | { kind: "research" }
  | { kind: "publication" }
  | { kind: "printing"; electionId?: string; electorate?: string }
  | { kind: "decoding"; electionId?: string }
  | { kind: "election"; electionId: string }
  | { kind: "chamber"; electionId: string; chamber: Chamber }
  | { kind: "electorate"; electionId: string; electorate: string }
  | { kind: "ballot"; electionId: string; chamber: Chamber; ballot: string }
  | { kind: "proposition"; electionId: string; propositionId: number }
  | { kind: "map"; mapId: string };

export interface Verdict {
  allowed: boolean;
  reason: string;
}

/**
 * Canonical string over the signed body (`{schemaVersion, suspensions}`). Independent of incidental key
 * order and of the order of the suspensions array, so a hand edit that only reorders entries still
 * verifies. MUST match `canonicalBody` in scripts/generate-control-plane.mjs byte-for-byte.
 */
export function canonicalString(
  plane: Pick<ControlPlane, "schemaVersion" | "suspensions">,
): string {
  const entries = (Array.isArray(plane.suspensions) ? plane.suspensions : [])
    .map((s) => canonicalEntry(s))
    .sort();
  return JSON.stringify({
    schemaVersion: plane.schemaVersion,
    suspensions: entries.map((e) => JSON.parse(e)),
  });
}

/** Serialise one entry with its keys in a fixed order, omitting absent fields. */
function canonicalEntry(s: Suspension): string {
  const ordered: Record<string, unknown> = {};
  for (const k of [
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
  ] as const) {
    const v = (s as unknown as Record<string, unknown>)[k];
    if (v !== undefined) ordered[k] = v;
  }
  return JSON.stringify(ordered);
}

/** The expected `integrity` value for a body: `sha256-<hex>`. */
export function controlPlaneDigest(
  plane: Pick<ControlPlane, "schemaVersion" | "suspensions">,
): string {
  return `sha256-${sha256Hex(canonicalString(plane))}`;
}

/**
 * Is this a structurally sane, integrity-verified control plane? Fail-closed: anything malformed,
 * unsigned, or whose recomputed digest does not match the recorded one returns false — the caller
 * then refuses every capability.
 */
export function verifyIntegrity(plane: unknown): plane is ControlPlane {
  if (typeof plane !== "object" || plane === null || Array.isArray(plane)) return false;
  const p = plane as Record<string, unknown>;
  if (p.schemaVersion !== CONTROL_PLANE_SCHEMA_VERSION) return false;
  if (!Array.isArray(p.suspensions)) return false;
  if (typeof p.integrity !== "string" || !/^sha256-[0-9a-f]{64}$/.test(p.integrity)) return false;
  let expected: string;
  try {
    expected = controlPlaneDigest({
      schemaVersion: p.schemaVersion,
      suspensions: p.suspensions as Suspension[],
    });
  } catch {
    return false; // any error recomputing the digest is treated as tampering
  }
  return expected === p.integrity;
}

/** An entry is ACTIVE only while it has not been lifted (a RESTORE record sets `liftedAt`). */
const isActive = (s: Suspension): boolean => !s.liftedAt;

/** Active suspensions of a given scope, from a plane already known to be integrity-verified. */
function active(plane: ControlPlane, scope: Scope): Suspension[] {
  return plane.suspensions.filter((s) => s.scope === scope && isActive(s));
}

/**
 * The fail-closed decision for a capability. If the plane fails integrity verification, EVERY
 * capability is refused. Otherwise a capability is refused when any active suspension covers it,
 * honouring the hierarchy global ⊃ election ⊃ `{chamber, electorate, ballot, proposition}`.
 */
export function capabilityVerdict(plane: unknown, cap: Capability): Verdict {
  if (!verifyIntegrity(plane)) {
    return {
      allowed: false,
      reason: "control plane failed integrity verification — failing closed",
    };
  }
  const p = plane;

  const matched = (scope: Scope, pred: (s: Suspension) => boolean): Suspension | undefined =>
    active(p, scope).find(pred);

  const electionSuspended = (electionId?: string): Suspension | undefined =>
    electionId === undefined ? undefined : matched("election", (s) => s.electionId === electionId);

  let hit: Suspension | undefined;
  switch (cap.kind) {
    case "research":
      hit = matched("research", () => true);
      break;
    case "publication":
      hit = matched("publication", () => true);
      break;
    case "printing":
      hit =
        matched("printing", () => true) ??
        electionSuspended(cap.electionId) ??
        (cap.electionId !== undefined && cap.electorate !== undefined
          ? matched(
              "electorate",
              (s) => s.electionId === cap.electionId && s.electorate === cap.electorate,
            )
          : undefined);
      break;
    case "decoding":
      hit = matched("decoding", () => true) ?? electionSuspended(cap.electionId);
      break;
    case "election":
      hit = electionSuspended(cap.electionId);
      break;
    case "chamber":
      hit =
        electionSuspended(cap.electionId) ??
        matched("chamber", (s) => s.electionId === cap.electionId && s.chamber === cap.chamber);
      break;
    case "electorate":
      hit =
        electionSuspended(cap.electionId) ??
        matched(
          "electorate",
          (s) => s.electionId === cap.electionId && s.electorate === cap.electorate,
        );
      break;
    case "ballot":
      hit =
        electionSuspended(cap.electionId) ??
        matched("chamber", (s) => s.electionId === cap.electionId && s.chamber === cap.chamber) ??
        matched(
          "ballot",
          (s) =>
            s.electionId === cap.electionId && s.chamber === cap.chamber && s.ballot === cap.ballot,
        );
      break;
    case "proposition":
      hit =
        electionSuspended(cap.electionId) ??
        matched(
          "proposition",
          (s) => s.electionId === cap.electionId && s.propositionId === cap.propositionId,
        );
      break;
    case "map":
      hit = matched("map", (s) => s.mapId === cap.mapId);
      break;
  }

  if (hit) {
    return { allowed: false, reason: `suspended (${hit.scope}): ${hit.reason}` };
  }
  return { allowed: true, reason: "no active suspension" };
}

/** Convenience boolean form of {@link capabilityVerdict}. */
export function isAllowed(plane: unknown, cap: Capability): boolean {
  return capabilityVerdict(plane, cap).allowed;
}

/**
 * Party-match keys whose alignment is SUSPENDED for an election (the `mapping` scope). Subsumes the
 * correction/right-of-reply list. Empty on a plane that fails integrity — the caller (card) refuses
 * the whole election on tamper anyway, so no disputed figure can leak either way.
 */
export function mappingSuspendedPartyKeys(plane: unknown, electionId: string): Set<string> {
  if (!verifyIntegrity(plane)) return new Set();
  return new Set(
    active(plane, "mapping")
      .filter((s) => s.electionId === electionId && typeof s.partyKey === "string")
      .map((s) => s.partyKey as string),
  );
}

/**
 * Proposition (question) ids SUSPENDED for an election (the `proposition` scope). A suspended
 * proposition is EXCLUDED from scoring — the caller drops those answers before building a card.
 * Empty on a plane that fails integrity (the election is refused wholesale on tamper).
 */
export function suspendedPropositionIds(plane: unknown, electionId: string): Set<number> {
  if (!verifyIntegrity(plane)) return new Set();
  return new Set(
    active(plane, "proposition")
      .filter((s) => s.electionId === electionId && typeof s.propositionId === "number")
      .map((s) => s.propositionId as number),
  );
}

/**
 * Is there an active GRANULAR suspension affecting what a card for this election (and, if given,
 * electorate) shows — a withdrawn mapping/proposition, or a suspended chamber/electorate/ballot?
 * Drives the "under review" correction banner. False on a failed-integrity plane, because the card
 * is refused wholesale in that case (a banner on a page that never renders would be pointless).
 */
export function hasCorrectionNotice(
  plane: unknown,
  electionId: string,
  electorate?: string,
): boolean {
  if (!verifyIntegrity(plane)) return false;
  const forElection = (s: Suspension): boolean => s.electionId === electionId && isActive(s);
  return plane.suspensions.some(
    (s) =>
      forElection(s) &&
      (s.scope === "mapping" ||
        s.scope === "proposition" ||
        s.scope === "chamber" ||
        s.scope === "ballot" ||
        (s.scope === "electorate" && (electorate === undefined || s.electorate === electorate))),
  );
}

/** True when the plane cannot be trusted — used to surface a fail-closed banner / unavailable state. */
export function isTampered(plane: unknown): boolean {
  return !verifyIntegrity(plane);
}
