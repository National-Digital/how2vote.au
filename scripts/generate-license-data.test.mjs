import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderHeader, compose } from "./generate-license-data.mjs";

const root = new URL("../", import.meta.url);
const register = JSON.parse(readFileSync(new URL("data/rights/rights-classes.json", root), "utf8"));
const aecSpatial = JSON.parse(
  readFileSync(new URL("data/aec-spatial/source-record.json", root), "utf8"),
);
const licenseData = readFileSync(new URL("LICENSE-DATA.md", root), "utf8");

describe("renderHeader", () => {
  it("is a single closed HTML comment ending in the terminator", () => {
    const h = renderHeader(register);
    expect(h.startsWith("<!--\n")).toBe(true);
    expect(h.trimEnd().endsWith("-->")).toBe(true);
  });

  it("carries every rights class's required attribution string", () => {
    const h = renderHeader(register);
    for (const rc of register.rightsClasses) {
      if (rc.attributionRequired) expect(h).toContain(rc.attribution);
    }
  });

  it("labels a provisional licence as provisional and does not present its terms as settled", () => {
    // Synthetic input: the renderer's disclosure path must be correct independent of whether the
    // live register currently holds any provisional class (the committed register is all `current`,
    // enforced by check-rights-domain — a provisional licence never ships). This proves that IF a
    // licence is ever provisional, LICENSE-DATA.md flags it rather than presenting it as settled.
    const provisional = JSON.parse(JSON.stringify(register));
    provisional.rightsClasses[provisional.rightsClasses.length - 1].licenceStatus = "provisional";
    const h = renderHeader(provisional);
    expect(h).toContain("status: provisional");
    expect(h).toContain("Terms (provisional, subject to the pending licence determination)");
  });

  it("never emits the literal 'undefined' (all interpolated fields are present)", () => {
    expect(renderHeader(register, aecSpatial)).not.toContain("undefined");
  });

  it("renders the full AEC derivative-product notice when the source record is supplied", () => {
    const h = renderHeader(register, aecSpatial);
    expect(h).toContain("AEC SPATIAL DATA — DERIVATIVE PRODUCT NOTICE");
    expect(h).toContain("has not evaluated the Data");
    expect(h).toContain("for your personal use, or use within your organisation only");
  });
});

describe("compose / drift", () => {
  it("reproduces the committed LICENSE-DATA.md exactly (no drift)", () => {
    expect(compose(register, licenseData, aecSpatial)).toBe(licenseData);
  });

  it("preserves the ODbL statutory body verbatim", () => {
    const out = compose(register, licenseData, aecSpatial);
    expect(out).toContain("Open Database License (ODbL) v1.0");
  });

  it("throws if the header terminator is absent", () => {
    expect(() => compose(register, "no comment here", aecSpatial)).toThrow(/terminator/);
  });
});
