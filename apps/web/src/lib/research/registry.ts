/**
 * Signed research election registry — the server-side allowlist the ingestion Functions validate every
 * contribution against.
 *
 * The registry answers, for a given election: is it a VALID id, is it OPEN for new contributions, what
 * is its schema + accepted consent versions, and which party-match keys / proposition ids / stances /
 * demographic values may a contribution carry. Anything an incoming contribution asserts that is not
 * in the registry is out-of-registry and the contribution is dropped (poisoning prevention).
 *
 * It is assembled from three single-source-of-truth inputs so nothing is duplicated:
 *   - election-registry.json — the DATASET-derived, content-signed part (valid ids + per-election party
 *     keys + proposition ids), generated + drift-gated by scripts/generate-research-registry.mjs;
 *   - consent.ts — schema version, accepted consent versions, the stance list;
 *   - survey.ts — the demographic key → value allowlist (DEMOGRAPHIC_OPTIONS).
 *
 * The `integrity` digest on election-registry.json makes a tampered deployed artefact detectable
 * (`verifyRegistryIntegrity`), independently of the CI drift gate.
 */

import registryData from "./election-registry.json";
// The signed runtime kill-switch control plane. Imported by RELATIVE path (not the $data
// alias) because this module is bundled into the Cloudflare Pages Functions, which — unlike the
// SvelteKit client — do not resolve the $lib/$data aliases. The pure core fails closed on a tampered
// or unsigned plane, so a suspended `research` global scope or a suspended election closes intake.
import { isAllowed } from "../governance/control-plane";
import controlPlane from "../../../../../data/governance/control-plane.json";
import { DEMOGRAPHIC_OPTIONS } from "../survey-questions";
import {
  ACCEPTED_CONSENT_VERSIONS,
  RESEARCH_SCHEMA_VERSION,
  STANCES,
  classifyConsentVersion,
} from "./consent";

interface RegistryFile {
  version: number;
  integrity: string;
  elections: Record<string, { parties: string[]; propositionIds: number[] }>;
}

const REGISTRY: RegistryFile = registryData as RegistryFile;

/**
 * Which valid elections currently ACCEPT new contributions. Historical elections stay open for
 * retrospective contributions (cohort "historical"); flip an entry to close one election's intake
 * as a static, code-level complement to the signed runtime kill-switch, which is also
 * consulted in `registryEntry` below. An election absent here defaults to open, so a newly added
 * election is not silently closed.
 */
const CLOSED_ELECTIONS: ReadonlySet<string> = new Set();

/** The resolved, validation-ready view of one election's registry entry. */
export interface RegistryEntry {
  id: string;
  open: boolean;
  schemaVersion: number;
  acceptedConsentVersions: readonly string[];
  parties: ReadonlySet<string>;
  propositionIds: ReadonlySet<number>;
  stances: ReadonlySet<string>;
  demographics: Record<string, ReadonlySet<string>>;
}

const DEMOGRAPHIC_SETS: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries(DEMOGRAPHIC_OPTIONS).map(([key, options]) => [key, new Set(options)]),
);

/**
 * Fail-closed research-intake kill switch for an election, read from the signed control plane: a
 * global `research` suspension, a suspension of this election, or a tampered/unsigned plane closes
 * intake. This is the live runtime state — under the constrained product boundary (docs/adr/0010)
 * the global `research` scope is currently suspended, so this returns false for every election.
 */
export function researchIntakeOpen(id: string): boolean {
  return (
    isAllowed(controlPlane, { kind: "research" }) &&
    isAllowed(controlPlane, { kind: "election", electionId: id })
  );
}

/**
 * Resolve the full registry entry for an election id, or null if it is not a valid election.
 * `opts.intakeOpen` overrides the live kill-switch read (used by unit tests that exercise the
 * allowlist/schema/consent logic independently of the current suspension state); runtime callers
 * omit it and get the live, fail-closed control-plane verdict.
 */
export function registryEntry(
  id: unknown,
  opts: { intakeOpen?: boolean } = {},
): RegistryEntry | null {
  if (typeof id !== "string") return null;
  const dataset = REGISTRY.elections[id];
  if (!dataset) return null;
  // The token endpoint and both ingestion Functions gate on `open`, so a suspended election can no
  // longer receive contributions.
  const killSwitchOpen = opts.intakeOpen ?? researchIntakeOpen(id);
  return {
    id,
    open: !CLOSED_ELECTIONS.has(id) && killSwitchOpen,
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    acceptedConsentVersions: ACCEPTED_CONSENT_VERSIONS,
    parties: new Set(dataset.parties),
    propositionIds: new Set(dataset.propositionIds),
    stances: new Set(STANCES),
    demographics: DEMOGRAPHIC_SETS,
  };
}

/** Is this a valid, open election for new contributions? `opts.intakeOpen` overrides the live
 * kill-switch read (tests); runtime callers omit it and get the fail-closed control-plane verdict. */
export function isElectionOpen(id: unknown, opts: { intakeOpen?: boolean } = {}): boolean {
  const entry = registryEntry(id, opts);
  return entry !== null && entry.open;
}

/** Why a contribution failed registry validation (coarse, non-identifying — safe for anomaly metrics). */
export type RegistryRejection =
  | "unknown-election"
  | "closed-election"
  | "schema-mismatch"
  | "consent-not-accepted"
  | "party-not-in-registry"
  | "proposition-not-in-registry";

export type RegistryVerdict = { ok: true } | { ok: false; reason: RegistryRejection };

/** The already-shape-cleaned values the registry cross-checks (a subset of CleanContribution). */
export interface RegistryCheckInput {
  electionId: string;
  schemaVersion: number;
  consentVersion: string;
  match: string | null;
  propositionIds: number[];
}

/**
 * Validate a shape-clean contribution against the registry. Any single out-of-registry value fails the
 * whole contribution (strict — a poisoned value must never be silently stored). Stances and demographic
 * values are already validated in the ingestion `clean()` against the same survey allowlist, so this
 * focuses on the election / schema / consent / party / proposition facts the registry owns.
 */
export function checkAgainstRegistry(
  input: RegistryCheckInput,
  opts: { intakeOpen?: boolean } = {},
): RegistryVerdict {
  const entry = registryEntry(input.electionId, opts);
  if (entry === null) return { ok: false, reason: "unknown-election" };
  if (!entry.open) return { ok: false, reason: "closed-election" };
  if (input.schemaVersion !== entry.schemaVersion) return { ok: false, reason: "schema-mismatch" };
  if (classifyConsentVersion(input.consentVersion) !== "accepted") {
    return { ok: false, reason: "consent-not-accepted" };
  }
  if (input.match !== null && !entry.parties.has(input.match)) {
    return { ok: false, reason: "party-not-in-registry" };
  }
  for (const id of input.propositionIds) {
    if (!entry.propositionIds.has(id)) return { ok: false, reason: "proposition-not-in-registry" };
  }
  return { ok: true };
}

/**
 * Recompute the content digest over the registry body and compare it to the committed `integrity`
 * field. Detects a tampered deployed election-registry.json independently of the CI drift gate. Must
 * mirror registryDigest() in scripts/generate-research-registry.mjs exactly.
 */
export async function verifyRegistryIntegrity(): Promise<boolean> {
  const canonicalElections: Record<string, { parties: string[]; propositionIds: number[] }> = {};
  for (const id of Object.keys(REGISTRY.elections).sort()) {
    const e = REGISTRY.elections[id];
    canonicalElections[id] = {
      parties: [...e.parties].sort(),
      propositionIds: [...e.propositionIds].sort((a, b) => a - b),
    };
  }
  const canonical = JSON.stringify({ version: REGISTRY.version, elections: canonicalElections });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return REGISTRY.integrity === `sha256-${hex}`;
}

/** The registry's content-integrity digest (`sha256-<hex>`), for provenance display / manifests. */
export const REGISTRY_INTEGRITY = REGISTRY.integrity;
