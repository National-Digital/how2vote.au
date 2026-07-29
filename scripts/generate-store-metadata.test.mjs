import { describe, expect, it } from "vitest";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import {
  ANDROID_IMAGE_MAP,
  FDROID_FILES,
  authorisationLine,
  buildMetadata,
  fdroidTargetRel,
  validateMetadata,
} from "./generate-store-metadata.mjs";

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

describe("F-Droid listing mirror", () => {
  const files = buildMetadata(operator, copy);
  const ROOT = new URL("../", import.meta.url);
  const at = (rel) => new URL(rel, ROOT);

  it("mirrors every text file F-Droid renders, and only android ones", () => {
    for (const path of FDROID_FILES) {
      expect(path.startsWith("android/")).toBe(true);
      expect(files[path], `${path} is not produced by buildMetadata`).toBeTruthy();
    }
  });

  it("writes the mirror under the repo-root path fdroidserver globs", () => {
    expect(fdroidTargetRel("android/title.txt")).toBe("fastlane/metadata/android/en-US/title.txt");
    expect(fdroidTargetRel("android/changelogs/default.txt")).toBe(
      "fastlane/metadata/android/en-US/changelogs/default.txt",
    );
  });

  it("keeps images as symlinks into the screenshot pack", () => {
    expect(ANDROID_IMAGE_MAP.length).toBeGreaterThan(0);
    for (const { name, source } of ANDROID_IMAGE_MAP) {
      expect(source.startsWith("apps/mobile/fastlane/screenshots/")).toBe(true);
      expect(existsSync(at(source)), `${source} missing`).toBe(true);
      const link = at(`fastlane/metadata/android/en-US/images/${name}`);
      expect(lstatSync(link).isSymbolicLink(), `${name} is not a symlink`).toBe(true);
      expect(existsSync(link), `${name} is dangling`).toBe(true);
    }
  });

  it("uses the fastlane image names supply and fdroidserver recognise", () => {
    expect(ANDROID_IMAGE_MAP.map((e) => e.name)).toEqual([
      "phoneScreenshots",
      "tenInchScreenshots",
      "featureGraphic.png",
    ]);
    for (const { name, dir } of ANDROID_IMAGE_MAP) {
      expect(dir).toBe(!name.includes("."));
    }
  });
});
