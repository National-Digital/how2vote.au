import { describe, expect, it } from "vitest";
import { runInContext } from "node:vm";
import {
  checkBridgeParity,
  checkHarnessCoverage,
  inspectBundle,
  jscLikeContext,
  loadBundle,
} from "./check-engine-bundle.mjs";

/** A minimal bundle in the shape vite's IIFE build emits. */
const bundle = (body = "") =>
  `var How2VoteEngine = (function(exports) {\n"use strict";\n${body}\nexports.ping = function(){return "pong";};\nreturn exports;\n})({});`;

describe("jscLikeContext", () => {
  const evaluate = (expr) => runInContext(expr, jscLikeContext());

  it("provides the ECMAScript intrinsics the engine needs", () => {
    expect(evaluate("JSON.stringify({a: 1})")).toBe('{"a":1}');
    expect(evaluate("new Map([[1, 2]]).get(1)")).toBe(2);
    expect(evaluate('[3, 1, 2].sort().join("")')).toBe("123");
  });

  // Feature detection must keep working: bundled libraries probe for a browser constantly, and
  // failing them would reject correct code. Only *depending* on a browser is the defect.
  it('answers a typeof guard with "undefined" rather than throwing', () => {
    expect(evaluate("typeof document")).toBe("undefined");
    expect(evaluate("typeof navigator")).toBe("undefined");
    expect(evaluate('typeof globalThis === "object" && "document" in globalThis')).toBe(false);
  });

  it("throws on unguarded browser access, as the device would", () => {
    expect(() => evaluate("document.body")).toThrow(/document is not defined/);
  });

  // Regression: copying the host's globalThis into the sandbox once left `process` and `fetch`
  // reachable through a property lookup, so a bundle depending on either passed and then failed
  // on device.
  it("does not leak host globals through globalThis", () => {
    expect(evaluate("globalThis.process === undefined")).toBe(true);
    expect(evaluate("globalThis.fetch === undefined")).toBe(true);
    expect(evaluate("globalThis.require === undefined")).toBe(true);
  });

  it("has no console, which a bare JSContext also lacks", () => {
    expect(evaluate("typeof console")).toBe("undefined");
  });
});

describe("inspectBundle", () => {
  it("accepts a self-contained IIFE bundle", () => {
    expect(inspectBundle(bundle())).toEqual([]);
  });

  it("fails closed on an empty or unreadable bundle", () => {
    expect(inspectBundle("")).toHaveLength(1);
    expect(inspectBundle(undefined)).toHaveLength(1);
  });

  it.each([
    ['import { x } from "y";', /ES import/],
    ["const m = import('./x.js');", /dynamic import/],
    ["export const x = 1;", /ES export/],
    ['const fs = require("node:fs");', /CommonJS require/],
  ])("rejects a bundle needing a module loader (%s)", (snippet, expected) => {
    expect(inspectBundle(`${snippet}\n${bundle()}`).join("\n")).toMatch(expected);
  });

  it("rejects a bundle that never assigns the expected global", () => {
    expect(inspectBundle("(function(){})();").join("\n")).toMatch(/does not assign/);
  });
});

describe("loadBundle", () => {
  it("returns the bundle's exported API", () => {
    expect(loadBundle(bundle()).ping()).toBe("pong");
  });

  it("propagates a browser dependency as a failure", () => {
    expect(() => loadBundle(bundle("var probe = window.location;"))).toThrow(
      /window is not defined/,
    );
  });

  it("propagates a stray console call as a failure", () => {
    expect(() => loadBundle(bundle('console.log("debug");'))).toThrow(/console is not defined/);
  });

  it("rejects a bundle whose global is not an object", () => {
    expect(() => loadBundle("var How2VoteEngine = 42;")).toThrow(/is not an object/);
  });
});

describe("checkBridgeParity", () => {
  const api = { NATIVE_API_VERSION: 1, card: () => {}, share: () => {} };
  const swift = (body) => `static let expectedAPIVersion = 1\n${body}`;
  const calls = (...names) => names.map((n) => `try call("${n}", [])`).join("\n");

  it("passes when the Swift calls exactly what the bundle exports", () => {
    expect(checkBridgeParity(api, swift(calls("card", "share")))).toEqual([]);
  });

  // A rename on the TypeScript side compiles fine on both sides and throws only at runtime.
  it("catches a Swift call the bundle does not export", () => {
    expect(checkBridgeParity(api, swift(calls("card", "shar"))).join("\n")).toMatch(
      /calls `shar`, which the bundle does not export/,
    );
  });

  it("catches an engine capability the Swift never exposes", () => {
    expect(checkBridgeParity(api, swift(calls("card"))).join("\n")).toMatch(
      /exports `share` but JSCEngine.swift never calls it/,
    );
  });

  it("catches a version the bundle does not ship", () => {
    const drifted = "static let expectedAPIVersion = 2\n" + calls("card", "share");
    expect(checkBridgeParity(api, drifted).join("\n")).toMatch(/expects API version 2/);
  });

  it("catches the staleness check being removed altogether", () => {
    expect(checkBridgeParity(api, calls("card", "share")).join("\n")).toMatch(
      /does not declare expectedAPIVersion/,
    );
  });

  it("ignores non-function exports such as the version constant", () => {
    expect(checkBridgeParity(api, swift(calls("card", "share")))).toEqual([]);
  });
});

describe("checkHarnessCoverage", () => {
  const js = 'golden("card-2025-bean.json"); golden("ballot-paper-2025-act.json");';

  it("passes when both harnesses run the same artifacts", () => {
    const swift = '("2025", "card-2025-bean.json") "\\(dir)/ballot-paper-2025-act.json"';
    expect(checkHarnessCoverage(js, swift)).toEqual([]);
  });

  it("catches an artifact never exercised on the engine that ships", () => {
    expect(checkHarnessCoverage(js, '"card-2025-bean.json"').join("\n")).toMatch(
      /ballot-paper-2025-act\.json is checked on Node but not by the JavaScriptCore harness/,
    );
  });

  it("catches an artifact checked only on device", () => {
    const swift = '"card-2025-bean.json" "ballot-paper-2025-act.json" "card-2019-bean.json"';
    expect(checkHarnessCoverage(js, swift).join("\n")).toMatch(
      /card-2019-bean\.json is checked by/,
    );
  });

  // Datasets are inputs, not approved artifacts, and appear in both files as ordinary paths.
  it("ignores dataset inputs", () => {
    expect(checkHarnessCoverage('"data/dist/2025/dataset.json"', "")).toEqual([]);
  });
});
