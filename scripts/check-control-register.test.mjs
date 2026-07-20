import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict, CANONICAL_GROUPS } from "./check-control-register.mjs";

const REAL = JSON.parse(
  readFileSync(new URL("../docs/legal/control-register.json", import.meta.url), "utf8"),
);

// A fixed clock so evidence-expiry assertions are deterministic.
const NOW = Date.parse("2026-07-15T00:00:00Z");

/** Build a minimal register with `n` well-formed controls (control-1..control-n). */
function makeRegister(n, overrides = {}) {
  const controls = [];
  for (let i = 1; i <= n; i++) {
    controls.push({
      id: `control-${i}`,
      title: `Control ${i}`,
      inherent: 10,
      targetResidual: 5,
      ciGroups: ["Legal"],
      status: "planned",
      tests: [{ id: `t-${i}`, type: "ci-job", owner: "eng", status: "planned" }],
      evidence: [],
    });
  }
  return { schemaVersion: 1, ciGroups: [...CANONICAL_GROUPS], controls, ...overrides };
}

const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("verdict — real committed register", () => {
  it("passes structural validation", () => {
    const res = verdict(REAL, { now: NOW });
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("covers exactly 31 controls", () => {
    expect(REAL.controls).toHaveLength(31);
  });

  it("passes for every canonical group scope", () => {
    for (const g of CANONICAL_GROUPS) {
      expect(verdict(REAL, { now: NOW, group: g }).ok).toBe(true);
    }
  });
});

describe("verdict — structural rules", () => {
  it("flags a missing issue as an orphan requirement", () => {
    const reg = makeRegister(31);
    reg.controls = reg.controls.filter((c) => c.id !== "control-17");
    const res = verdict(reg, { now: NOW });
    expect(res.ok).toBe(false);
    expect(hasError(res, "missing control control-17")).toBe(true);
  });

  it("flags a duplicate issue id", () => {
    const reg = makeRegister(31);
    reg.controls.push({ ...reg.controls[0] });
    expect(hasError(verdict(reg, { now: NOW }), "declared 2 times")).toBe(true);
  });

  it("flags a test without an owner", () => {
    const reg = makeRegister(31);
    reg.controls[0].tests[0].owner = "";
    expect(hasError(verdict(reg, { now: NOW }), "no test without an owner")).toBe(true);
  });

  it("flags a control with no tests", () => {
    const reg = makeRegister(31);
    reg.controls[0].tests = [];
    expect(hasError(verdict(reg, { now: NOW }), "at least one test")).toBe(true);
  });

  it("flags an unknown ci group on a control", () => {
    const reg = makeRegister(31);
    reg.controls[0].ciGroups = ["Nonsense"];
    expect(hasError(verdict(reg, { now: NOW }), 'unknown ciGroup "Nonsense"')).toBe(true);
  });

  it("flags a missing canonical group in the header", () => {
    const reg = makeRegister(31);
    reg.ciGroups = reg.ciGroups.filter((g) => g !== "Data");
    expect(hasError(verdict(reg, { now: NOW }), 'missing canonical group "Data"')).toBe(true);
  });
});

describe("verdict — fail-closed ratchet & evidence", () => {
  it("rejects a completed control riding on a planned test", () => {
    const reg = makeRegister(31);
    reg.controls[0].status = "implemented";
    // test still "planned"
    expect(hasError(verdict(reg, { now: NOW }), "requires all tests passing")).toBe(true);
  });

  it("rejects a completed control with pending evidence", () => {
    const reg = makeRegister(31);
    reg.controls[0].status = "verified";
    reg.controls[0].tests[0].status = "passing";
    reg.controls[0].evidence = [{ id: "EV-X", description: "x", status: "pending" }];
    expect(hasError(verdict(reg, { now: NOW }), "requires all evidence current")).toBe(true);
  });

  it("accepts a completed control with passing tests and current, unexpired evidence", () => {
    const reg = makeRegister(31);
    reg.controls[0].status = "implemented";
    reg.controls[0].tests[0].status = "passing";
    reg.controls[0].evidence = [
      {
        id: "EV-X",
        description: "x",
        status: "current",
        reviewer: "legal officer",
        approvedAt: "2026-07-01",
        expiresAt: "2027-07-01",
      },
    ];
    expect(verdict(reg, { now: NOW }).ok).toBe(true);
  });

  it("accepts current evidence with a distinct secondReviewer (joint sign-off)", () => {
    const reg = makeRegister(31);
    reg.controls[0].status = "implemented";
    reg.controls[0].tests[0].status = "passing";
    reg.controls[0].evidence = [
      {
        id: "EV-X",
        description: "x",
        status: "current",
        reviewer: "cameron-young",
        secondReviewer: "tara-buckley",
        approvedAt: "2026-07-01",
        expiresAt: "2027-07-01",
      },
    ];
    expect(verdict(reg, { now: NOW }).ok).toBe(true);
  });

  it("rejects a secondReviewer identical to the reviewer", () => {
    const reg = makeRegister(31);
    reg.controls[0].evidence = [
      {
        id: "EV-X",
        description: "x",
        status: "current",
        reviewer: "cameron-young",
        secondReviewer: "cameron-young",
        approvedAt: "2026-07-01",
        expiresAt: "2027-07-01",
      },
    ];
    expect(hasError(verdict(reg, { now: NOW }), "secondReviewer must differ")).toBe(true);
  });

  it("rejects an empty secondReviewer on current evidence", () => {
    const reg = makeRegister(31);
    reg.controls[0].evidence = [
      {
        id: "EV-X",
        description: "x",
        status: "current",
        reviewer: "cameron-young",
        secondReviewer: "",
        approvedAt: "2026-07-01",
        expiresAt: "2027-07-01",
      },
    ];
    expect(hasError(verdict(reg, { now: NOW }), "secondReviewer must be a non-empty")).toBe(true);
  });

  it("rejects current evidence that has expired", () => {
    const reg = makeRegister(31);
    reg.controls[0].evidence = [
      {
        id: "EV-X",
        description: "x",
        status: "current",
        reviewer: "legal officer",
        approvedAt: "2025-01-01",
        expiresAt: "2026-01-01",
      },
    ];
    expect(hasError(verdict(reg, { now: NOW }), "expired at 2026-01-01")).toBe(true);
  });

  it("always rejects evidence explicitly marked expired", () => {
    const reg = makeRegister(31);
    reg.controls[0].evidence = [{ id: "EV-X", description: "x", status: "expired" }];
    expect(hasError(verdict(reg, { now: NOW }), "must be renewed")).toBe(true);
  });
});

describe("verdict — group scoping", () => {
  it("rejects an unknown group", () => {
    expect(
      hasError(verdict(makeRegister(31), { now: NOW, group: "Nope" }), "not one of the canonical"),
    ).toBe(true);
  });

  it("rejects a group with no mapped controls", () => {
    // makeRegister only maps to Legal, so Data is empty
    expect(
      hasError(verdict(makeRegister(31), { now: NOW, group: "Data" }), "no controls mapped"),
    ).toBe(true);
  });
});
