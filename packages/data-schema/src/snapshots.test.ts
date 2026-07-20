import { describe, expect, it } from "vitest";
import { ELECTIONS } from "./elections.js";
import type { QuestionSet } from "./schemas.js";
import {
  snapshotMetaSchema,
  snapshotVersionsSchema,
  validateSnapshotConsistency,
  type SnapshotCompiledPolicy,
  type SnapshotConsistencyInput,
  type SnapshotMeta,
} from "./snapshots.js";

const election2025 = ELECTIONS.find((e) => e.id === "2025")!;
const HASH = "0".repeat(64);

const meta = (over: Partial<SnapshotMeta> = {}): SnapshotMeta =>
  snapshotMetaSchema.parse({
    schemaVersion: 2,
    electionId: "2025",
    version: 1,
    source: "tvfy-api",
    basis: "contemporaneous-api-snapshot",
    endpoint: "https://theyvoteforyou.org.au/api/v1",
    retrievedAt: "2025-04-11T11:00:00+10:00",
    responseSha256: HASH,
    apiSchemaVersion: "v1",
    licenceVersion: "ODbL-1.0",
    effectiveAsAt: null,
    locked: true,
    lockedAt: "2025-04-11T12:00:00+10:00",
    policyIds: [32],
    files: {},
    ...over,
  });

const questionSet = (over: Partial<QuestionSet["questions"][number]> = {}): QuestionSet => ({
  schemaVersion: 1,
  dataVersion: "2025-03-28",
  attribution: "Vote data © They Vote For You (OpenAustralia Foundation), ODbL",
  questions: [
    {
      id: 32,
      text: "Allow live animal export and place minimal restrictions on it.",
      divisionFirst: "2018-06-18",
      divisionLast: "2025-03-28",
      divisionCount: 4,
      positions: { australian_labor_party: 2, liberal_party: 4 },
      ...over,
    },
  ],
});

const compiled32: SnapshotCompiledPolicy = {
  id: 32,
  divisionCount: 4,
  divisionFirst: "2018-06-18",
  divisionLast: "2025-03-28",
  positions: { australian_labor_party: 2, liberal_party: 4 },
};

const electionMeta = { ...election2025, dataVersion: "2025-03-28" };

const input = (over: Partial<SnapshotConsistencyInput> = {}): SnapshotConsistencyInput => ({
  meta: meta(),
  questions: questionSet(),
  electionMeta,
  compiled: new Map([[32, compiled32]]),
  fileHashes: {},
  ballots: { source: '{"b":1}', locked: '{"b":1}' },
  ...over,
});

describe("snapshot schemas", () => {
  it("a locked meta must record lockedAt", () => {
    expect(() => meta({ locked: true, lockedAt: null })).toThrow(/lockedAt/);
  });

  it("a reconstruction snapshot must record effectiveAsAt", () => {
    expect(() => meta({ basis: "primary-source-reconstruction", effectiveAsAt: null })).toThrow(
      /effectiveAsAt/,
    );
    expect(() =>
      meta({ basis: "primary-source-reconstruction", effectiveAsAt: "2019-05-18" }),
    ).not.toThrow();
  });

  it("rejects a non-direct-API source and an unknown basis", () => {
    expect(() =>
      meta({ source: "obsolete-source" as unknown as SnapshotMeta["source"] }),
    ).toThrow();
    expect(() => meta({ basis: "guesswork" as unknown as SnapshotMeta["basis"] })).toThrow();
  });

  it("versions after the first require reason and verifiedBy", () => {
    const base = {
      schemaVersion: 1,
      electionId: "2025",
      active: 2,
      history: [
        {
          version: 1,
          createdAt: "2025-04-01T00:00:00+10:00",
          lockedAt: "2025-04-11T12:00:00+10:00",
        },
        { version: 2, createdAt: "2025-04-20T00:00:00+10:00", lockedAt: null },
      ],
    };
    expect(() => snapshotVersionsSchema.parse(base)).toThrow(/reason and verifiedBy/);
    const withReason = structuredClone(base);
    Object.assign(withReason.history[1]!, {
      reason: "position error in policy 32",
      verifiedBy: "Test Reviewer",
      supersedes: 1,
    });
    expect(() => snapshotVersionsSchema.parse(withReason)).not.toThrow();
  });

  it("versions.json must be sequential from 1 and active must exist", () => {
    const v = {
      schemaVersion: 1,
      electionId: "2025",
      active: 3,
      history: [{ version: 1, createdAt: "2025-04-01T00:00:00+10:00", lockedAt: null }],
    };
    expect(() => snapshotVersionsSchema.parse(v)).toThrow(/active/);
  });
});

describe("validateSnapshotConsistency — contemporaneous-api-snapshot", () => {
  it("passes when questions.json matches the snapshot compilation exactly", () => {
    const report = validateSnapshotConsistency(input());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("fails on position drift, naming the offending keys", () => {
    const report = validateSnapshotConsistency(
      input({
        questions: questionSet({ positions: { australian_labor_party: 5, liberal_party: 4 } }),
      }),
    );
    expect(report.ok).toBe(false);
    const drift = report.errors.find((e) => e.code === "snapshot-position-drift");
    expect(drift?.items?.[0]).toContain("australian_labor_party");
  });

  it("fails when a question has no snapshot policy (and vice versa)", () => {
    const report = validateSnapshotConsistency(input({ meta: meta({ policyIds: [32, 99] }) }));
    expect(report.errors.some((e) => e.code === "snapshot-policy-mismatch")).toBe(true);
  });

  it("fails when a listed snapshot policy file is missing from the compilation", () => {
    const report = validateSnapshotConsistency(input({ compiled: new Map() }));
    expect(report.errors.some((e) => e.code === "snapshot-missing-policy")).toBe(true);
  });

  it("fails on division-field drift", () => {
    const report = validateSnapshotConsistency(
      input({ questions: questionSet({ divisionCount: 5 }) }),
    );
    expect(report.errors.some((e) => e.code === "snapshot-division-drift")).toBe(true);
  });

  it("fails when dataVersion is not the latest snapshot division date", () => {
    const stale = questionSet();
    stale.dataVersion = "2024-01-01";
    const report = validateSnapshotConsistency(
      input({ questions: stale, electionMeta: { ...electionMeta, dataVersion: "2024-01-01" } }),
    );
    expect(report.errors.some((e) => e.code === "snapshot-dataversion-drift")).toBe(true);
  });

  it("fails when the ELECTIONS registry dataVersion disagrees with questions.json", () => {
    const report = validateSnapshotConsistency(
      input({ electionMeta: { ...electionMeta, dataVersion: "2024-12-31" } }),
    );
    expect(report.errors.some((e) => e.code === "election-dataversion-mismatch")).toBe(true);
  });

  it("fails on file-hash tamper in either direction", () => {
    const tampered = validateSnapshotConsistency(
      input({
        meta: meta({ files: { "policies/32.json": "a".repeat(64) } }),
        fileHashes: { "policies/32.json": "b".repeat(64) },
      }),
    );
    expect(tampered.errors.some((e) => e.code === "snapshot-hash-mismatch")).toBe(true);
    const unlisted = validateSnapshotConsistency(
      input({ fileHashes: { "policies/32.json": "b".repeat(64) } }),
    );
    expect(unlisted.errors.some((e) => e.code === "snapshot-hash-mismatch")).toBe(true);
  });

  it("fails when source ballots drift from the locked copy", () => {
    const report = validateSnapshotConsistency(
      input({ ballots: { source: '{"b":2}', locked: '{"b":1}' } }),
    );
    expect(report.errors.some((e) => e.code === "ballots-drift")).toBe(true);
  });

  it("exempts withdrawn questions from drift checks but reports them as warnings", () => {
    const report = validateSnapshotConsistency(
      input({
        questions: questionSet({
          positions: { australian_labor_party: 5 }, // would be drift if not withdrawn
          withdrawn: { date: "2025-04-20", reason: "position under review" },
        }),
      }),
    );
    expect(report.errors.filter((e) => e.code === "snapshot-position-drift")).toEqual([]);
    expect(report.warnings.some((w) => w.code === "question-withdrawn")).toBe(true);
    expect(report.ok).toBe(true);
  });
});

describe("validateSnapshotConsistency — primary-source-reconstruction", () => {
  const reconstruction = (over: Partial<SnapshotConsistencyInput> = {}): SnapshotConsistencyInput =>
    input({
      meta: meta({ basis: "primary-source-reconstruction", effectiveAsAt: "2019-05-18" }),
      ...over,
    });

  it("does NOT compare positions (vintage scores are kept, not recomputed)", () => {
    // Positions differ from the fresh compilation, but a reconstruction snapshot must not flag it.
    const report = validateSnapshotConsistency(
      reconstruction({
        questions: questionSet({ positions: { australian_labor_party: 5, liberal_party: 1 } }),
      }),
    );
    expect(report.errors.filter((e) => e.code === "snapshot-position-drift")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("requires coverage: every question needs a captured policy file", () => {
    const report = validateSnapshotConsistency(reconstruction({ compiled: new Map() }));
    expect(report.errors.some((e) => e.code === "reconstruction-coverage")).toBe(true);
  });

  it("still enforces the file-hash tamper check", () => {
    const report = validateSnapshotConsistency(
      reconstruction({
        meta: meta({
          basis: "primary-source-reconstruction",
          effectiveAsAt: "2019-05-18",
          files: { "policies/32.json": "a".repeat(64) },
        }),
        fileHashes: { "policies/32.json": "b".repeat(64) },
      }),
    );
    expect(report.errors.some((e) => e.code === "snapshot-hash-mismatch")).toBe(true);
  });

  it("still enforces the ballots-drift check", () => {
    const report = validateSnapshotConsistency(
      reconstruction({ ballots: { source: '{"b":2}', locked: '{"b":1}' } }),
    );
    expect(report.errors.some((e) => e.code === "ballots-drift")).toBe(true);
  });
});
