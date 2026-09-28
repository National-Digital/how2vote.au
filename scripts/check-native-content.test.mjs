import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  debtSize,
  everyBranch,
  generatorOf,
  handWrittenCopy,
  isName,
  lexLiterals,
  parseDump,
  showsAnError,
  verifyNativeContent,
} from "./check-native-content.mjs";

// Each fixture is a Swift source, its `swiftc -dump-parse` and the copy recorded for it in
// `expected.json`. `node scripts/check-native-content.mjs --write-fixtures` regenerates the dumps, and
// the CLI holds the fixtures to `expected.json` through the live compiler before every scan.
const FIXTURES = new URL("./fixtures/native-content/", import.meta.url);
const expected = JSON.parse(readFileSync(new URL("expected.json", FIXTURES), "utf8"));
const fixture = (name) =>
  handWrittenCopy(readFileSync(new URL(`${name}.dump`, FIXTURES), "utf8"), {
    source: readFileSync(new URL(`${name}.swift`, FIXTURES), "utf8"),
    model: expected[name].model ?? false,
  });

describe("handWrittenCopy", () => {
  it("reads each fixture as recorded", () => {
    for (const name of Object.keys(expected)) expect(fixture(name)).toEqual(expected[name].copy);
  });

  it("counts copy wherever it is written, however it is dressed", () => {
    expect(expected.counted.copy).toEqual(
      expect.arrayContaining([
        'A "raw" sentence',
        "A multi-line\nsentence",
        "Search {} ({}) seats",
        "all",
        "We couldn’t load this election — check your connection",
        "appended outside the model",
      ]),
    );
  });

  it("excuses only what is plainly not copy, by where it sits", () => {
    expect(expected.excused.copy).toEqual([]);
    expect(expected.model.copy).toEqual([]);
  });

  it("counts what the parse omits, and every way round the excusals", () => {
    expect(expected.bypasses.copy).toEqual(
      expect.arrayContaining([
        "Get help now",
        "An attribute's sentence",
        "Inside an if",
        "Inside an else",
        "vote",
        "yes",
        "no",
        "Vote.",
        "Senate/House",
        "✓",
        "18+",
        "AustralianElectoralCommission",
        "Bare helper shows this sentence",
        "electorate-map",
        "Default shown to voter",
        "Shown by the web as a toast",
        "You're offline — reconnect and try again",
        "You're offline — reconnect to continue",
        "Your electorate could not be found",
        "a lower-case line on a card",
      ]),
    );
    expect(expected.bypasses.copy).not.toContain("tab-key");
  });

  it("fails a parse whose literal carries no value, rather than reading it as empty", () => {
    const dump = readFileSync(new URL("counted.dump", FIXTURES), "utf8").replaceAll(
      " value=",
      " v=",
    );
    const source = readFileSync(new URL("counted.swift", FIXTURES), "utf8");
    expect(() => handWrittenCopy(dump, { source })).toThrow(/carries no value/);
  });

  it("counts a literal the parse does not account for", () => {
    expect(handWrittenCopy("(source_file)", { source: 'Text("Hello")' })).toEqual(["Hello"]);
    expect(handWrittenCopy("(source_file)", { source: 'x["electionId"]' })).toEqual([]);
    expect(handWrittenCopy("(source_file)", { source: '// Text("a comment")' })).toEqual([]);
  });

  it("refuses a dump it cannot read", () => {
    expect(() => parseDump("(source_file (x)")).toThrow(/ends inside a node/);
    expect(() => parseDump("(source_file))")).toThrow(/never opened/);
  });
});

describe("lexLiterals", () => {
  it("reads literals as Swift decodes them, skipping comments", () => {
    const source = [
      '/* "not /* nested */ this" */ let a = "One \\u{2014} two\\n" // "nor this"',
      'let b = #"A "raw" \\#(x) line"#',
      'let c = "Outer \\(f("inner")) end"',
      'let d = """',
      "    Multi",
      "    line \\(y)",
      '    """',
    ].join("\n");
    expect(lexLiterals(source)).toEqual([
      "One — two\n",
      'A "raw" {} line',
      "inner",
      "Outer {} end",
      "\n    Multi\n    line {}\n    ",
    ]);
  });

  it("fails on a literal it cannot close", () => {
    expect(() => lexLiterals('let a = "open')).toThrow(/runs past its line|never closed/);
  });
});

describe("everyBranch", () => {
  it("blanks conditional-compilation directives and keeps every line", () => {
    const source = "#if DEBUG\na\n  #elseif os(iOS)\nb\n#else\nc\n#endif";
    expect(everyBranch(source)).toBe("\na\n\nb\n\nc\n");
  });
});

describe("showsAnError", () => {
  it("knows a view that shows an error's description, by any name a catch binds", () => {
    for (const shown of [
      "Text(String(describing: error))",
      "Text(loadError.localizedDescription)",
      'Text("Failed: \\(error)")',
      'do { try x() } catch let failure { message = "\\(failure)" }',
    ]) {
      expect(showsAnError(shown)).toBe(true);
    }
    expect(showsAnError("Text(message)")).toBe(false);
    expect(showsAnError('NSLog("How2Vote: \\(error)")')).toBe(false);
  });
});

describe("generatorOf", () => {
  const legal = "apps/mobile/ios/App/App/Generated/LegalCopy.swift";
  const header = (script) => `// Generated by ${script} — DO NOT EDIT.\nenum X {}`;

  it("exempts a registered file carrying its own generator's header", () => {
    expect(generatorOf(legal, header("scripts/check-native-copy.mjs"))).toBe(
      "scripts/check-native-copy.mjs",
    );
    expect(generatorOf("apps/mobile/ios/App/App/Views/Landing.swift", "enum X {}")).toBeNull();
  });

  it("fails a header on a file no generator owns, or naming the wrong one", () => {
    expect(() =>
      generatorOf(
        "apps/mobile/ios/App/App/Views/Gate.swift",
        header("scripts/check-native-copy.mjs"),
      ),
    ).toThrow(/no generator owns it/);
    expect(() => generatorOf(legal, header("scripts/check-native-brand.mjs"))).toThrow(
      /generated by scripts\/check-native-copy\.mjs/,
    );
    expect(() => generatorOf(legal, "enum X {}")).toThrow(/names no generator/);
  });
});

describe("isName", () => {
  it("tells keys, codes and templates from words", () => {
    for (const name of [
      "electionId",
      "au.how2vote.app",
      "/ballot",
      "/quiz?edit=1",
      "https://example.org",
      "%02x",
      "\n",
      "{}://link/{}",
      "M",
      "NativeRouter",
      "CapacitorStorage.",
      "native-document",
      "lede-{}-",
      "100%",
    ]) {
      expect(isName(name)).toBe(true);
    }
    for (const word of [
      "Quiz",
      "Australia",
      "OK",
      "loading screen",
      "How2Vote",
      "/ a route?",
      "Vote.",
      "e.g.",
      "Note:",
      "Senate/House",
      "✓",
      "—",
    ]) {
      expect(isName(word)).toBe(false);
    }
  });
});

describe("verifyNativeContent", () => {
  const debt = { "Landing.swift": ["Start again"] };

  it("passes when the source holds exactly the recorded debt", () => {
    expect(verifyNativeContent({ "Landing.swift": ["Start again"] }, debt, debt)).toEqual([]);
  });

  it("fails new hand-written copy, in a listed file or a new one", () => {
    expect(
      verifyNativeContent(
        { "Landing.swift": ["Start again", "Begin"], "Document.swift": ["Close"] },
        debt,
        null,
      ).join(" "),
    ).toMatch(/Landing\.swift writes "Begin".*Document\.swift writes "Close"/);
  });

  it("counts occurrences, so a listed string cannot be written again", () => {
    expect(
      verifyNativeContent({ "Landing.swift": ["Start again", "Start again"] }, debt, null).join(
        " ",
      ),
    ).toContain('writes "Start again" natively');
  });

  it("fails a listed string that is gone, so the record stays exact", () => {
    expect(verifyNativeContent({}, debt, null).join(" ")).toContain(
      'lists "Start again" in Landing.swift more often than it is written',
    );
  });

  it("fails a record edited to admit copy the base did not hold", () => {
    const grown = { "Landing.swift": ["Start again", "Begin"] };
    expect(verifyNativeContent(grown, grown, debt).join(" ")).toContain(
      'grew: "Begin" is listed more often than the base holds it',
    );
    const twice = { "Landing.swift": ["Start again", "Start again"] };
    expect(verifyNativeContent(twice, twice, debt).join(" ")).toContain('grew: "Start again"');
  });

  it("lets a file be renamed or split without growing the record", () => {
    const moved = { "Home.swift": ["Start again"] };
    expect(verifyNativeContent(moved, moved, debt)).toEqual([]);
  });

  it("counts the debt", () => {
    expect(debtSize({ a: ["x", "y"], b: ["z"] })).toBe(3);
  });
});
