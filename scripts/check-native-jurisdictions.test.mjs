import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  nativeJurisdictions,
  verifyJurisdictions,
  webJurisdictions,
} from "./check-native-jurisdictions.mjs";

const url = (p) => new URL(p, import.meta.url);
const WEB = readFileSync(url("../apps/web/src/lib/data.ts"), "utf8");
const NATIVE = readFileSync(url("../apps/mobile/ios/App/App/Model/Jurisdictions.swift"), "utf8");

describe("webJurisdictions / nativeJurisdictions", () => {
  it("read the same eight, in the same order, from the committed sources", () => {
    const codes = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];
    expect(webJurisdictions(WEB).map((j) => j.code)).toEqual(codes);
    expect(nativeJurisdictions(NATIVE).map((j) => j.code)).toEqual(codes);
  });
});

describe("verifyJurisdictions", () => {
  it("passes on the committed sources", () => {
    expect(verifyJurisdictions(WEB, NATIVE)).toEqual([]);
  });

  // A missing entry is a state with no way to reach the questionnaire, on one channel only.
  it("catches a dropped state", () => {
    const dropped = NATIVE.replace(/\s*Jurisdiction\(code: "NT".*\),/, "");
    expect(verifyJurisdictions(WEB, dropped).join(" ")).toContain(
      "8 states and territories on the web and 7",
    );
  });

  // The code is matched against the compiled dataset, so a typo returns an empty electorate list
  // and the picker simply looks broken for everyone who lives there.
  it("catches a code that would match no electorates", () => {
    const typo = NATIVE.replace('code: "QLD"', 'code: "QLD "');
    expect(verifyJurisdictions(WEB, typo).join(" ")).toContain("entry 3 differs");
  });

  it("catches a drifted name", () => {
    const drifted = NATIVE.replace('name: "Tasmania"', 'name: "Tas"');
    expect(verifyJurisdictions(WEB, drifted).join(" ")).toContain('native TAS "Tas"');
  });

  it("fails closed when either side is unreadable", () => {
    expect(verifyJurisdictions("", NATIVE).join(" ")).toContain("no STATES");
    expect(verifyJurisdictions(WEB, "").join(" ")).toContain("declares none");
  });
});
