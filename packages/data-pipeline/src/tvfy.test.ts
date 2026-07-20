import { describe, expect, it } from "vitest";
import {
  bucketAgreement,
  compilePolicy,
  memberPartyKey,
  normalisePartyKey,
  type TvfyPolicyDetail,
} from "./tvfy.js";

describe("normalisePartyKey", () => {
  it("removes apostrophes, collapses whitespace, lower-cases", () => {
    expect(normalisePartyKey("Pauline Hanson's One Nation Party")).toBe(
      "pauline_hansons_one_nation_party",
    );
    expect(normalisePartyKey("Australian   Labor  Party")).toBe("australian_labor_party");
  });
});

describe("memberPartyKey (independents)", () => {
  const base = { name: { first: "Andrew", last: "Wilkie" }, party: "Independent" };
  it("labels a House independent '<name> MP'", () => {
    expect(memberPartyKey({ ...base, house: "representatives" })).toBe("andrew_wilkie_mp");
  });
  it("labels a Senate independent 'Senator <name>'", () => {
    expect(memberPartyKey({ ...base, house: "senate" })).toBe("senator_andrew_wilkie");
  });
  it("passes through a normal party", () => {
    expect(
      memberPartyKey({ name: { first: "X", last: "Y" }, party: "The Greens", house: "senate" }),
    ).toBe("the_greens");
  });
});

describe("bucketAgreement", () => {
  it("maps by ceiling boundaries", () => {
    expect(bucketAgreement(0)).toBe(1); // exact zero forced to bucket 1
    expect(bucketAgreement(20)).toBe(1);
    expect(bucketAgreement(21)).toBe(2);
    expect(bucketAgreement(63)).toBe(4); // 63% → bucket 4
    expect(bucketAgreement(80)).toBe(4);
    expect(bucketAgreement(81)).toBe(5);
    expect(bucketAgreement(100)).toBe(5);
  });
});

describe("compilePolicy (order-independent mean)", () => {
  const detail = (agreements: [string, number][]): TvfyPolicyDetail => ({
    id: 1,
    name: "Policy",
    description: "desc",
    policy_divisions: [{ division: { date: "2024-06-01" } }, { division: { date: "2024-02-01" } }],
    people_comparisons: agreements.map(([party, agreement]) => ({
      person: { latest_member: { name: { first: "A", last: "B" }, house: "senate", party } },
      agreement: String(agreement),
    })),
  });

  it("averages members [10, 90] to 50 → bucket 3 regardless of order", () => {
    const forward = compilePolicy(
      detail([
        ["Party X", 10],
        ["Party X", 90],
      ]),
    );
    const reversed = compilePolicy(
      detail([
        ["Party X", 90],
        ["Party X", 10],
      ]),
    );
    expect(forward.positions["party_x"]).toBe(3);
    expect(reversed.positions["party_x"]).toBe(3); // same result regardless of order
  });

  it("captures the division date range", () => {
    const c = compilePolicy(detail([["Party X", 50]]));
    expect(c.divisionFirst).toBe("2024-02-01");
    expect(c.divisionLast).toBe("2024-06-01");
    expect(c.divisionCount).toBe(2);
  });

  it("omits parties with no finite agreement (implicit no-data)", () => {
    const c = compilePolicy(detail([["Ghost", Number.NaN as unknown as number]]));
    expect(c.positions["ghost"]).toBeUndefined();
  });
});

describe("compilePolicy — blank agreement is skipped, not counted as 0%", () => {
  const detail = (agreements) => ({
    policy_divisions: [{ division: { date: "2020-01-01" } }],
    people_comparisons: agreements.map((a, i) => ({
      agreement: a,
      person: { latest_member: { name: { first: "A", last: `M${i}` }, party: "Test Party" } },
    })),
  });
  it("ignores '' / null / whitespace agreements (they would be Number()→0)", () => {
    // Two real 100% agreements + a blank one: the blank must NOT drag the mean towards 0.
    const compiled = compilePolicy(detail(["100", "100", ""]));
    const keys = Object.keys(compiled.positions);
    expect(keys.length).toBe(1);
    expect(compiled.positions[keys[0]]).toBe(5); // ~100% → strongly agree, not diluted by a phantom 0
  });
});
