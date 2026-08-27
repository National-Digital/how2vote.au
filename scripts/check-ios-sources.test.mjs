import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  deploymentTargetProblems,
  objectId,
  register,
  swiftSources,
  unregistered,
  harnessNameCollisions,
} from "./check-ios-sources.mjs";

const url = (p) => new URL(p, import.meta.url);
const PROJECT = readFileSync(url("../apps/mobile/ios/App/App.xcodeproj/project.pbxproj"), "utf8");

/** A directory listing stub: a map of prefix to entries, directories suffixed with "/". */
const listing = (tree) => (prefix) => tree[prefix] ?? [];

describe("swiftSources", () => {
  it("finds Swift files at the top level and in subdirectories", () => {
    const files = swiftSources(
      listing({
        "": ["AppDelegate.swift", "Generated/", "Info.plist"],
        "Generated/": ["LegalCopy.swift"],
      }),
    );
    expect(files).toEqual(["AppDelegate.swift", "Generated/LegalCopy.swift"]);
  });

  it("returns a sorted list, so the project file's ordering is stable", () => {
    const files = swiftSources(listing({ "": ["Zebra.swift", "Alpha.swift"] }));
    expect(files).toEqual(["Alpha.swift", "Zebra.swift"]);
  });

  it("ignores non-Swift files", () => {
    expect(
      swiftSources(listing({ "": ["Info.plist", "Assets.xcassets/"], "Assets.xcassets/": [] })),
    ).toEqual([]);
  });
});

describe("objectId", () => {
  it("is a 24-character uppercase hex identifier, as Xcode uses", () => {
    expect(objectId("A.swift", "fileRef")).toMatch(/^[0-9A-F]{24}$/);
  });

  // Random ids would make every run rewrite the project file and would collide across branches.
  it("is deterministic for the same path and kind", () => {
    expect(objectId("A.swift", "fileRef")).toBe(objectId("A.swift", "fileRef"));
  });

  it("distinguishes the file reference from the build file", () => {
    expect(objectId("A.swift", "fileRef")).not.toBe(objectId("A.swift", "buildFile"));
  });

  it("distinguishes different paths", () => {
    expect(objectId("A.swift", "fileRef")).not.toBe(objectId("B/A.swift", "fileRef"));
  });
});

describe("unregistered", () => {
  it("reports a file absent from the project as missing all four entries", () => {
    const [problem] = unregistered(PROJECT, ["Engine/Nowhere.swift"]);
    expect(problem.missing).toEqual([
      "file reference",
      "build file",
      "group membership",
      "sources build phase",
    ]);
  });

  it("accepts the committed project's own sources", () => {
    expect(unregistered(PROJECT, ["AppDelegate.swift", "Generated/LegalCopy.swift"])).toEqual([]);
  });

  // A hand-edit that adds the file reference but forgets the build phase produces a file that is
  // visible in Xcode and still not compiled — the exact silent failure this guard exists for.
  it("catches a partial registration", () => {
    const broken = PROJECT.replace(
      `\t\t\t\t${objectId("Generated/LegalCopy.swift", "buildFile")} /* LegalCopy.swift in Sources */,\n`,
      "",
    );
    const [problem] = unregistered(broken, ["Generated/LegalCopy.swift"]);
    expect(problem.missing).toEqual(["sources build phase"]);
  });
});

describe("register", () => {
  const registered = register(PROJECT, ["Engine/JSCEngine.swift"]);

  it("adds all four entries", () => {
    expect(unregistered(registered, ["Engine/JSCEngine.swift"])).toEqual([]);
  });

  it("names a nested file by its basename, not its path", () => {
    expect(registered).toContain("name = JSCEngine.swift; path = Engine/JSCEngine.swift;");
  });

  it("leaves the project structurally balanced", () => {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"]*"/g, '""');
    const t = strip(registered);
    expect(t.split("{").length).toBe(t.split("}").length);
    expect(t.split("(").length).toBe(t.split(")").length);
  });

  it("is idempotent — registering twice changes nothing further", () => {
    expect(register(registered, [])).toBe(registered);
  });

  it("never rewrites AppDelegate.swift, which carries Capacitor's own identifiers", () => {
    expect(register(PROJECT, ["AppDelegate.swift"])).toBe(PROJECT);
  });
});

describe("deploymentTargetProblems", () => {
  const ADR = readFileSync(url("../docs/adr/0018-native-ios-core.md"), "utf8");

  it("passes on the committed project", () => {
    expect(deploymentTargetProblems(PROJECT, ADR)).toEqual([]);
  });

  // The floor that matters is the LOWEST one built, so a configuration left behind has to fail even
  // when the others were raised.
  it("catches one build configuration left behind", () => {
    const behind = PROJECT.replace(
      "IPHONEOS_DEPLOYMENT_TARGET = 17.0;",
      "IPHONEOS_DEPLOYMENT_TARGET = 15.0;",
    );
    expect(deploymentTargetProblems(behind, ADR).join(" ")).toContain("builds against iOS 15.0");
  });

  it("catches a project that trails a raised declaration", () => {
    const raised = ADR.replace("Minimum target is **iOS 17**", "Minimum target is **iOS 18**");
    expect(deploymentTargetProblems(PROJECT, raised).join(" ")).toContain("declares iOS 18");
  });

  it("fails closed when either side stops declaring one", () => {
    expect(deploymentTargetProblems(PROJECT, "").join(" ")).toContain("no longer declares");
    expect(deploymentTargetProblems("", ADR).join(" ")).toContain("sets no");
  });
});

describe("harnessNameCollisions", () => {
  // swiftc distinguishes private declarations by filename, so a harness compiling app sources
  // beside its own cannot share a basename with any of them. The Xcode build never sees it, so
  // the collision surfaces only on a macOS runner, minutes into the job.
  it("reports a harness that shares a basename with an app source", () => {
    const found = harnessNameCollisions(["Generated/BrandMark.swift"], ["BrandMark.swift"]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("filename used twice");
  });

  it("passes when every harness name is its own", () => {
    expect(
      harnessNameCollisions(
        ["Generated/BrandMark.swift", "Model/StateMap.swift"],
        ["BrandParity.swift", "MapLogic.swift"],
      ),
    ).toEqual([]);
  });

  it("compares basenames, not paths", () => {
    expect(harnessNameCollisions(["Design/SVGPath.swift"], ["a/b/SVGPath.swift"])).toHaveLength(1);
  });
});
