/**
 * Election-period emergency controls — the wired runtime kill-switch CONTROL PLANE (ADR 0006).
 *
 * This module binds the pure, fail-closed control-plane core (./governance/control-plane) to the two
 * committed, signed artefacts the app ships and exposes the capability checks the runtime asks:
 *
 *   - data/governance/control-plane.json — the multi-scope, integrity-signed suspension register.
 *     A scope can be withdrawn (global research/publication/printing/decoding; or a specific
 *     election/chamber/electorate/ballot/mapping/proposition/map) by editing this file and
 *     regenerating its digest, effective at the next deploy — no code change per incident.
 *   - data/corrections/suspensions.json — the pre-existing correction / right-of-reply party list
 *     It is now SUBSUMED here: `suspendedPartyKeys` unions it with the control plane's
 *     `mapping` scope, so both levers compose and the older data-driven lever keeps working.
 *
 * FAIL CLOSED: every check re-verifies the control plane's content digest first. A tampered or
 * unsigned artefact refuses every capability — the emergency lever can never be silently disabled.
 *
 * The kill switch is intentionally a data artefact rather than live runtime config: the site is a
 * static build, so flipping a scope + regenerating the digest + deploying is the fastest, least
 * error-prone lever during a campaign, and there is no runtime state to get out of sync.
 */

import controlPlane from "$data/governance/control-plane.json";
import corrections from "$data/corrections/suspensions.json";
import {
  capabilityVerdict,
  hasCorrectionNotice as hasCorrectionNoticeFor,
  isAllowed,
  isTampered,
  mappingSuspendedPartyKeys,
  suspendedPropositionIds as suspendedPropositionIdsFor,
  type Chamber,
  type Verdict,
} from "./governance/control-plane";

/** True while the committed control plane cannot be trusted (unsigned/tampered) — everything closed. */
export const CONTROL_PLANE_TAMPERED = isTampered(controlPlane);

/**
 * Global kill switch for building or printing a voting plan. `false` forces the whole site to
 * comparison-only — e.g. a ballot-order error, a revoked print approval, or a tampered control
 * plane — without a data rollback: the evidence stays available; only the plan builder and its
 * print/export are withdrawn. It is the `printing` global scope of the control plane (fail-closed),
 * kept as this named export because the deploy smoke test asserts the kill-switch surface is
 * reachable (scripts/smoke-live.mjs) and wired the card gate to it.
 */
export const EXPORTS_ENABLED = isAllowed(controlPlane, { kind: "printing" });

/** May a plan be printed for this election/electorate? (printing/election/electorate scopes.) */
export function isPrintingAllowed(electionId?: string, electorate?: string): boolean {
  return isAllowed(controlPlane, { kind: "printing", electionId, electorate });
}

/** May a shared link be DECODED for this election? (decoding/election scopes.) */
export function isDecodingAllowed(electionId?: string): boolean {
  return isAllowed(controlPlane, { kind: "decoding", electionId });
}

/** May new research contributions be accepted at all? (research global scope.) */
export function isResearchAllowed(): boolean {
  return isAllowed(controlPlane, { kind: "research" });
}

/** May public research stats be (re)published? (publication global scope.) */
export function isPublicationAllowed(): boolean {
  return isAllowed(controlPlane, { kind: "publication" });
}

/** Is this election available at all? (election scope + tamper.) */
export function isElectionAvailable(electionId: string): boolean {
  return isAllowed(controlPlane, { kind: "election", electionId });
}

/** Is this chamber shown for this election? (election/chamber scopes.) */
export function isChamberAvailable(electionId: string, chamber: Chamber): boolean {
  return isAllowed(controlPlane, { kind: "chamber", electionId, chamber });
}

/** Is this electorate available for this election? (election/electorate scopes.) */
export function isElectorateAvailable(electionId: string, electorate: string): boolean {
  return isAllowed(controlPlane, { kind: "electorate", electionId, electorate });
}

/** Is this specific ballot available? (election/chamber/ballot scopes.) */
export function isBallotAvailable(electionId: string, chamber: Chamber, ballot: string): boolean {
  return isAllowed(controlPlane, { kind: "ballot", electionId, chamber, ballot });
}

/** Is this electorate boundary map available to render? (map scope.) */
export function isMapAvailable(mapId: string): boolean {
  return isAllowed(controlPlane, { kind: "map", mapId });
}

/** The full verdict (with a human reason) for a capability — for surfaces that explain the refusal. */
export function governanceVerdict(cap: Parameters<typeof capabilityVerdict>[1]): Verdict {
  return capabilityVerdict(controlPlane, cap);
}

/** Correction-record structure of the right-of-reply list (data/corrections/suspensions.json). */
interface CorrectionEntry {
  electionId: string;
  partyKey: string;
}

/**
 * Party keys whose alignment is SUSPENDED for an election — the UNION of the corrections /
 * right-of-reply list and the control plane's `mapping` scope. Passed into
 * generateCard so every ballot surface withholds the disputed figure at once. Fail-closed: the
 * mapping half returns empty on a tampered plane, but a tampered plane also makes the election
 * unavailable, so the card refuses wholesale rather than showing a partial figure.
 */
export function suspendedPartyKeys(electionId: string): Set<string> {
  const fromCorrections = ((corrections.suspensions ?? []) as CorrectionEntry[])
    .filter((e) => e.electionId === electionId)
    .map((e) => e.partyKey);
  const fromPlane = mappingSuspendedPartyKeys(controlPlane, electionId);
  return new Set([...fromCorrections, ...fromPlane]);
}

/** Proposition ids EXCLUDED from scoring for an election (proposition scope). */
export function suspendedPropositionIds(electionId: string): Set<number> {
  return suspendedPropositionIdsFor(controlPlane, electionId);
}

/** Should the card show an "under review" correction banner for this election/electorate? */
export function hasCorrectionNotice(electionId: string, electorate?: string): boolean {
  return hasCorrectionNoticeFor(controlPlane, electionId, electorate);
}
