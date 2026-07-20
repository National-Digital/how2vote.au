import { describe, expect, it } from "vitest";
import { verdict } from "./check-privacy-claims.mjs";

const clone = (o) => JSON.parse(JSON.stringify(o));
const NOW = Date.parse("2026-07-16");
const FUTURE = "2027-07-16";

const controlRegister = {
  controls: [
    {
      id: "control-21",
      tests: [{ id: "privacy-claims-generated", status: "passing" }],
      evidence: [{ id: "EV-DEIDENTIFICATION-ASSESSMENT", status: "pending" }],
    },
    {
      id: "control-22",
      tests: [{ id: "research-transport-policy", status: "passing" }],
      evidence: [{ id: "EV-PROVIDER-DPA", status: "pending" }],
    },
  ],
};

const goodClaim = {
  id: "PC-A",
  substantiatedWording: "Strong claim A.",
  fallbackWording: "Hedged A.",
  substantiatingControl: "control",
  tests: ["research-transport-policy"],
  evidence: ["EV-PROVIDER-DPA"],
  approver: "Someone",
  approvedAt: "2026-07-16",
  expiresAt: FUTURE,
};

const goodDeid = {
  schemaVersion: 1,
  boundSchemaVersion: 1,
  kThreshold: 10,
  fields: [
    { name: "match", collected: true, aggregation: "counter", geographyScope: "state" },
    {
      name: "demographics",
      collected: true,
      aggregation: "counter",
      geographyScope: "national",
      sensitiveDimensions: ["religion", "orientation"],
    },
  ],
  coreControls: [{ id: "derive-on-device", enforcedBy: ["research-transport-policy"] }],
  evidence: [{ id: "EV-DEIDENTIFICATION-ASSESSMENT", status: "pending" }],
  approver: "Someone",
  approvedAt: "2026-07-16",
  expiresAt: FUTURE,
};

const goodPage = `
  import privacyClaims from "$lib/privacy/privacy-claims.generated.json";
  {#each commitments as commitment (commitment.id)}
`;

const base = () => ({
  claimsRegister: { schemaVersion: 1, claims: [clone(goodClaim)] },
  deidRegister: clone(goodDeid),
  controlRegister,
  privacyPageText: goodPage,
  schemaVersion: 1,
  minCell: 10,
  sensitiveDimensions: ["orientation", "religion"],
  now: NOW,
});

describe("check-privacy-claims verdict", () => {
  it("passes on a well-formed, bound set", () => {
    expect(verdict(base())).toEqual({ ok: true, errors: [] });
  });

  it("fails a claim missing a fallback wording", () => {
    const input = base();
    delete input.claimsRegister.claims[0].fallbackWording;
    const r = verdict(input);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /missing fallbackWording/.test(e))).toBe(true);
  });

  it("fails an orphan test reference", () => {
    const input = base();
    input.claimsRegister.claims[0].tests = ["does-not-exist"];
    expect(verdict(input).errors.some((e) => /orphan/.test(e))).toBe(true);
  });

  it("fails an orphan evidence reference", () => {
    const input = base();
    input.claimsRegister.claims[0].evidence = ["EV-NOPE"];
    expect(verdict(input).errors.some((e) => /EV-NOPE.*orphan/.test(e))).toBe(true);
  });

  it("fails a de-id register not bound to the schema version", () => {
    const input = base();
    input.deidRegister.boundSchemaVersion = 2;
    expect(verdict(input).errors.some((e) => /boundSchemaVersion/.test(e))).toBe(true);
  });

  it("fails a k-threshold that is not MIN_CELL", () => {
    const input = base();
    input.deidRegister.kThreshold = 5;
    expect(verdict(input).errors.some((e) => /kThreshold/.test(e))).toBe(true);
  });

  it("fails when sensitiveDimensions drift from survey.ts", () => {
    const input = base();
    input.deidRegister.fields[1].sensitiveDimensions = ["religion"];
    expect(verdict(input).errors.some((e) => /sensitiveDimensions/.test(e))).toBe(true);
  });

  it("fails when the page does not render the generated projection", () => {
    const input = base();
    input.privacyPageText = "<p>no wiring here</p>";
    const r = verdict(input);
    expect(r.errors.some((e) => /does not import the generated/.test(e))).toBe(true);
    expect(r.errors.some((e) => /#each commitments/.test(e))).toBe(true);
  });

  it("fails an overclaim: an unbacked claim's strong wording hard-coded on the page", () => {
    const input = base();
    // Make the claim unbacked (expired) but leave its substantiated wording on the page.
    input.claimsRegister.claims[0].expiresAt = "2020-01-01";
    input.privacyPageText = goodPage + "\n<li>Strong claim A.</li>";
    const r = verdict(input);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /overclaim/.test(e))).toBe(true);
  });
});
