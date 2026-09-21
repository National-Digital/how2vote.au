import { describe, expect, it } from "vitest";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import {
  ANDROID_IMAGE_MAP,
  FDROID_FILES,
  authorisationLine,
  buildMetadata,
  reviewerRoute,
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

  it("names an official source for every piece of government information", () => {
    // Each URL must be present and absolute, so the stores render it as a link, not dead text.
    expect(copy.sources.items.length).toBeGreaterThan(0);
    for (const path of ["ios/description.txt", "android/full_description.txt"]) {
      for (const { url } of copy.sources.items) {
        expect(files[path], `${path} omits ${url}`).toContain(url);
        expect(url).toMatch(/^https:\/\//);
      }
    }
    // The AEC and the parliamentary record are the two government sources the app draws on.
    const urls = copy.sources.items.map((s) => s.url).join(" ");
    expect(urls).toContain("aec.gov.au");
    expect(urls).toContain("aph.gov.au");
  });

  it("disclaims government affiliation near the top of both descriptions", () => {
    for (const path of ["ios/description.txt", "android/full_description.txt"]) {
      const at = files[path].indexOf(copy.disclaimer.body);
      expect(at, `${path} omits the disclaimer`).toBeGreaterThan(-1);
      expect(at, `${path} buries the disclaimer at ${at}`).toBeLessThanOrEqual(600);
    }
    expect(copy.disclaimer.body).toMatch(/not affiliated with/i);
    expect(copy.disclaimer.body).toMatch(/Australian Electoral Commission/);
  });

  it("detects a dropped source link, a buried disclaimer and a relative URL", () => {
    const [first] = copy.sources.items;
    const dropped = {
      ...files,
      "android/full_description.txt": files["android/full_description.txt"].replace(first.url, ""),
    };
    expect(validateMetadata(dropped, operator, copy).some((i) => i.includes(first.url))).toBe(true);

    // Same text, moved past the visible window — present but not "easy to see".
    const buried = {
      ...files,
      "ios/description.txt":
        files["ios/description.txt"].replace(copy.disclaimer.body, "") +
        `\n${"x".repeat(700)}\n${copy.disclaimer.body}`,
    };
    expect(validateMetadata(buried, operator, copy).some((i) => i.includes("buried"))).toBe(true);

    const relative = {
      ...copy,
      sources: { ...copy.sources, items: [{ label: "AEC", url: "www.aec.gov.au" }] },
    };
    expect(
      validateMetadata(files, operator, relative).some((i) => i.includes("absolute https:// URL")),
    ).toBe(true);
  });

  it("keeps the repository URL absolute so the stores link it", () => {
    expect(copy.repoUrl).toMatch(/^https:\/\/github\.com\//);
    expect(
      validateMetadata(files, operator, { ...copy, repoUrl: "github.com/x/y" }).some((i) =>
        i.includes("repoUrl"),
      ),
    ).toBe(true);
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

describe("reviewerRoute", () => {
  const NEXT = {
    id: "next",
    label: "Next Federal Election",
    shortLabel: "Next",
    current: true,
    provisionalStage: "pending",
  };
  const Y2025 = { id: "2025", label: "2025 Federal Election", shortLabel: "2025" };

  it("names the election that has a ballot while the default has none", () => {
    const note = reviewerRoute([NEXT, Y2025]);
    expect(note).toContain("Next Federal Election");
    expect(note).toContain('tap "2025"');
  });

  // The whole point of deriving it: a note telling a reviewer to switch elections is wrong the
  // moment the default carries its own ballot, and nobody would think to delete it by hand.
  it("retires itself once the current election is called", () => {
    const called = { ...NEXT, provisionalStage: undefined };
    expect(reviewerRoute([called, Y2025])).toBe("");
  });

  it("says nothing when there is no election to point at", () => {
    expect(reviewerRoute([NEXT])).toBe("");
    expect(reviewerRoute([])).toBe("");
  });
});
