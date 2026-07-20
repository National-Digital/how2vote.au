import { describe, it, expect } from "vitest";
import { verdict } from "./check-locked-snapshots.mjs";

const V1 = "data/snapshots/tvfy/2025/v1";
const VERSIONS = "data/snapshots/tvfy/2025/versions.json";

/** Build a reader over an in-memory { path: content } map (absent → null). */
const reader = (files) => (path) => (Object.hasOwn(files, path) ? files[path] : null);

const j = (value) => JSON.stringify(value);

/** A locked meta in the current (direct-API, schemaVersion 2) model — the immutable kind. */
const meta = (overrides = {}) =>
  j({
    schemaVersion: 2,
    electionId: "2025",
    version: 1,
    source: "tvfy-api",
    basis: "contemporaneous-api-snapshot",
    retrievedAt: "2026-07-01T00:00:00Z",
    locked: true,
    lockedAt: "2026-07-02T00:00:00Z",
    policyIds: [42],
    files: ["policies-list.json", "ballots.json"],
    ...overrides,
  });

/** A locked meta in the original (schemaVersion 1) model — migratable to the direct-API model. */
const originalMeta = (overrides = {}) =>
  j({
    schemaVersion: 1,
    electionId: "2025",
    version: 1,
    source: "original-model",
    locked: true,
    lockedAt: "2026-07-02T00:00:00Z",
    policyIds: [42],
    files: {},
    ...overrides,
  });

const historyEntry = (overrides = {}) => ({
  version: 1,
  createdAt: "2026-07-01T00:00:00Z",
  lockedAt: "2026-07-02T00:00:00Z",
  reason: "initial snapshot",
  ...overrides,
});

const versions = (active, history) => j({ schemaVersion: 1, electionId: "2025", active, history });

describe("verdict — scope and unlocked versions", () => {
  it("passes when no files changed", async () => {
    const result = await verdict([], reader({}), reader({}));
    expect(result).toEqual({ ok: true, violations: [] });
  });

  it("allows any edit to a version that is unlocked at base", async () => {
    const base = reader({ [`${V1}/meta.json`]: meta({ locked: false, lockedAt: null }) });
    const head = reader({ [`${V1}/meta.json`]: meta() });
    const result = await verdict(
      [
        { status: "M", path: `${V1}/meta.json` },
        { status: "A", path: `${V1}/policies/42.json` },
        { status: "D", path: `${V1}/ballots.json` },
      ],
      base,
      head,
    );
    expect(result.ok).toBe(true);
  });

  it("allows a brand-new version dir (meta.json absent at base)", async () => {
    const result = await verdict(
      [
        { status: "A", path: `${V1}/meta.json` },
        { status: "A", path: `${V1}/policies-list.json` },
      ],
      reader({}),
      reader({ [`${V1}/meta.json`]: meta({ locked: false }) }),
    );
    expect(result.ok).toBe(true);
  });

  it("ignores changes outside data/snapshots/tvfy/", async () => {
    const result = await verdict(
      [{ status: "M", path: "packages/data-pipeline/src/tvfy.ts" }],
      reader({}),
      reader({}),
    );
    expect(result.ok).toBe(true);
  });
});

describe("verdict — locked (schemaVersion 2) version dirs are immutable", () => {
  const lockedBase = { [`${V1}/meta.json`]: meta() };

  it("flags an edit to a locked meta.json", async () => {
    const result = await verdict(
      [{ status: "M", path: `${V1}/meta.json` }],
      reader(lockedBase),
      reader({ [`${V1}/meta.json`]: meta({ retrievedAt: "2026-07-09T00:00:00Z" }) }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain(`${V1}/meta.json`);
    expect(result.violations[0]).toContain("locked");
  });

  it("flags add, modify, and delete of files under a locked version", async () => {
    const result = await verdict(
      [
        { status: "A", path: `${V1}/policies/99.json` },
        { status: "M", path: `${V1}/policies/42.json` },
        { status: "D", path: `${V1}/policies-list.json` },
      ],
      reader(lockedBase),
      reader({ [`${V1}/policies/99.json`]: "{}", [`${V1}/policies/42.json`]: "{}" }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(3);
  });

  it("treats a rename inside a locked version as delete + add (two violations)", async () => {
    const result = await verdict(
      [{ status: "R", oldPath: `${V1}/ballots.json`, path: `${V1}/ballots-v2.json` }],
      reader(lockedBase),
      reader({ [`${V1}/ballots-v2.json`]: "{}" }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it("flags deleting a file under a locked version", async () => {
    const result = await verdict(
      [{ status: "D", path: `${V1}/ballots.json` }],
      reader({ ...lockedBase, [`${V1}/ballots.json`]: "{}" }),
      reader({}),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("deleted");
  });
});

describe("verdict — original schemaVersion-1 migration exemption", () => {
  it("permits replacing a locked original snapshot (files + versions.json) with the direct-API model", async () => {
    const base = reader({
      [`${V1}/meta.json`]: originalMeta(),
      [`${V1}/original-provenance.json`]: j({ schemaVersion: 1, electionId: "2025", records: [] }),
      [VERSIONS]: versions(1, [historyEntry()]),
    });
    const head = reader({
      [`${V1}/meta.json`]: meta(), // now schemaVersion 2 direct-API
      [`${V1}/policies/42.json`]: "{}",
      [VERSIONS]: versions(1, [historyEntry({ createdAt: "2026-07-15T00:00:00Z" })]),
    });
    const result = await verdict(
      [
        { status: "M", path: `${V1}/meta.json` },
        { status: "D", path: `${V1}/original-provenance.json` },
        { status: "A", path: `${V1}/policies/42.json` },
        { status: "M", path: VERSIONS },
      ],
      base,
      head,
    );
    expect(result).toEqual({ ok: true, violations: [] });
  });
});

describe("verdict — versions.json", () => {
  it("allows creating versions.json when absent at base", async () => {
    const result = await verdict(
      [{ status: "A", path: VERSIONS }],
      reader({}),
      reader({ [VERSIONS]: versions(1, [historyEntry()]) }),
    );
    expect(result.ok).toBe(true);
  });

  it("allows appending a new history entry and bumping active", async () => {
    const base = { [VERSIONS]: versions(1, [historyEntry()]) };
    const head = {
      [VERSIONS]: versions(2, [
        historyEntry(),
        historyEntry({
          version: 2,
          createdAt: "2026-07-10T00:00:00Z",
          lockedAt: null,
          supersedes: 1,
        }),
      ]),
    };
    const result = await verdict([{ status: "M", path: VERSIONS }], reader(base), reader(head));
    expect(result).toEqual({ ok: true, violations: [] });
  });

  it("allows filling a null lockedAt on an existing entry", async () => {
    const base = { [VERSIONS]: versions(1, [historyEntry({ lockedAt: null })]) };
    const head = { [VERSIONS]: versions(1, [historyEntry({ lockedAt: "2026-07-11T00:00:00Z" })]) };
    const result = await verdict([{ status: "M", path: VERSIONS }], reader(base), reader(head));
    expect(result.ok).toBe(true);
  });

  it("flags rewriting an existing history entry", async () => {
    const base = { [VERSIONS]: versions(1, [historyEntry()]) };
    const head = { [VERSIONS]: versions(1, [historyEntry({ createdAt: "2020-01-01T00:00:00Z" })]) };
    const result = await verdict([{ status: "M", path: VERSIONS }], reader(base), reader(head));
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("history[0]");
  });

  it("flags removing history entries", async () => {
    const base = {
      [VERSIONS]: versions(2, [historyEntry(), historyEntry({ version: 2, lockedAt: null })]),
    };
    const head = { [VERSIONS]: versions(1, [historyEntry()]) };
    const result = await verdict([{ status: "M", path: VERSIONS }], reader(base), reader(head));
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("removed");
  });

  it("flags changing electionId", async () => {
    const base = { [VERSIONS]: versions(1, [historyEntry()]) };
    const head = {
      [VERSIONS]: j({ schemaVersion: 1, electionId: "2028", active: 1, history: [historyEntry()] }),
    };
    const result = await verdict([{ status: "M", path: VERSIONS }], reader(base), reader(head));
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("electionId");
  });

  it("flags deleting versions.json that existed at base", async () => {
    const base = { [VERSIONS]: versions(1, [historyEntry()]) };
    const result = await verdict([{ status: "D", path: VERSIONS }], reader(base), reader({}));
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("deleted");
  });

  it("flags unparseable head versions.json", async () => {
    const base = { [VERSIONS]: versions(1, [historyEntry()]) };
    const result = await verdict(
      [{ status: "M", path: VERSIONS }],
      reader(base),
      reader({ [VERSIONS]: "not json at all" }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("unparseable");
  });
});

describe("verdict — async readers", () => {
  it("accepts readers that return promises", async () => {
    const base = { [`${V1}/meta.json`]: meta() };
    const asyncReader = (files) => async (path) =>
      Object.hasOwn(files, path) ? files[path] : null;
    const result = await verdict(
      [{ status: "M", path: `${V1}/ballots.json` }],
      asyncReader(base),
      asyncReader({ [`${V1}/ballots.json`]: "{}" }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
  });
});
