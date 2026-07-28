import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { authorisationLine, buildMetadata, validateMetadata } from "./generate-store-metadata.mjs";

// The REAL operator + product-copy records — the invariants must hold for what actually ships.
const operator = JSON.parse(
  readFileSync(new URL("../apps/web/src/lib/operator.json", import.meta.url), "utf8"),
);
const copy = JSON.parse(
  readFileSync(new URL("../apps/web/src/lib/product-copy.json", import.meta.url), "utf8"),
);

describe("store metadata", () => {
  const files = buildMetadata(operator, copy);

  it("is valid against every store limit, brand rule and no-drift check", () => {
    expect(validateMetadata(files, operator, copy)).toEqual([]);
  });

  it("carries the s 321D authorisation line in both store descriptions, composed from operator.json", () => {
    const auth = authorisationLine(operator);
    expect(auth).toContain(operator.authorisation.locality);
    expect(auth).toContain(operator.authorisation.state);
    expect(files["ios/description.txt"]).toContain(auth);
    expect(files["android/full_description.txt"]).toContain(auth);
  });

  it("builds descriptions entirely from the shared product-copy (no store-vs-web drift)", () => {
    // Every shared claim body appears verbatim in both listings — the single-source guarantee.
    for (const claim of Object.values(copy.claims)) {
      expect(files["ios/description.txt"]).toContain(claim.body);
      expect(files["android/full_description.txt"]).toContain(claim.body);
    }
    expect(files["ios/description.txt"]).toContain(copy.howItWorks);
  });

  it("detects drift when a claim is edited only in the built output", () => {
    const drifted = {
      ...files,
      "ios/description.txt": files["ios/description.txt"].replace(copy.claims.private.body, "x"),
    };
    expect(
      validateMetadata(drifted, operator, copy).some((i) => i.includes('claim "private"')),
    ).toBe(true);
  });

  it("recommends no party and stays neutral in tone", () => {
    expect(files["ios/description.txt"]).toContain("no preference is recommended");
    expect(files["android/full_description.txt"]).toContain("no preference is recommended");
  });

  it("never claims an absence of data collection in the App Review notes", () => {
    // The shells ship an opt-in aggregate research contribution and first-party contact forms, and
    // the App Privacy declaration says so. A review note claiming otherwise contradicts a mandatory
    // declaration, which is a rejection risk.
    const notes = files["ios/review_information/notes.txt"];
    expect(notes).not.toMatch(/no data collection/i);
    expect(notes).not.toMatch(/(collects?|collection of)\s+no\b/i);
    expect(notes).not.toMatch(/nothing (?:is )?(?:ever )?(?:collected|leaves the device)/i);
    // …and it states positively what does leave the device.
    expect(notes).toMatch(/opt-in/i);
    expect(notes).toMatch(/contact\/feedback form/i);
  });

  it("catches an over-limit field", () => {
    const broken = { ...files, "ios/name.txt": "x".repeat(31) };
    expect(validateMetadata(broken, operator, copy).some((i) => i.includes("ios/name.txt"))).toBe(
      true,
    );
  });

  it("catches a registration-mark claim", () => {
    const broken = { ...files, "android/title.txt": "How2Vote ™" };
    expect(
      validateMetadata(broken, operator, copy).some((i) => i.includes("android/title.txt")),
    ).toBe(true);
  });
});
