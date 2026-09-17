import { describe, expect, it } from "vitest";
import {
  GENERATED_HEADER,
  commandsIn,
  renderSwift,
  unsupportedIn,
  verifyNativeBrand,
} from "./check-native-brand.mjs";

const WORDMARK = {
  viewBox: "0 -10 100 12",
  width: 100,
  height: 12,
  textD: "M0 0L10 0V-5Q12 -6 14 -5Z",
  rect: { x: 40, y: -9, width: 8, height: 8, rx: 1, strokeWidth: 0.5 },
  numeralD: "M42 -2Q44 -8 46 -2Z",
};

describe("commandsIn", () => {
  it("reports the command letters a path uses", () => {
    expect(commandsIn("M0 0L1 1Z")).toEqual(new Set(["M", "L", "Z"]));
  });
});

describe("unsupportedIn", () => {
  it("passes the commands the native reader implements", () => {
    expect(unsupportedIn({ textD: WORDMARK.textD, numeralD: WORDMARK.numeralD })).toEqual([]);
  });

  // A lenient reader would skip these and draw a subtly wrong logo, which is worse than not
  // drawing one — so they have to fail on Linux, before anything reaches a device.
  it("refuses cubic curves and arcs", () => {
    expect(unsupportedIn({ textD: "M0 0C1 1 2 2 3 3" })[0]).toContain('"C"');
    expect(unsupportedIn({ textD: "M0 0A1 1 0 0 1 2 2" }).length).toBeGreaterThan(0);
  });

  it("refuses relative commands, which read as absolute ones if ignored", () => {
    expect(unsupportedIn({ textD: "M0 0l10 0" })[0]).toContain('"l"');
  });
});

describe("renderSwift", () => {
  it("carries the geometry and marks itself generated", () => {
    const swift = renderSwift(WORDMARK);
    expect(swift.startsWith(GENERATED_HEADER)).toBe(true);
    expect(swift).toContain("width: 100, height: 12");
    expect(swift).toContain(WORDMARK.textD);
    expect(swift).toContain(WORDMARK.numeralD);
    expect(swift).toContain("strokeWidth: 0.5");
  });
});

describe("verifyNativeBrand", () => {
  const generatedPath = "Generated/BrandMark.swift";

  it("passes when the Swift is exactly what the source renders", () => {
    const { ok, errors } = verifyNativeBrand({
      wordmark: WORDMARK,
      generatedPath,
      generated: renderSwift(WORDMARK),
    });
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
  });

  // A hand-edit to the Swift is not a second opinion about the logo.
  it("fails on a hand-edited Swift file", () => {
    const tampered = renderSwift(WORDMARK).replace("width: 100", "width: 120");
    const { ok, errors } = verifyNativeBrand({
      wordmark: WORDMARK,
      generatedPath,
      generated: tampered,
    });
    expect(ok).toBe(false);
    expect(errors[0]).toContain("does not match the brand source");
  });

  it("fails when the mark changed and the Swift did not", () => {
    const moved = { ...WORDMARK, width: 140 };
    const { ok } = verifyNativeBrand({
      wordmark: moved,
      generatedPath,
      generated: renderSwift(WORDMARK),
    });
    expect(ok).toBe(false);
  });

  it("fails closed when the generated file is absent", () => {
    const { ok, errors } = verifyNativeBrand({
      wordmark: WORDMARK,
      generatedPath,
      generated: null,
    });
    expect(ok).toBe(false);
    expect(errors[0]).toContain("--write");
  });

  it("fails closed when the source cannot be read", () => {
    expect(verifyNativeBrand({ wordmark: null, generatedPath, generated: "" }).ok).toBe(false);
  });

  // Unsupported geometry must be caught even if the Swift happens to be in sync with it.
  it("fails on geometry the native reader cannot draw", () => {
    const curvy = { ...WORDMARK, textD: "M0 0C1 1 2 2 3 3" };
    const { ok, errors } = verifyNativeBrand({
      wordmark: curvy,
      generatedPath,
      generated: renderSwift(curvy),
    });
    expect(ok).toBe(false);
    expect(errors[0]).toContain("does not implement");
  });
});
