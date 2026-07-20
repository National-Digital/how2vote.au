import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict } from "./check-product-boundary.mjs";

const BOUNDARY = JSON.parse(
  readFileSync(new URL("../data/legal/product-boundary.json", import.meta.url), "utf8"),
);
const PLANE = JSON.parse(
  readFileSync(new URL("../data/governance/control-plane.json", import.meta.url), "utf8"),
);

const NOW = Date.parse("2026-07-19T00:00:00Z");
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));
const clone = (v) => JSON.parse(JSON.stringify(v));

describe("verdict — real committed boundary", () => {
  it("is well-formed, current and consistent with the control plane", () => {
    const res = verdict({ boundary: BOUNDARY, controlPlane: PLANE, now: NOW });
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe("verdict — fail closed", () => {
  it("rejects a non-object", () => {
    expect(verdict({ boundary: null, controlPlane: PLANE, now: NOW }).ok).toBe(false);
  });

  it("rejects an expired boundary", () => {
    const later = Date.parse("2027-01-01T00:00:00Z");
    expect(
      hasError(verdict({ boundary: BOUNDARY, controlPlane: PLANE, now: later }), "expired"),
    ).toBe(true);
  });

  it("rejects printMode=disabled when printing is not actually suspended", () => {
    // The consistency rule: a boundary that DECLARES printing off must be enforced by an active
    // control-plane suspension. The committed plane's suspensions are lifted, so a disabled boundary
    // over it is not enforced.
    const b = clone(BOUNDARY);
    b.boundary.printMode = "disabled";
    b.boundary.printExportEnabled = false;
    expect(hasError(verdict({ boundary: b, controlPlane: PLANE, now: NOW }), "not enforced")).toBe(
      true,
    );
  });

  it("rejects researchEnabled=false when research is not actually suspended", () => {
    const b = clone(BOUNDARY);
    b.boundary.researchEnabled = false;
    expect(hasError(verdict({ boundary: b, controlPlane: PLANE, now: NOW }), "not enforced")).toBe(
      true,
    );
  });

  it("treats a lifted printing suspension as not enforcing a disabled boundary", () => {
    const b = clone(BOUNDARY);
    b.boundary.printMode = "disabled";
    // Even if a printing suspension is present but LIFTED, it does not enforce a disabled boundary.
    const plane = clone(PLANE);
    plane.suspensions = [
      {
        scope: "printing",
        reason: "x",
        by: "y",
        flaggedAt: "2026-07-19",
        liftedAt: "2026-07-19",
        liftedBy: "z",
      },
    ];
    expect(hasError(verdict({ boundary: b, controlPlane: plane, now: NOW }), "not enforced")).toBe(
      true,
    );
  });

  it("accepts printMode=disabled when printing IS actively suspended", () => {
    const b = clone(BOUNDARY);
    b.boundary.printMode = "disabled";
    b.boundary.printExportEnabled = false;
    b.boundary.researchEnabled = false;
    const plane = clone(PLANE);
    plane.suspensions = [
      { scope: "printing", reason: "x", by: "y", flaggedAt: "2026-07-19" },
      { scope: "research", reason: "x", by: "y", flaggedAt: "2026-07-19" },
    ];
    expect(verdict({ boundary: b, controlPlane: plane, now: NOW }).ok).toBe(true);
  });

  it("rejects an unknown printMode enum", () => {
    const b = clone(BOUNDARY);
    b.boundary.printMode = "whatever";
    expect(hasError(verdict({ boundary: b, controlPlane: PLANE, now: NOW }), "printMode")).toBe(
      true,
    );
  });

  it("rejects candidate-row score placement until a redesign is signed off", () => {
    const b = clone(BOUNDARY);
    b.boundary.candidateScorePlacement = "candidate-row";
    expect(
      hasError(verdict({ boundary: b, controlPlane: PLANE, now: NOW }), "party-panel-only"),
    ).toBe(true);
  });

  it("rejects a determination marked determined without a two-person sign-off / date", () => {
    const b = clone(BOUNDARY);
    b.determinations.printAuthoriser = {
      status: "determined",
      determination: "x",
      evidenceRef: "EV",
      basis: "y",
    };
    const res = verdict({ boundary: b, controlPlane: PLANE, now: NOW });
    expect(res.ok).toBe(false);
    expect(hasError(res, "missing reviewer")).toBe(true);
    expect(hasError(res, "secondReviewer")).toBe(true);
    expect(hasError(res, "determinationDate")).toBe(true);
  });

  it("rejects a determination whose two reviewers are the same person", () => {
    const b = clone(BOUNDARY);
    b.determinations.printAuthoriser = {
      status: "determined",
      determination: "x",
      evidenceRef: "EV",
      basis: "y",
      reviewer: "a",
      secondReviewer: "a",
      determinationDate: "2026-07-19",
    };
    expect(
      hasError(verdict({ boundary: b, controlPlane: PLANE, now: NOW }), "two distinct people"),
    ).toBe(true);
  });
});
