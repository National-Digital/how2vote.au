import { describe, expect, it } from "vitest";
import {
  PUBLIC_VIEW_ALLOWLIST,
  verdict,
  verifyGeneratorReads,
  verifyManifestBinding,
  verifyNoRawEndpoint,
  verifyReleaseFiles,
  verifyViews,
} from "./check-public-stat-release.mjs";

const K = 10;
const hasError = (errors, needle) => errors.some((e) => e.includes(needle));

/** A compliant migration defining every allowlisted view with the correct k-gate. */
const GOOD_MIGRATION = `
CREATE VIEW v_public_demographic_national AS
  SELECT election_id, cohort, dimension, bucket, party, SUM(n) AS n
  FROM demographic_count
  GROUP BY election_id, cohort, dimension, bucket, party
  HAVING SUM(n) >= 10;
CREATE VIEW v_public_demographic_state AS
  SELECT election_id, cohort, state_code, dimension, bucket, party, SUM(n) AS n
  FROM demographic_count WHERE state_code <> ''
  GROUP BY election_id, cohort, state_code, dimension, bucket, party
  HAVING SUM(n) >= 10;
CREATE VIEW v_public_proposition_national AS
  SELECT election_id, cohort, proposition_id, stance, SUM(n) AS n
  FROM proposition_count
  GROUP BY election_id, cohort, proposition_id, stance
  HAVING SUM(n) >= 10;
CREATE VIEW v_public_response_total AS
  SELECT election_id, cohort, state_code, SUM(responses) AS responses
  FROM response_total GROUP BY election_id, cohort, state_code;
`;

const GOOD_GENERATOR = `
  d1Query("SELECT cohort, state_code, responses FROM v_public_response_total");
  d1Query("SELECT cohort, dimension, bucket, party, n FROM v_public_demographic_national");
  d1Query("SELECT cohort, state_code, dimension, bucket, party, n FROM v_public_demographic_state");
  d1Query("SELECT cohort, proposition_id, stance, n FROM v_public_proposition_national");
`;

const GOOD_RELEASE = (name = "2025.json") => ({
  name,
  json: {
    schemaVersion: 3,
    minCell: K,
    release: {
      releaseId: "rel-2025-0123456789abcdef",
      k: K,
      suppressionRules: ["k-anonymity at the DB view layer"],
      date: "2026-07-16",
    },
  },
});

const GOOD_BUILD = "return { publicStatsHash: publicStatsHash(), pending: { infrastructureHash } }";
const GOOD_CHECK = "for (const key of ['publicStatsHash']) verify(key)";

describe("verifyViews — DB k-gate", () => {
  it("passes a compliant migration", () => {
    expect(verifyViews(GOOD_MIGRATION, K)).toEqual([]);
  });

  it("fails a disclosive view missing the HAVING k-gate", () => {
    const bad = GOOD_MIGRATION.replace(
      "GROUP BY election_id, cohort, dimension, bucket, party\n  HAVING SUM(n) >= 10;",
      "GROUP BY election_id, cohort, dimension, bucket, party;",
    );
    expect(hasError(verifyViews(bad, K), 'v_public_demographic_national" must gate')).toBe(true);
  });

  it("fails when a view gates at the wrong k (drift from MIN_CELL)", () => {
    const bad = GOOD_MIGRATION.replace(
      "GROUP BY election_id, cohort, dimension, bucket, party\n  HAVING SUM(n) >= 10;",
      "GROUP BY election_id, cohort, dimension, bucket, party\n  HAVING SUM(n) >= 5;",
    );
    expect(hasError(verifyViews(bad, K), "gates at k=5 but MIN_CELL is 10")).toBe(true);
  });

  it("fails an unreviewed new v_public_ cross-tab view", () => {
    const bad =
      GOOD_MIGRATION +
      "\nCREATE VIEW v_public_secret_crosstab AS SELECT a FROM demographic_count HAVING SUM(n) >= 10;";
    expect(hasError(verifyViews(bad, K), "not on the public-view allowlist")).toBe(true);
  });

  it("fails a missing allowlisted view (fail closed)", () => {
    const bad = GOOD_MIGRATION.replace(/CREATE VIEW v_public_proposition_national[\s\S]*?;/, "");
    expect(hasError(verifyViews(bad, K), 'v_public_proposition_national" is missing')).toBe(true);
  });

  it("fails the denominator view if it wrongly carries a k-gate", () => {
    const bad = GOOD_MIGRATION.replace(
      "FROM response_total GROUP BY election_id, cohort, state_code;",
      "FROM response_total GROUP BY election_id, cohort, state_code HAVING SUM(n) >= 10;",
    );
    expect(hasError(verifyViews(bad, K), "must not carry a HAVING k-gate")).toBe(true);
  });
});

describe("verifyGeneratorReads — generator reads only views", () => {
  it("passes when the generator reads only allowlisted views", () => {
    expect(verifyGeneratorReads(GOOD_GENERATOR)).toEqual([]);
  });

  it("fails when the generator reads a base counter table directly", () => {
    const bad = GOOD_GENERATOR + '\nd1Query("SELECT n FROM demographic_count");';
    expect(hasError(verifyGeneratorReads(bad), "base counter table")).toBe(true);
  });

  it("fails when the generator reads no view at all (fail closed)", () => {
    expect(hasError(verifyGeneratorReads("const x = 1;"), "does not read any v_public_")).toBe(
      true,
    );
  });
});

describe("verifyNoRawEndpoint — no runtime counter serving", () => {
  it("passes write-only endpoints (INSERT/UPSERT only) and ignores JS imports", () => {
    const api = [
      {
        path: "functions/api/research.ts",
        text: 'import { x } from "./y";\ndb.prepare(`INSERT INTO demographic_count (a) VALUES (?)`)',
      },
      {
        path: "functions/api/research/geography.ts",
        text: "db.prepare(`INSERT INTO geography_count ...`)",
      },
    ];
    expect(verifyNoRawEndpoint(api)).toEqual([]);
  });

  it("fails an endpoint that SELECTs from a counter table", () => {
    const api = [
      {
        path: "functions/api/stats.ts",
        text: "db.prepare(`SELECT n FROM demographic_count WHERE x = ?`)",
      },
    ];
    expect(hasError(verifyNoRawEndpoint(api), "never be served by an endpoint")).toBe(true);
  });

  it("fails an endpoint that reads a public view at runtime", () => {
    const api = [
      {
        path: "functions/api/leak.ts",
        text: "db.prepare(`SELECT c FROM v_public_demographic_state`)",
      },
    ];
    expect(hasError(verifyNoRawEndpoint(api), "never be served by an endpoint")).toBe(true);
  });
});

describe("verifyReleaseFiles — signed, immutable release records", () => {
  it("passes a well-formed release file", () => {
    expect(verifyReleaseFiles([GOOD_RELEASE()], K)).toEqual([]);
  });

  it("fails a file with no committed releases (fail closed)", () => {
    expect(hasError(verifyReleaseFiles([], K), "no committed stats release files")).toBe(true);
  });

  it("fails a missing release block", () => {
    const bad = { name: "2025.json", json: { schemaVersion: 3, minCell: K } };
    expect(hasError(verifyReleaseFiles([bad], K), "missing release block")).toBe(true);
  });

  it("fails when the release k does not equal MIN_CELL", () => {
    const r = GOOD_RELEASE();
    r.json.release.k = 5;
    expect(hasError(verifyReleaseFiles([r], K), "release.k must equal MIN_CELL")).toBe(true);
  });

  it("fails a malformed release id", () => {
    const r = GOOD_RELEASE();
    r.json.release.releaseId = "2025";
    expect(hasError(verifyReleaseFiles([r], K), "releaseId must match")).toBe(true);
  });

  it("fails an empty suppressionRules list", () => {
    const r = GOOD_RELEASE();
    r.json.release.suppressionRules = [];
    expect(hasError(verifyReleaseFiles([r], K), "suppressionRules must be a non-empty")).toBe(true);
  });
});

describe("verifyManifestBinding — release-manifest ties in the stats", () => {
  it("passes when the manifest emits + verifies publicStatsHash and nothing is pending for it", () => {
    expect(verifyManifestBinding(GOOD_BUILD, GOOD_CHECK)).toEqual([]);
  });

  it("fails when the builder still lists publicStatsRelease as pending", () => {
    const bad = "pending: { publicStatsRelease: 'TBD' }, publicStatsHash: publicStatsHash()";
    expect(hasError(verifyManifestBinding(bad, GOOD_CHECK), "still lists publicStatsRelease")).toBe(
      true,
    );
  });

  it("fails when the builder does not emit publicStatsHash", () => {
    expect(
      hasError(
        verifyManifestBinding("return { pending: {} }", GOOD_CHECK),
        "must emit publicStatsHash",
      ),
    ).toBe(true);
  });
});

describe("verdict — end to end", () => {
  const goodInput = () => ({
    migrationsSql: GOOD_MIGRATION,
    k: K,
    generatorSrc: GOOD_GENERATOR,
    apiSources: [
      { path: "functions/api/research.ts", text: "INSERT INTO demographic_count VALUES" },
    ],
    statsFiles: [GOOD_RELEASE()],
    buildSrc: GOOD_BUILD,
    checkSrc: GOOD_CHECK,
  });

  it("passes a fully compliant configuration", () => {
    expect(verdict(goodInput()).ok).toBe(true);
  });

  it("fails closed when MIN_CELL could not be read", () => {
    expect(verdict({ ...goodInput(), k: NaN }).ok).toBe(false);
  });

  it("has an allowlist that includes exactly the four public views", () => {
    expect(Object.keys(PUBLIC_VIEW_ALLOWLIST).sort()).toEqual([
      "v_public_demographic_national",
      "v_public_demographic_state",
      "v_public_proposition_national",
      "v_public_response_total",
    ]);
  });
});
