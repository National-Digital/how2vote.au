import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normaliseCopy, renderSwift, verifyNativeCopy } from "./check-native-copy.mjs";

const url = (p) => new URL(p, import.meta.url);
const REGISTRY = JSON.parse(readFileSync(url("../docs/legal/native-copy.json"), "utf8"));

/** A minimal well-formed registry, so a test mutates one property rather than restating the shape. */
const entry = (over = {}) => ({
  id: "sample",
  swiftName: "sample",
  text: "How2Vote does not recommend a candidate.",
  webSource: "web.svelte",
  ...over,
});

/** Verify a registry against sources that satisfy it, unless a test overrides them. */
const check = ({ entries, webSources, generated } = {}) => {
  const registry = { entries: entries ?? [entry()] };
  return verifyNativeCopy({
    registry,
    webSources: webSources ?? { "web.svelte": `<p><b>${registry.entries[0]?.text}</b></p>` },
    generatedPath: "apps/mobile/ios/App/App/Generated/LegalCopy.swift",
    generated: generated === undefined ? renderSwift(registry) : generated,
  });
};

describe("normaliseCopy", () => {
  it("reduces wrapped, tag-interrupted markup to the words a reader sees", () => {
    const wrapped = "<b>These numbers\n   are your choice.</b>\n  How2Vote does not\n  recommend.";
    expect(normaliseCopy(wrapped)).toBe(
      "These numbers are your choice. How2Vote does not recommend.",
    );
  });

  it("turns a tag into a space so adjacent words do not fuse", () => {
    expect(normaliseCopy("a<br>b")).toBe("a b");
  });

  it("decodes the entities this copy actually uses", () => {
    expect(normaliseCopy("AEC&#39;s rules &amp; notes")).toBe("AEC's rules & notes");
  });

  it("unescapes each entity once, so an escaped entity stays text", () => {
    expect(normaliseCopy("use &amp;lt; to show a less-than")).toBe("use &lt; to show a less-than");
  });

  it("returns empty for a non-string rather than throwing", () => {
    expect(normaliseCopy(undefined)).toBe("");
  });

  it("removes commented-out copy, so a stale note cannot stand in for live text", () => {
    expect(normaliseCopy('// was: "old wording"\nconst x = "new wording";')).not.toContain("old");
    expect(normaliseCopy("<!-- old wording --><p>new wording</p>")).toBe("new wording");
  });
});

describe("renderSwift", () => {
  it("emits a compilable constant per entry", () => {
    const swift = renderSwift({ entries: [entry({ swiftName: "noRecommendation" })] });
    expect(swift).toContain("enum LegalCopy {");
    expect(swift).toContain(
      '    static let noRecommendation = "How2Vote does not recommend a candidate."',
    );
  });

  it("escapes quotes and backslashes so the literal cannot be broken out of", () => {
    const swift = renderSwift({ entries: [entry({ text: 'a "quoted" \\ thing' })] });
    expect(swift).toContain('"a \\"quoted\\" \\\\ thing"');
  });

  it("collapses a multi-line note so it cannot escape its doc comment", () => {
    const swift = renderSwift({ entries: [entry({ note: "first\nsecond" })] });
    expect(swift).toContain("    /// first second");
  });

  it("is deterministic, so an unchanged registry never shows as drift", () => {
    expect(renderSwift(REGISTRY)).toBe(renderSwift(REGISTRY));
  });
});

describe("verifyNativeCopy", () => {
  it("passes when the registry, the web copy and the generated Swift agree", () => {
    expect(check()).toEqual({ ok: true, errors: [] });
  });

  it("matches copy that wraps across lines in its web source", () => {
    const e = entry({ text: "A voting plan is not a ballot paper: copy your numbers." });
    const result = check({
      entries: [e],
      webSources: {
        "web.svelte": "<p>\n  A voting plan is not a\n  ballot paper: copy your numbers.\n</p>",
      },
    });
    expect(result.ok).toBe(true);
  });

  // The drift this guard exists for: the web copy is reworded and nothing else changes.
  it("fails when the web source no longer carries the registered wording", () => {
    const result = check({ webSources: { "web.svelte": "<p>How2Vote suggests nothing.</p>" } });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/registered wording is not present/);
  });

  it("fails closed when a web source cannot be read", () => {
    const result = check({ webSources: { "web.svelte": null } });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/could not read webSource/);
  });

  it("fails when the generated Swift was hand-edited", () => {
    const result = check({
      generated: renderSwift({ entries: [entry()] }).replace("does not", "may"),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/out of sync with the registry/);
  });

  it("fails when the generated Swift is missing entirely", () => {
    const result = check({ generated: null });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/generated file missing/);
  });

  it("rejects a duplicate id or swiftName", () => {
    const result = check({ entries: [entry(), entry({ id: "other" })] });
    expect(result.errors.join("\n")).toMatch(/duplicate swiftName/);
  });

  // Regression: a rewording that leaves its predecessor behind in a `// was: …` note used to
  // satisfy this guard, reporting the register as met by copy no voter can read.
  it("fails when the registered wording survives only in a comment", () => {
    const result = check({
      webSources: {
        "web.svelte":
          '// was: "How2Vote does not recommend a candidate."\nconst x = "Something else.";',
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/registered wording is not present/);
  });

  it("rejects text carrying a line break, which would not compile as a Swift literal", () => {
    const result = check({ entries: [entry({ text: "line one\nline two" })] });
    expect(result.errors.join("\n")).toMatch(/control character or line break/);
  });

  it("rejects a swiftName that is a Swift keyword", () => {
    const result = check({ entries: [entry({ swiftName: "default" })] });
    expect(result.errors.join("\n")).toMatch(/is a Swift keyword/);
  });

  it("rejects a generated path outside the tree the neutrality scan covers", () => {
    const registry = { entries: [entry()] };
    const result = verifyNativeCopy({
      registry,
      webSources: { "web.svelte": entry().text },
      generatedPath: "docs/LegalCopy.swift",
      generated: renderSwift(registry),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/under the iOS app target/);
  });

  it("rejects a swiftName that would not compile", () => {
    const result = check({ entries: [entry({ swiftName: "Not-Valid" })] });
    expect(result.errors.join("\n")).toMatch(/not a lower-camel-case Swift identifier/);
  });

  it("reports every missing required field", () => {
    const result = check({ entries: [{ id: "x" }] });
    const joined = result.errors.join("\n");
    for (const field of ["swiftName", "text", "webSource"]) {
      expect(joined).toMatch(new RegExp(`missing ${field}`));
    }
  });

  it("fails closed on an unreadable or empty registry", () => {
    expect(verifyNativeCopy({ registry: null }).ok).toBe(false);
    expect(verifyNativeCopy({ registry: { entries: [] } }).ok).toBe(false);
  });
});

describe("the committed registry", () => {
  it("is in sync with the web sources and the generated Swift", () => {
    const webSources = {};
    for (const e of REGISTRY.entries) {
      webSources[e.webSource] = readFileSync(url(`../${e.webSource}`), "utf8");
    }
    const generated = readFileSync(url(`../${REGISTRY.generated}`), "utf8");
    expect(verifyNativeCopy({ registry: REGISTRY, webSources, generated })).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("registers the DISC-NO-RECOMMENDATION disclaimer the card must carry", () => {
    const texts = REGISTRY.entries.map((e) => e.text);
    expect(texts).toContain("How2Vote does not recommend a candidate or a preference order");
  });
});
