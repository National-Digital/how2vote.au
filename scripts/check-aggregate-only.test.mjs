import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGGREGATE_ALLOWLIST,
  parseMigrations,
  verdict,
  verifyLiveTables,
  verifyProvenance,
  verifySchema,
  verifySources,
} from "./check-aggregate-only.mjs";

const migrationsDir = new URL("../apps/web/migrations/", import.meta.url);
const provenancePath = new URL("../docs/research/aggregate-provenance.json", import.meta.url);

/** A synthetic aggregate counter table CREATE. */
const aggregateMigration = {
  name: "9001_counter.sql",
  sql: `CREATE TABLE response_total (
    election_id TEXT NOT NULL,
    cohort TEXT NOT NULL,
    state_code TEXT NOT NULL DEFAULT '',
    responses INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (election_id, cohort, state_code)
  );`,
};

/** A synthetic person-level table CREATE (the thing we must reject). */
const rowLevelMigration = {
  name: "9002_rows.sql",
  sql: `CREATE TABLE submission (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT
  );`,
};

/** A well-formed provenance record for mutation in tests. */
const goodProvenance = () => ({
  researchPayloadSchemaVersion: 3,
  consentVersions: ["2026-07.2"],
  cohortModel: { description: "cohort keyed", cohorts: ["live", "unknown"] },
  aggregationMethod: { summary: "counters only" },
  aggregateTables: [...AGGREGATE_ALLOWLIST],
  conversionVerification: {
    verifiedDate: "2026-07-14",
    counterExportHash: "pending:EV-AGGREGATE-CONVERSION",
  },
  noPersonLevelSourceRetained: true,
  noPersonLevelSourceRetainedStatement: "no person-level source is retained",
});

const has = (errors, needle) => errors.some((e) => e.includes(needle));

describe("parseMigrations — schema replay", () => {
  it("keeps a table that is created and never dropped", () => {
    const tables = parseMigrations([aggregateMigration]);
    expect(tables.has("response_total")).toBe(true);
    expect(tables.get("response_total").columns).toContain("responses");
  });

  it("drops a table dropped by a later migration (the 0001→0005 case)", () => {
    const tables = parseMigrations([
      rowLevelMigration,
      { name: "9003_drop.sql", sql: "DROP TABLE IF EXISTS submission;" },
    ]);
    expect(tables.has("submission")).toBe(false);
  });

  it("registers a table with trailing options or CREATE TABLE AS SELECT (no bypass)", () => {
    const withOpts = parseMigrations([
      { name: "9010.sql", sql: "CREATE TABLE leak (id INTEGER, ip TEXT) STRICT, WITHOUT ROWID;" },
    ]);
    expect(withOpts.has("leak")).toBe(true);
    expect(withOpts.get("leak").columns).toContain("ip");
    const asSelect = parseMigrations([
      { name: "9011.sql", sql: "CREATE TABLE export_dump AS SELECT * FROM response_total;" },
    ]);
    expect(asSelect.has("export_dump")).toBe(true);
    // Both survive the allowlist check as violations.
    expect(verifySchema(withOpts).length).toBeGreaterThan(0);
    expect(verifySchema(asSelect).length).toBeGreaterThan(0);
  });

  it("applies ALTER TABLE ADD/DROP COLUMN", () => {
    const tables = parseMigrations([
      aggregateMigration,
      { name: "9004_alter.sql", sql: "ALTER TABLE response_total ADD COLUMN extra TEXT;" },
      { name: "9005_alter.sql", sql: "ALTER TABLE response_total DROP COLUMN extra;" },
    ]);
    expect(tables.get("response_total").columns).not.toContain("extra");
  });
});

describe("verifySchema", () => {
  it("passes on aggregate-only tables", () => {
    expect(verifySchema(parseMigrations([aggregateMigration]))).toEqual([]);
  });

  it("rejects a surviving table off the allowlist", () => {
    const errors = verifySchema(parseMigrations([rowLevelMigration]));
    expect(has(errors, "not on the aggregate allowlist")).toBe(true);
  });

  it("rejects person-level columns (ip, user_agent, created_at) if such a table survives", () => {
    // Force the table onto the allowlist to isolate the column check.
    const tables = parseMigrations([rowLevelMigration]);
    const def = tables.get("submission");
    tables.delete("submission");
    tables.set("response_total", def);
    const errors = verifySchema(tables);
    expect(has(errors, "IP-address field")).toBe(true);
    expect(has(errors, "user-agent field")).toBe(true);
    expect(has(errors, "fine-grained-timestamp field")).toBe(true);
  });

  it("does not flag the legitimate geography_count 'submissions' count column", () => {
    const tables = parseMigrations([
      {
        name: "9006_geo.sql",
        sql: `CREATE TABLE geography_count (
          election_id TEXT NOT NULL, electorate TEXT NOT NULL,
          submissions INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (election_id, electorate));`,
      },
    ]);
    expect(verifySchema(tables)).toEqual([]);
  });
});

describe("verifySources", () => {
  it("passes on clean operational source", () => {
    expect(
      verifySources([{ path: "x.ts", text: "await db.prepare('INSERT INTO response_total ...')" }]),
    ).toEqual([]);
  });

  it("flags DML against the submission table and the submission_answer table", () => {
    expect(
      has(
        verifySources([{ path: "x.ts", text: "SELECT * FROM submission WHERE 1" }]),
        "submission table",
      ),
    ).toBe(true);
    expect(
      has(
        verifySources([{ path: "x.sql", text: "DELETE FROM submission_answer" }]),
        "submission_answer",
      ),
    ).toBe(true);
  });

  it("flags the removed backfill machinery tokens", () => {
    expect(
      has(verifySources([{ path: "p.json", text: '"data:backfill": "x"' }]), "data:backfill"),
    ).toBe(true);
    expect(
      has(verifySources([{ path: "p.json", text: '"stats:backfill": "x"' }]), "stats:backfill"),
    ).toBe(true);
    expect(
      has(
        verifySources([{ path: "b.ts", text: "import { submissionToIncrements }" }]),
        "submissionToIncrements",
      ),
    ).toBe(true);
    expect(
      has(
        verifySources([{ path: "w.yml", text: "group: research-backfill" }]),
        "research-backfill",
      ),
    ).toBe(true);
    expect(
      has(verifySources([{ path: "b.ts", text: "backfill-counters.ts" }]), "backfill-counters"),
    ).toBe(true);
    expect(has(verifySources([{ path: "t.ts", text: "counter_delta" }]), "delta log")).toBe(true);
  });

  it("does not flag a GeoSubmission interface or a local submission variable", () => {
    expect(
      verifySources([
        {
          path: "geography.ts",
          text: "export interface GeoSubmission {}\nconst submission = clean(x);",
        },
      ]),
    ).toEqual([]);
  });
});

describe("verifyProvenance", () => {
  it("passes on a well-formed record", () => {
    expect(verifyProvenance(goodProvenance())).toEqual([]);
  });

  it("accepts a real sha256 counter-export hash", () => {
    const rec = goodProvenance();
    rec.conversionVerification.counterExportHash = "a".repeat(64);
    expect(verifyProvenance(rec)).toEqual([]);
  });

  it("rejects noPersonLevelSourceRetained !== true", () => {
    const rec = goodProvenance();
    rec.noPersonLevelSourceRetained = false;
    expect(has(verifyProvenance(rec), "must be exactly true")).toBe(true);
  });

  it("rejects a missing / malformed counter-export hash", () => {
    const rec = goodProvenance();
    rec.conversionVerification.counterExportHash = "nope";
    expect(has(verifyProvenance(rec), "counterExportHash")).toBe(true);
  });

  it("rejects an aggregateTables list that drifts from the allowlist", () => {
    const rec = goodProvenance();
    rec.aggregateTables = [...AGGREGATE_ALLOWLIST, "submission"];
    expect(has(verifyProvenance(rec), "not on the allowlist")).toBe(true);
    const rec2 = goodProvenance();
    rec2.aggregateTables = rec2.aggregateTables.slice(1);
    expect(has(verifyProvenance(rec2), "missing allowlist table")).toBe(true);
  });
});

describe("verifyLiveTables", () => {
  it("passes on allowlisted tables plus platform internals", () => {
    expect(
      verifyLiveTables([...AGGREGATE_ALLOWLIST, "d1_migrations", "sqlite_sequence", "_cf_KV"]),
    ).toEqual([]);
  });

  it("rejects a table outside the allowlist", () => {
    expect(
      has(verifyLiveTables(["response_total", "submission"]), 'production table "submission"'),
    ).toBe(true);
  });

  it("fails closed on an empty table list", () => {
    expect(has(verifyLiveTables([]), "cannot verify")).toBe(true);
  });
});

describe("real committed artefacts — smoke test", () => {
  const migrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(new URL(name, migrationsDir), "utf8") }));

  it("the committed migration chain replays to an aggregate-only schema", () => {
    const tables = parseMigrations(migrations);
    expect(tables.has("submission")).toBe(false);
    expect(tables.has("submission_answer")).toBe(false);
    expect(verifySchema(tables)).toEqual([]);
    // Every counter table is present.
    for (const t of AGGREGATE_ALLOWLIST) expect(tables.has(t)).toBe(true);
  });

  it("the committed aggregate-provenance record is valid", () => {
    const rec = JSON.parse(readFileSync(provenancePath, "utf8"));
    expect(verifyProvenance(rec)).toEqual([]);
  });

  it("verdict over the committed migrations + provenance is ok", () => {
    const rec = JSON.parse(readFileSync(provenancePath, "utf8"));
    expect(verdict({ migrations, provenance: rec }).ok).toBe(true);
  });
});
