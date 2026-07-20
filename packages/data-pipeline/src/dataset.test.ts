import { describe, expect, it } from "vitest";
import { loadSource, provenanceStatement, validateDataset } from "./dataset.js";

/**
 * Guards the real, committed dataset: it must parse and pass the integrity gate at all times.
 * This is the test that fails a PR if someone edits the source data into an invalid state.
 */
describe("committed dataset", () => {
  it("parses and passes the validation gate", async () => {
    const dataset = await loadSource("2025");
    const report = validateDataset(dataset);
    if (!report.ok) console.error(report.errors);
    expect(report.ok).toBe(true);
  });

  it("has the expected 2025 shape", async () => {
    const dataset = await loadSource("2025");
    expect(dataset.questions.questions.length).toBe(50);
    expect(dataset.ballots.electorates.length).toBe(150);
    expect(dataset.ballots.house.length).toBeGreaterThan(1000);
  });
});

describe("provenanceStatement", () => {
  it("reconstruction names the compilation period and the retrieval date, disclosing it is retrospective", () => {
    const s = provenanceStatement(
      "primary-source-reconstruction",
      "2026-07-15T06:30:43.598Z",
      "2019-05-09",
    );
    expect(s).toContain("as at 2019-05-09");
    expect(s).toContain("2026-07-15");
    expect(s).toMatch(/retrospective|not a contemporaneous/i);
  });

  it("contemporaneous states the capture date during the election period", () => {
    const s = provenanceStatement("contemporaneous-api-snapshot", "2028-04-20T00:00:00Z", null);
    expect(s).toContain("2028-04-20");
    expect(s).toContain("during the election period");
  });
});
