import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeTotals, determinationVerdict, verdict } from "./check-expenditure-register.mjs";

const REAL = JSON.parse(
  readFileSync(new URL("../docs/legal/electoral-expenditure.json", import.meta.url), "utf8"),
);
const VENDORS = JSON.parse(
  readFileSync(
    new URL("../apps/web/src/lib/privacy/third-party-services.json", import.meta.url),
    "utf8",
  ),
);
const NOW = Date.parse("2026-07-20T00:00:00Z");
const clone = (value) => JSON.parse(JSON.stringify(value));
const hasError = (result, needle) => result.errors.some((error) => error.includes(needle));

describe("real register", () => {
  it("is valid and vendor-complete", () => {
    const result = verdict(REAL, { now: NOW, vendorRegistry: VENDORS });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("computes the committed totals", () => {
    expect(computeTotals(REAL)).toEqual({ actual: 3921.04, electoral: 3921.04 });
  });
});

describe("period totals and thresholds", () => {
  it("fails when a declared total differs from its records", () => {
    const register = clone(REAL);
    register.periods[0].totalElectoralExpenditure += 1;
    expect(hasError(verdict(register, { now: NOW }), "totalElectoralExpenditure")).toBe(true);
  });

  it("uses strictly more than the threshold", () => {
    const register = clone(REAL);
    const period = register.periods[0];
    period.records[0].actualAmount = period.disclosureThreshold;
    period.records[0].electoralAmount = period.disclosureThreshold;
    for (const record of period.records.slice(1)) {
      record.actualAmount = 0;
      record.electoralAmount = 0;
    }
    period.totalActualCashCost = period.disclosureThreshold;
    period.totalElectoralExpenditure = period.disclosureThreshold;
    period.thresholdExceeded = false;
    period.thirdPartyReturnRequired = false;
    register.lifeToDate["actualCashCostThrough2026-07-26"] = computeTotals(register).actual;
    register.lifeToDate["conservativelyClassifiedElectoralExpenditureThrough2026-07-26"] =
      computeTotals(register).electoral;
    expect(verdict(register, { now: NOW }).ok).toBe(true);
  });

  it("requires a return once the threshold is exceeded", () => {
    const register = clone(REAL);
    const period = register.periods[0];
    period.records[0].actualAmount = period.disclosureThreshold + 1;
    period.records[0].electoralAmount = period.disclosureThreshold + 1;
    for (const record of period.records.slice(1)) {
      record.actualAmount = 0;
      record.electoralAmount = 0;
    }
    period.totalActualCashCost = period.disclosureThreshold + 1;
    period.totalElectoralExpenditure = period.disclosureThreshold + 1;
    period.thresholdExceeded = false;
    period.thirdPartyReturnRequired = false;
    register.lifeToDate["actualCashCostThrough2026-07-26"] = computeTotals(register).actual;
    register.lifeToDate["conservativelyClassifiedElectoralExpenditureThrough2026-07-26"] =
      computeTotals(register).electoral;
    const result = verdict(register, { now: NOW });
    expect(hasError(result, "thresholdExceeded must be true")).toBe(true);
    expect(hasError(result, "thirdPartyReturnRequired must be true")).toBe(true);
  });
});

describe("classification integrity", () => {
  it("does not permit a commercial value to be invented for not-expenditure labour", () => {
    const register = clone(REAL);
    const labour = register.periods
      .flatMap((period) => period.records)
      .find((record) => record.classification === "not-expenditure");
    labour.actualAmount = 1000;
    expect(
      hasError(verdict(register, { now: NOW }), "not-expenditure requires actualAmount = 0"),
    ).toBe(true);
  });

  it("requires electoral records to count their full actual amount", () => {
    const register = clone(REAL);
    register.periods[0].records[0].electoralAmount = 1;
    expect(hasError(verdict(register, { now: NOW }), "electoralAmount = actualAmount")).toBe(true);
  });
});

describe("governance", () => {
  it("fails when the review is overdue", () => {
    const result = verdict(REAL, {
      now: Date.parse("2026-12-02T00:00:00Z"),
      vendorRegistry: VENDORS,
    });
    expect(hasError(result, "review overdue")).toBe(true);
  });

  it("fails if a current vendor disappears from the ledger", () => {
    const register = clone(REAL);
    for (const period of register.periods) {
      period.records = period.records.filter((record) => !record.supplier.includes("GitHub"));
      period.totalActualCashCost =
        Math.round(period.records.reduce((sum, record) => sum + record.actualAmount, 0) * 100) /
        100;
      period.totalElectoralExpenditure =
        Math.round(period.records.reduce((sum, record) => sum + record.electoralAmount, 0) * 100) /
        100;
    }
    expect(hasError(verdict(register, { now: NOW, vendorRegistry: VENDORS }), "GitHub")).toBe(true);
  });
});

describe("determination drift gate", () => {
  const MD = readFileSync(
    new URL("../docs/legal/electoral-expenditure-determination.md", import.meta.url),
    "utf8",
  );

  it("the real determination matches the ledger", () => {
    expect(determinationVerdict(REAL, MD).ok).toBe(true);
  });

  it("fails when a headline figure goes stale", () => {
    const stale = MD.replace("A$578.30", "A$999.99");
    expect(hasError(determinationVerdict(REAL, stale), "highest-period amount")).toBe(true);
  });

  it("fails when the review window drifts", () => {
    const stale = MD.replace("2018-10-12", "2019-01-01");
    expect(hasError(determinationVerdict(REAL, stale), "review window start")).toBe(true);
  });

  it("fails when the ledger changes under an unchanged document", () => {
    const register = clone(REAL);
    const period = register.periods.find((entry) => entry.id === "2026-H2");
    for (const record of period.records) {
      if (record.id === "2026-H2-AWS") {
        record.actualAmount = 25;
        record.electoralAmount = 25;
      }
    }
    period.totalActualCashCost = 25;
    period.totalElectoralExpenditure = 25;
    expect(hasError(determinationVerdict(register, MD), "current-period amount")).toBe(true);
  });

  it("fails closed on an empty document", () => {
    expect(determinationVerdict(REAL, "").ok).toBe(false);
  });
});
