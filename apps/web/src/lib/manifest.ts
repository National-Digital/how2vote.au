import { CURRENT_ELECTION_ID } from "@how2vote/data-schema";

/**
 * The per-election dataset manifests: tamper-evident checksum, data vintage, ODbL attribution and
 * counts, surfaced on the card, footer and content pages. Kept in their own module — separate from
 * the ~330 KB datasets — so the layout, footer and content pages can show attribution and per-
 * election question counts without pulling a dataset into their bundle. Each is tiny JSON (a few
 * hundred bytes), so all elections are safe to import statically here.
 *
 * Data-driven, not a hand-kept list: the eager glob below statically bundles every
 * data/dist/[id]/manifest.json committed to the repo, so adding an election needs NO edit here.
 * Manifests are tiny, so eager (build-time) bundling of all of them is intentional.
 */
export type Provenance = {
  basis: "contemporaneous-api-snapshot" | "primary-source-reconstruction";
  retrievedAt: string;
  effectiveAsAt: string | null;
  /** Generated disclosure statement — shown identically on the quiz and Insights. */
  statement: string;
};

export type Manifest = {
  checksum: string;
  dataVersion: string;
  /** Scoring-method (= matching-algorithm) version this release was built under. */
  methodologyVersion: string;
  /** Compliance-policy version this release was built and shipped under. */
  compliancePolicyVersion: string;
  attribution: string;
  builtFrom: string;
  provenance?: Provenance;
  counts: Record<string, number>;
};

/** A glob key like "…/data/dist/2025/manifest.json" (relative or absolute) → the election id "2025". */
const idFromGlobKey = (path: string): string => path.replace(/.*\/dist\//, "").split("/")[0]!;

const MANIFESTS: Record<string, Manifest> = Object.fromEntries(
  Object.entries(
    import.meta.glob<Manifest>("$data/dist/*/manifest.json", { eager: true, import: "default" }),
  ).map(([path, manifest]) => [idFromGlobKey(path), manifest]),
);

/** The manifest for an election, falling back to the current election for an unknown id. */
export function manifestFor(electionId: string): Manifest {
  return MANIFESTS[electionId] ?? MANIFESTS[CURRENT_ELECTION_ID]!;
}

/** The election's data-provenance disclosure, or null if it has no committed snapshot. */
export function provenanceFor(electionId: string): Provenance | null {
  return manifestFor(electionId).provenance ?? null;
}
