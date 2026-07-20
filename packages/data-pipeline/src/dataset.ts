import { readFile } from "node:fs/promises";
import {
  COMPLIANCE_POLICY_VERSION,
  CURRENT_ELECTION_ID,
  METHODOLOGY_VERSION,
  parseDataset,
  validateDataset,
  validateSnapshotConsistency,
  type Dataset,
  type ElectionMeta,
  type SnapshotBasis,
  type SnapshotMeta,
  type ValidationReport,
} from "@how2vote/data-schema";
import { checksum, electionPaths, paths, readJson, snapshotVersionPaths } from "./paths.js";
import { compileSnapshot, hashSnapshotFiles, loadActiveMeta } from "./snapshot.js";

/** Reads and shape-parses one election's three source files into a typed {@link Dataset}. */
export async function loadSource(electionId: string = CURRENT_ELECTION_ID): Promise<Dataset> {
  const src = electionPaths(electionId).source;
  const [questions, parties, ballots] = await Promise.all([
    readJson<unknown>(src.questions),
    readJson<unknown>(src.parties),
    readJson<unknown>(src.ballots),
  ]);
  return parseDataset({ questions, parties, ballots });
}

export type Manifest = {
  /** SHA-256 of the bundled dataset — the tamper-evident integrity checksum. */
  checksum: string;
  /** Data vintage (ISO date) — the latest division the positions are compiled from. */
  dataVersion: string;
  /**
   * The scoring-method version this release was built under (frozen per release, ADR 0005). The
   * scoring method IS the matching algorithm, so this is the "matching-algorithm version" dimension
   * of the reproducibility equation (see methodology.ts).
   */
  methodologyVersion: string;
  /**
   * The compliance-policy version this release was built and shipped under — the product rules
   * (authorisation/print, sharing, attribution, publishing, corrections, retention) that shape what
   * a user sees, shares and prints. The remaining dimension of the reproducibility equation
   * (see compliance-policy.ts).
   */
  compliancePolicyVersion: string;
  /** The locked snapshot version the release derives from, when a snapshot exists (ADR 0005). */
  snapshotVersion?: number;
  attribution: string;
  builtFrom: string;
  /**
   * Direct-API provenance the app surfaces on the quiz and Insights. Present when the
   * election has a committed snapshot; `statement` is generated from the fields so it cannot drift.
   */
  provenance?: {
    basis: SnapshotBasis;
    /** ISO datetime the raw TVFY API responses were retrieved. */
    retrievedAt: string;
    /** For a reconstruction: the compilation period the shown positions reflect; null otherwise. */
    effectiveAsAt: string | null;
    /** Human-readable disclosure, generated from the fields above. */
    statement: string;
  };
  counts: {
    questions: number;
    parties: number;
    house: number;
    senate: number;
    electorates: number;
  };
};

/**
 * The public provenance disclosure shown on the quiz and Insights. Generated from the
 * snapshot's basis + timestamps so the wording can never drift from the recorded provenance.
 */
export function provenanceStatement(
  basis: SnapshotBasis,
  retrievedAt: string,
  effectiveAsAt: string | null,
): string {
  // UTC calendar date of the retrieval instant (deterministic; snapshots are captured well clear of
  // a midnight boundary, so UTC vs AEST does not shift the displayed date).
  const retrieved = retrievedAt.slice(0, 10);
  if (basis === "primary-source-reconstruction") {
    return `Party positions reflect the parliamentary voting record as at ${effectiveAsAt}. The source data was retrieved from the They Vote For You API on ${retrieved} — a dated retrospective snapshot, not a contemporaneous election-day capture.`;
  }
  return `Party positions were captured from the They Vote For You API on ${retrieved}, during the election period.`;
}

export function buildManifest(dataset: Dataset, snapshotMeta?: SnapshotMeta): Manifest {
  return {
    checksum: checksum(dataset),
    dataVersion: dataset.questions.dataVersion,
    methodologyVersion: METHODOLOGY_VERSION,
    compliancePolicyVersion: COMPLIANCE_POLICY_VERSION,
    ...(snapshotMeta ? { snapshotVersion: snapshotMeta.version } : {}),
    attribution: dataset.questions.attribution,
    builtFrom: "They Vote For You (ODbL) + Australian Electoral Commission nominations",
    ...(snapshotMeta
      ? {
          provenance: {
            basis: snapshotMeta.basis,
            retrievedAt: snapshotMeta.retrievedAt,
            effectiveAsAt: snapshotMeta.effectiveAsAt,
            statement: provenanceStatement(
              snapshotMeta.basis,
              snapshotMeta.retrievedAt,
              snapshotMeta.effectiveAsAt,
            ),
          },
        }
      : {}),
    counts: {
      questions: dataset.questions.questions.length,
      parties: dataset.parties.parties.length,
      house: dataset.ballots.house.length,
      senate: dataset.ballots.senate.length,
      electorates: dataset.ballots.electorates.length,
    },
  };
}

/** Canonical JSON of a file's parsed content (null when absent) — for byte-order-insensitive equality. */
async function canonicalJson(path: string): Promise<string | null> {
  try {
    return JSON.stringify(JSON.parse(await readFile(path, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * The full per-election gate (ADR 0005): the referential {@link validateDataset} check always
 * runs; when a committed snapshot exists, {@link validateSnapshotConsistency} additionally proves
 * the source (and therefore the built dataset) is exactly what the snapshot compiles to. Both
 * `data:validate` and `dataset:build` run this, so dist can never be written from a
 * snapshot-divergent source. Returns the merged report and the active snapshot version.
 */
export async function validateElection(
  meta: ElectionMeta,
  dataset: Dataset,
): Promise<{ report: ValidationReport; snapshotMeta?: SnapshotMeta }> {
  const base = validateDataset(dataset);
  const snapshotMeta = await loadActiveMeta(meta.id);
  if (!snapshotMeta) return { report: base };

  const version = snapshotMeta.version;
  const vp = snapshotVersionPaths(meta.id, version);
  const compiled = await compileSnapshot(meta.id, version);
  const fileHashes = await hashSnapshotFiles(meta.id, version, Object.keys(snapshotMeta.files));
  const sourceBallots = await canonicalJson(electionPaths(meta.id).source.ballots);
  const lockedBallots = await canonicalJson(vp.ballots);

  const snapshot = validateSnapshotConsistency({
    meta: snapshotMeta,
    questions: dataset.questions,
    electionMeta: meta,
    compiled,
    fileHashes,
    ballots: { source: sourceBallots ?? "", locked: lockedBallots },
  });

  return {
    report: {
      ok: base.ok && snapshot.ok,
      errors: [...base.errors, ...snapshot.errors],
      warnings: [...base.warnings, ...snapshot.warnings],
    },
    snapshotMeta,
  };
}

export { paths, validateDataset };
