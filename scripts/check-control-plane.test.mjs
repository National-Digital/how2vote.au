import { describe, expect, it } from "vitest";
import { verdict } from "./check-control-plane.mjs";
import { controlPlaneDigest } from "./generate-control-plane.mjs";

const REFS = {
  electionIds: ["2019", "2022", "2025"],
  partyKeysByElection: { 2025: ["australian_labor_party", "australian_greens"] },
  propositionIdsByElection: { 2025: [6, 11, 32] },
  electorateSlugsByElection: { 2025: ["bean", "wentworth"] },
  senateStatesByElection: { 2025: ["NSW", "VIC", "ACT"] },
};

/** Build a signed plane from a suspensions list (digest computed the same way the runtime does). */
function signed(suspensions) {
  const body = { schemaVersion: 1, suspensions };
  return { schemaVersion: 1, suspensions, integrity: controlPlaneDigest(body) };
}

const AUDIT = { reason: "r", by: "ops", flaggedAt: "2026-07-16" };
const run = (suspensions) => verdict({ plane: signed(suspensions), refs: REFS });
const hasError = (errors, substr) => errors.some((e) => e.includes(substr));

describe("check-control-plane verdict", () => {
  it("accepts an empty, correctly-signed plane", () => {
    expect(run([])).toEqual({ ok: true, errors: [] });
  });

  it("accepts one valid entry per scope", () => {
    const res = run([
      { scope: "research", ...AUDIT },
      { scope: "publication", ...AUDIT },
      { scope: "printing", ...AUDIT },
      { scope: "decoding", electionId: "2025", ...AUDIT },
      { scope: "election", electionId: "2025", ...AUDIT },
      { scope: "chamber", electionId: "2025", chamber: "senate", ...AUDIT },
      { scope: "electorate", electionId: "2025", electorate: "bean", ...AUDIT },
      { scope: "ballot", electionId: "2025", chamber: "senate", ballot: "NSW", ...AUDIT },
      { scope: "mapping", electionId: "2025", partyKey: "australian_greens", ...AUDIT },
      { scope: "proposition", electionId: "2025", propositionId: 11, ...AUDIT },
      { scope: "map", mapId: "2025/NSW", ...AUDIT },
    ]);
    expect(res).toEqual({ ok: true, errors: [] });
  });

  it("fails a tampered integrity digest (fail closed)", () => {
    const plane = signed([]);
    plane.suspensions = [{ scope: "printing", ...AUDIT }]; // body changed, digest not recomputed
    const res = verdict({ plane, refs: REFS });
    expect(res.ok).toBe(false);
    expect(hasError(res.errors, "integrity digest is stale")).toBe(true);
  });

  it("rejects an unknown scope", () => {
    expect(hasError(run([{ scope: "everything", ...AUDIT }]).errors, "scope must be one of")).toBe(
      true,
    );
  });

  it("rejects a mapping partyKey that does not exist (would silently do nothing)", () => {
    const res = run([{ scope: "mapping", electionId: "2025", partyKey: "nope", ...AUDIT }]);
    expect(hasError(res.errors, "does not exist in the 2025 party registry")).toBe(true);
  });

  it("rejects a proposition id that is not a question", () => {
    const res = run([{ scope: "proposition", electionId: "2025", propositionId: 999, ...AUDIT }]);
    expect(hasError(res.errors, "is not a question in 2025")).toBe(true);
  });

  it("rejects an electorate that is not on the ballot", () => {
    const res = run([{ scope: "electorate", electionId: "2025", electorate: "Nowhere", ...AUDIT }]);
    expect(hasError(res.errors, "is not a division")).toBe(true);
  });

  it("rejects a senate ballot for an unknown state", () => {
    const res = run([
      { scope: "ballot", electionId: "2025", chamber: "senate", ballot: "ZZ", ...AUDIT },
    ]);
    expect(hasError(res.errors, "is not a senate ballot")).toBe(true);
  });

  it("rejects a global scope carrying an electionId", () => {
    const res = run([{ scope: "research", electionId: "2025", ...AUDIT }]);
    expect(hasError(res.errors, "is global and takes no electionId")).toBe(true);
  });

  it("requires the audit trail", () => {
    const res = run([{ scope: "printing" }]);
    expect(hasError(res.errors, "missing reason")).toBe(true);
    expect(hasError(res.errors, "missing by")).toBe(true);
    expect(hasError(res.errors, "flaggedAt must be an ISO date")).toBe(true);
  });

  it("requires liftedBy on a lifted (RESTORE) record", () => {
    const res = run([{ scope: "printing", ...AUDIT, liftedAt: "2026-07-17" }]);
    expect(hasError(res.errors, "needs liftedBy")).toBe(true);
  });

  it("rejects an unknown election id", () => {
    const res = run([{ scope: "election", electionId: "1901", ...AUDIT }]);
    expect(hasError(res.errors, 'unknown electionId "1901"')).toBe(true);
  });

  it("rejects a non-canonical electorate/ballot/map selector (would fail open at runtime)", () => {
    expect(
      hasError(
        run([{ scope: "electorate", electionId: "2025", electorate: "Bean", ...AUDIT }]).errors,
        'canonical slug "bean"',
      ),
    ).toBe(true);
    expect(
      hasError(
        run([{ scope: "ballot", electionId: "2025", chamber: "senate", ballot: "nsw", ...AUDIT }])
          .errors,
        'canonical form "NSW"',
      ),
    ).toBe(true);
    expect(
      hasError(
        run([{ scope: "map", mapId: "2025/nsw", ...AUDIT }]).errors,
        "must store the state uppercase",
      ),
    ).toBe(true);
  });

  it("rejects a map id of the wrong shape", () => {
    expect(
      hasError(
        run([{ scope: "map", mapId: "2025", ...AUDIT }]).errors,
        "form <electionId>/<STATE>",
      ),
    ).toBe(true);
  });
});
