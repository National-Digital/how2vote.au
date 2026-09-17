import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  nativeDeclarations,
  verifyThemeContract,
  verifyQuizContract,
  verifyStateKeys,
  webDeclarations,
} from "./check-native-state-keys.mjs";

const url = (p) => new URL(p, import.meta.url);
const WEB = readFileSync(url("../apps/web/src/lib/privacy/local-data.ts"), "utf8");
const NATIVE = readFileSync(url("../apps/mobile/ios/App/App/State/NativeState.swift"), "utf8");
const CONFIG = readFileSync(url("../apps/mobile/capacitor.config.ts"), "utf8");
const WEB_QUIZ = readFileSync(url("../apps/web/src/lib/quiz.svelte.ts"), "utf8");
const NATIVE_QUIZ = readFileSync(url("../apps/mobile/ios/App/App/State/QuizState.swift"), "utf8");
const LAUNCH = readFileSync(
  url("../apps/mobile/ios/App/App/Shell/MainViewController.swift"),
  "utf8",
);

const swift = ({
  marker = "how2vote:native-core:v1",
  prefixes = ["how2vote:quiz:"],
  prefix = "CapacitorStorage.",
} = {}) =>
  `static let preferencesPrefix = "${prefix}"\n` +
  `static let markerKey = "${marker}"\n` +
  `static let ownedPrefixes = [\n${prefixes.map((p) => `    "${p}",`).join("\n")}\n]`;

const ts = ({ prefixes = ["quiz:"] } = {}) =>
  'export const STORAGE_KEY_PREFIX = "how2vote:";\n' +
  "export const NATIVE_CORE_MARKER_KEY = `${STORAGE_KEY_PREFIX}native-core:v1`;\n" +
  "export const NATIVE_OWNED_KEY_PREFIXES: readonly string[] = [\n" +
  prefixes.map((p) => "  `${STORAGE_KEY_PREFIX}" + p + "`,").join("\n") +
  "\n];";

describe("webDeclarations", () => {
  it("expands the namespace template into concrete keys", () => {
    const { marker, prefixes } = webDeclarations(ts({ prefixes: ["quiz:", "saved:"] }));
    expect(marker).toBe("how2vote:native-core:v1");
    expect(prefixes).toEqual(["how2vote:quiz:", "how2vote:saved:"]);
  });

  it("reads the committed source", () => {
    const { marker, prefixes } = webDeclarations(WEB);
    expect(marker).toBe("how2vote:native-core:v1");
    expect(prefixes).toContain("how2vote:quiz:");
  });
});

describe("nativeDeclarations", () => {
  it("reads the committed Swift", () => {
    const { marker, prefixes, preferencesPrefix } = nativeDeclarations(NATIVE);
    expect(marker).toBe("how2vote:native-core:v1");
    expect(prefixes).toContain("how2vote:quiz:");
    expect(preferencesPrefix).toBe("CapacitorStorage.");
  });
});

describe("verifyStateKeys", () => {
  const check = (over = {}) =>
    verifyStateKeys({
      web: ts(),
      native: swift(),
      capacitorConfig: "",
      launch: "NativeState.claimOwnership()",
      ...over,
    });

  it("passes when both sides agree", () => {
    expect(check()).toEqual({ ok: true, errors: [] });
  });

  it("passes for the committed sources", () => {
    expect(
      verifyStateKeys({ web: WEB, native: NATIVE, capacitorConfig: CONFIG, launch: LAUNCH }),
    ).toEqual({
      ok: true,
      errors: [],
    });
  });

  // A marker that differs by a character means the mirror never stands down, and native state is
  // pruned as orphans with nothing reporting it.
  it("catches a drifted ownership marker", () => {
    const result = check({ native: swift({ marker: "how2vote:native-core:v2" }) });
    expect(result.errors.join("\n")).toMatch(/ownership marker differs/);
  });

  it("catches a prefix the native core claims and the web still mirrors", () => {
    const result = check({ native: swift({ prefixes: ["how2vote:quiz:", "how2vote:consent:"] }) });
    expect(result.errors.join("\n")).toMatch(/two writers on one key/);
  });

  it("catches a prefix the web cedes and the native core never claims", () => {
    const result = check({ web: ts({ prefixes: ["quiz:", "saved:"] }) });
    expect(result.errors.join("\n")).toMatch(/no writer and no eviction protection/);
  });

  // The unsweepable-store trap: a native write outside the plugin's namespace is invisible to the
  // data wipe, which the product boundary forbids.
  it("catches a Preferences namespace the plugin does not use", () => {
    const result = check({ native: swift({ prefix: "Wrong." }) });
    expect(result.errors.join("\n")).toMatch(/invisible to the WebView/);
  });

  it("follows a group configured in capacitor.config.ts", () => {
    const configured = 'plugins: { Preferences: { group: "How2VoteStore" } }';
    expect(check({ capacitorConfig: configured }).errors.join("\n")).toMatch(/How2VoteStore\./);
    expect(
      check({ native: swift({ prefix: "How2VoteStore." }), capacitorConfig: configured }).ok,
    ).toBe(true);
  });

  it("fails closed when either side declares nothing", () => {
    expect(verifyStateKeys({ web: "", native: "", capacitorConfig: "", launch: "" }).ok).toBe(
      false,
    );
  });
});

describe("verifyQuizContract", () => {
  it("passes for the committed sources", () => {
    expect(verifyQuizContract(WEB_QUIZ, NATIVE_QUIZ)).toEqual([]);
  });

  it("catches a drifted per-election key prefix", () => {
    const drifted = NATIVE_QUIZ.replace("how2vote:quiz:v2:", "how2vote:quiz:v3:");
    expect(verifyQuizContract(WEB_QUIZ, drifted).join("\n")).toMatch(/key prefix differs/);
  });

  // One side offering to resume progress the other has already discarded reads as data loss.
  it("catches a resume window that differs", () => {
    const drifted = NATIVE_QUIZ.replace(
      "maxAgeMilliseconds: Int64 = 30 * 24 * 60 * 60 * 1000",
      "maxAgeMilliseconds: Int64 = 14 * 24 * 60 * 60 * 1000",
    );
    expect(verifyQuizContract(WEB_QUIZ, drifted).join("\n")).toMatch(/resume window differs/);
  });

  // JSON has no schema: a renamed field is undetectable at runtime and simply loses the value.
  it("catches a renamed field in the persisted record", () => {
    const drifted = NATIVE_QUIZ.replace("var questionIds: [Int]", "var questionIDs: [Int]");
    const joined = verifyQuizContract(WEB_QUIZ, drifted).join("\n");
    expect(joined).toMatch(/the web persists "questionIds", which the native record omits/);
  });

  // The age-first gate (docs/adr/0011) precedes any quiz state on every channel.
  it("catches a native save path that does not fail closed on the 18+ declaration", () => {
    const bypass = NATIVE_QUIZ.replace(
      "guard eligibleThisSession else { throw QuizError.notEligible }",
      "",
    );
    expect(verifyQuizContract(WEB_QUIZ, bypass).join("\n")).toMatch(/bypass the age-first gate/);
  });

  it("fails closed when either side is unreadable", () => {
    expect(verifyQuizContract("", "").length).toBeGreaterThan(0);
  });
});

describe("the ownership claim", () => {
  // A claim that is declared and never made looks perfect until the screen is closed: every native
  // write is refused, the answers live in memory, and nothing anywhere reports it.
  it("fails when nothing claims ownership at launch", () => {
    const errors = verifyStateKeys({
      web: WEB,
      native: NATIVE,
      capacitorConfig: CONFIG,
      launch: "override func capacitorDidLoad() {}",
    }).errors.join(" ");
    expect(errors).toContain("nothing calls NativeState.claimOwnership()");
  });

  it("passes on the committed launch path", () => {
    expect(
      verifyStateKeys({ web: WEB, native: NATIVE, capacitorConfig: CONFIG, launch: LAUNCH }).errors,
    ).toEqual([]);
  });
});

describe("verifyThemeContract", () => {
  const WEB_THEME = readFileSync(url("../apps/web/src/lib/theme.svelte.ts"), "utf8");
  const NATIVE_THEME = readFileSync(
    url("../apps/mobile/ios/App/App/State/NativeTheme.swift"),
    "utf8",
  );

  it("passes on the committed sources", () => {
    expect(verifyThemeContract(WEB_THEME, NATIVE_THEME)).toEqual([]);
  });

  // A key that differs reads nothing and falls back to the system appearance, which is
  // indistinguishable from a preference that simply did not stick.
  it("catches a drifted key", () => {
    const drifted = NATIVE_THEME.replace('preferenceKey = "how2vote:theme"', 'preferenceKey = "x"');
    expect(verifyThemeContract(WEB_THEME, drifted).join(" ")).toContain("theme key differs");
  });

  it("catches a value one side does not know", () => {
    const narrowed = NATIVE_THEME.replace("        case system\n", "");
    expect(verifyThemeContract(WEB_THEME, narrowed).join(" ")).toContain("theme values differ");
  });

  // The preference is the WebView's key: two writers on one key is what the split prevents.
  it("catches the native side writing a key it does not own", () => {
    const writes = `${NATIVE_THEME}\nlet x = try NativeState.set(v, forKey: Self.preferenceKey)`;
    expect(verifyThemeContract(WEB_THEME, writes).join(" ")).toContain("two writers on one key");
  });

  it("fails closed when either side is unreadable", () => {
    expect(verifyThemeContract("", NATIVE_THEME).join(" ")).toContain("no theme KEY");
    expect(verifyThemeContract(WEB_THEME, "").join(" ")).toContain("no preferenceKey");
  });
});
