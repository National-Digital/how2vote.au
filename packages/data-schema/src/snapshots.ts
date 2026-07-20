import { z } from "zod";
import type { ElectionMeta } from "./elections.js";
import type { QuestionSet } from "./schemas.js";
import type { ValidationIssue, ValidationReport } from "./validate.js";

/**
 * The TVFY snapshot store (ADR 0005) —
 * the committed, immutable record of the They Vote For You data behind each election's questions.
 *
 * Every snapshot is now a DIRECT TVFY API capture (`source: "tvfy-api"`); there is no external
 * web-archive path any more. Two evidentiary bases exist (`basis`):
 *
 *  - `contemporaneous-api-snapshot` — captured live during the election's writ window and locked at
 *    the declaration of nominations. At that instant TVFY's all-time aggregate agreement IS the
 *    relevant-period record, so the snapshot both provides AND verifies the shown positions
 *    (positions must equal the snapshot compilation).
 *
 *  - `primary-source-reconstruction` — a PAST election (2019/2022, and 2025 whose window has closed)
 *    whose positions rest on the retained vintage compilation (originally direct-API-derived at the
 *    time; the raw responses were not preserved). This snapshot is a FRESH direct-API provenance
 *    capture — evidence that the data is direct-API-sourced, not the position source. Positions are
 *    NOT recomputed from it, because a fetch today spans post-election divisions; the compilation
 *    period the vintage positions reflect is recorded in `effectiveAsAt`.
 *
 * Layout, per election, under `data/snapshots/tvfy/<electionId>/`:
 *
 *   versions.json          — which snapshot versions exist and which is active
 *   v<N>/meta.json         — one snapshot version: provenance, lock state, file hashes
 *   v<N>/policies-list.json — the full TVFY `/policies.json` response at capture time
 *   v<N>/policies/<id>.json — raw per-policy API responses (used policy ids only)
 *   v<N>/ballots.json      — copy of the election's ballots.json at lock time
 *
 * Once a version is locked it is immutable: a verified factual correction is a NEW locked version
 * with a recorded reason and verifier, never an edit to a locked one. CI enforces this mechanically
 * (scripts/check-locked-snapshots.mjs).
 */

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "expected a lowercase hex sha-256");

/** Every snapshot is a direct TVFY API capture — the only source. */
export const snapshotSourceSchema = z.enum(["tvfy-api"]);
export type SnapshotSource = z.infer<typeof snapshotSourceSchema>;

/**
 * The evidentiary basis for a snapshot's party positions:
 *  - `contemporaneous-api-snapshot`  — captured live in the writ window; positions are verified
 *    against this snapshot's compilation.
 *  - `primary-source-reconstruction` — a past election on retained vintage positions; this snapshot
 *    is a fresh direct-API provenance capture and does NOT drive/verify the positions.
 */
export const snapshotBasisSchema = z.enum([
  "contemporaneous-api-snapshot",
  "primary-source-reconstruction",
]);
export type SnapshotBasis = z.infer<typeof snapshotBasisSchema>;

export const snapshotMetaSchema = z
  .object({
    schemaVersion: z.literal(2),
    electionId: z.string().regex(/^[a-z0-9-]+$/),
    /** 1-based snapshot version — matches the `v<N>` directory and versions.json entry. */
    version: z.number().int().positive(),
    source: snapshotSourceSchema,
    basis: snapshotBasisSchema,
    /** Direct TVFY API endpoint base the raw responses were fetched from. */
    endpoint: z.string().url(),
    /** When the raw API responses were retrieved (ISO datetime + offset) — the provenance stamp. */
    retrievedAt: z.string().datetime({ offset: true }),
    /** SHA-256 over the raw response bytes as fetched — an independent-refetch provenance anchor. */
    responseSha256: sha256Schema,
    /** TVFY API schema version, e.g. "v1". */
    apiSchemaVersion: z.string().min(1),
    /** Licence the responses are provided under, e.g. "ODbL-1.0". */
    licenceVersion: z.string().min(1),
    /**
     * For `primary-source-reconstruction`: the compilation period (date) the vintage positions
     * reflect — the honest "as at" for the shown scores. Null for contemporaneous snapshots (their
     * effective date IS the retrieval/lock instant).
     */
    effectiveAsAt: z.string().nullable(),
    locked: z.boolean(),
    lockedAt: z.string().datetime({ offset: true }).nullable(),
    /** TVFY policy ids used by this election's questions.json at snapshot time. */
    policyIds: z.array(z.number().int().positive()).min(1),
    /** Snapshot-dir-relative path → SHA-256 of the file's parsed canonical JSON. */
    files: z.record(z.string(), sha256Schema),
  })
  .strict()
  .refine((m) => !m.locked || m.lockedAt !== null, {
    message: "a locked snapshot must record lockedAt",
  })
  .refine((m) => m.basis !== "primary-source-reconstruction" || m.effectiveAsAt !== null, {
    message: "a primary-source-reconstruction snapshot must record effectiveAsAt",
  })
  .refine((m) => m.basis !== "contemporaneous-api-snapshot" || m.effectiveAsAt === null, {
    message:
      "a contemporaneous-api-snapshot must not set effectiveAsAt (its effective date is the retrieval instant)",
  })
  .refine((m) => m.effectiveAsAt === null || /^\d{4}-\d{2}-\d{2}$/.test(m.effectiveAsAt), {
    message: "effectiveAsAt must be a YYYY-MM-DD date or null",
  });
export type SnapshotMeta = z.infer<typeof snapshotMetaSchema>;

export const snapshotVersionEntrySchema = z
  .object({
    version: z.number().int().positive(),
    createdAt: z.string().datetime({ offset: true }),
    lockedAt: z.string().datetime({ offset: true }).nullable(),
    /** Why this version exists — REQUIRED for every version after the first (a correction). */
    reason: z.string().min(1).optional(),
    /** Who verified the correction — REQUIRED for every version after the first. */
    verifiedBy: z.string().min(1).optional(),
    /** The version this one supersedes (normally version - 1). */
    supersedes: z.number().int().positive().optional(),
  })
  .strict()
  .refine((e) => e.version === 1 || (e.reason !== undefined && e.verifiedBy !== undefined), {
    message: "versions after the first are corrections and must record reason and verifiedBy",
  });
export type SnapshotVersionEntry = z.infer<typeof snapshotVersionEntrySchema>;

export const snapshotVersionsSchema = z
  .object({
    schemaVersion: z.literal(1),
    electionId: z.string().regex(/^[a-z0-9-]+$/),
    /** The version the pipeline reads — normally the newest. */
    active: z.number().int().positive(),
    history: z.array(snapshotVersionEntrySchema).min(1),
  })
  .strict()
  .refine((v) => v.history.some((h) => h.version === v.active), {
    message: "active must reference a version present in history",
  })
  .refine((v) => v.history.every((h, i) => h.version === i + 1), {
    message: "history versions must be sequential from 1",
  });
export type SnapshotVersions = z.infer<typeof snapshotVersionsSchema>;

/**
 * The compiled view of one snapshot policy the consistency gate compares against — structurally
 * a subset of the pipeline's `CompiledPolicy` (compiled from the snapshot's own policy files, so
 * the comparison is snapshot ↔ questions.json, never the live API).
 */
export type SnapshotCompiledPolicy = {
  id: number;
  divisionCount: number;
  divisionFirst: string | null;
  divisionLast: string | null;
  positions: Record<string, number>;
};

export type SnapshotConsistencyInput = {
  meta: SnapshotMeta;
  questions: QuestionSet;
  electionMeta: ElectionMeta;
  /** Per-policy compilation of the SNAPSHOT's committed raw policy files. */
  compiled: ReadonlyMap<number, SnapshotCompiledPolicy>;
  /** Recomputed hashes of the snapshot files on disk, same keying as `meta.files`. */
  fileHashes: Record<string, string>;
  /** Canonical JSON of `data/source/<id>/ballots.json` and of the locked copy (null if no copy). */
  ballots: { source: string; locked: string | null };
};

const issue = (
  severity: "error" | "warning",
  code: string,
  message: string,
  items?: string[],
): ValidationIssue => ({
  severity,
  code,
  message,
  ...(items && items.length > 0 ? { items } : {}),
});

/** Tamper check: the committed snapshot files must hash to what meta.json recorded. */
function hashDriftIssues(
  meta: SnapshotMeta,
  fileHashes: Record<string, string>,
): ValidationIssue[] {
  const hashKeys = new Set([...Object.keys(meta.files), ...Object.keys(fileHashes)]);
  const hashDrift = [...hashKeys].filter((k) => meta.files[k] !== fileHashes[k]);
  if (hashDrift.length === 0) return [];
  return [
    issue(
      "error",
      "snapshot-hash-mismatch",
      "Snapshot files do not hash to what meta.json recorded (tampered, missing, or unlisted).",
      hashDrift.map(
        (k) => `${k}: recorded=${meta.files[k] ?? "absent"} actual=${fileHashes[k] ?? "absent"}`,
      ),
    ),
  ];
}

/** The locked ballots copy, if any, must be byte-identical to the live source ballots. */
function ballotsDriftIssues(ballots: { source: string; locked: string | null }): ValidationIssue[] {
  if (ballots.locked === null || ballots.source === ballots.locked) return [];
  return [
    issue(
      "error",
      "ballots-drift",
      "data/source ballots.json differs from the copy locked with this snapshot. A post-lock ballot change must arrive as a new verified snapshot version.",
    ),
  ];
}

/**
 * The snapshot consistency gate (ADR 0005, revised) — proves the hand-curated questions.json (and
 * the built dataset derived from it) is exactly what the committed snapshot warrants, so nothing
 * can drift between the locked record and what the app ships.
 *
 * `contemporaneous-api-snapshot` (current/future elections): FULL consistency — question ids,
 * `meta.policyIds` and the snapshot policy files agree; every non-withdrawn question's positions and
 * division fields deep-equal the snapshot compilation; `questions.dataVersion` equals the latest
 * compiled division date and the ELECTIONS registry agrees; files hash to `meta.files`; ballots match.
 *
 * `primary-source-reconstruction` (past elections on retained vintage positions): PROVENANCE ONLY —
 * every question id must have a captured snapshot policy file (coverage), the files hash to
 * `meta.files` (tamper), and the ballots copy matches. Positions/division fields are NOT compared:
 * they are the vintage compilation, deliberately not recomputed from a fetch that now spans
 * post-election divisions.
 *
 * Pure and side-effect free, mirroring {@link validateDataset}.
 */
export function validateSnapshotConsistency(input: SnapshotConsistencyInput): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const { meta, questions, electionMeta, compiled, fileHashes, ballots } = input;

  const questionIds = questions.questions.map((q) => q.id);
  const withdrawn = questions.questions.filter((q) => q.withdrawn !== undefined);
  if (withdrawn.length > 0) {
    warnings.push(
      issue(
        "warning",
        "question-withdrawn",
        "Withdrawn questions (disabled outputs, exempt from consistency checks).",
        withdrawn.map((q) => `${q.id}: ${q.withdrawn?.reason ?? ""}`),
      ),
    );
  }

  if (electionMeta.dataVersion !== questions.dataVersion) {
    errors.push(
      issue(
        "error",
        "election-dataversion-mismatch",
        `ELECTIONS registry dataVersion (${electionMeta.dataVersion}) does not match questions.json (${questions.dataVersion}).`,
      ),
    );
  }

  if (meta.basis === "primary-source-reconstruction") {
    // Coverage: every live question id must have a captured snapshot policy file.
    const captured = new Set(compiled.keys());
    const uncovered = questionIds.filter((id) => !captured.has(id));
    if (uncovered.length > 0) {
      errors.push(
        issue(
          "error",
          "reconstruction-coverage",
          "Questions without a captured direct-API policy file in the provenance snapshot.",
          uncovered.map(String),
        ),
      );
    }
    errors.push(...hashDriftIssues(meta, fileHashes));
    errors.push(...ballotsDriftIssues(ballots));
    return { ok: errors.length === 0, errors, warnings };
  }

  // — contemporaneous-api-snapshot: full consistency —
  const metaIds = new Set(meta.policyIds);
  const qIds = new Set(questionIds);
  const missingFromMeta = questionIds.filter((id) => !metaIds.has(id));
  const missingFromQuestions = meta.policyIds.filter((id) => !qIds.has(id));
  if (missingFromMeta.length > 0 || missingFromQuestions.length > 0) {
    errors.push(
      issue(
        "error",
        "snapshot-policy-mismatch",
        "Question ids and snapshot policyIds do not agree.",
        [
          ...missingFromMeta.map((id) => `question ${id} has no snapshot policy`),
          ...missingFromQuestions.map((id) => `snapshot policy ${id} has no question`),
        ],
      ),
    );
  }

  const divisionLasts: string[] = [];
  for (const q of questions.questions) {
    const c = compiled.get(q.id);
    if (!c) {
      if (metaIds.has(q.id)) {
        errors.push(
          issue(
            "error",
            "snapshot-missing-policy",
            `Snapshot policy file for question ${q.id} is missing or unreadable.`,
          ),
        );
      }
      continue;
    }
    if (c.divisionLast !== null) divisionLasts.push(c.divisionLast);
    if (q.withdrawn !== undefined) continue; // disabled output — exempt

    const expected = c.positions;
    const actual = q.positions as Record<string, number>;
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const drift = [...keys].filter((k) => expected[k] !== actual[k]);
    if (drift.length > 0) {
      errors.push(
        issue(
          "error",
          "snapshot-position-drift",
          `Question ${q.id}: positions do not match the snapshot compilation.`,
          drift.map(
            (k) =>
              `${k}: snapshot=${expected[k] ?? "absent"} questions.json=${actual[k] ?? "absent"}`,
          ),
        ),
      );
    }

    const fieldDrift: string[] = [];
    if ((q.divisionCount ?? null) !== (c.divisionCount ?? null)) {
      fieldDrift.push(
        `divisionCount: snapshot=${c.divisionCount} questions.json=${q.divisionCount ?? "absent"}`,
      );
    }
    if ((q.divisionFirst ?? null) !== c.divisionFirst) {
      fieldDrift.push(
        `divisionFirst: snapshot=${c.divisionFirst ?? "null"} questions.json=${q.divisionFirst ?? "absent"}`,
      );
    }
    if ((q.divisionLast ?? null) !== c.divisionLast) {
      fieldDrift.push(
        `divisionLast: snapshot=${c.divisionLast ?? "null"} questions.json=${q.divisionLast ?? "absent"}`,
      );
    }
    if (fieldDrift.length > 0) {
      errors.push(
        issue(
          "error",
          "snapshot-division-drift",
          `Question ${q.id}: division fields do not match the snapshot compilation.`,
          fieldDrift,
        ),
      );
    }
  }

  const expectedVersion = divisionLasts.sort().at(-1);
  if (expectedVersion !== undefined && questions.dataVersion !== expectedVersion) {
    errors.push(
      issue(
        "error",
        "snapshot-dataversion-drift",
        `questions.json dataVersion (${questions.dataVersion}) is not the latest snapshot division date (${expectedVersion}).`,
      ),
    );
  }

  errors.push(...hashDriftIssues(meta, fileHashes));
  errors.push(...ballotsDriftIssues(ballots));

  return { ok: errors.length === 0, errors, warnings };
}
