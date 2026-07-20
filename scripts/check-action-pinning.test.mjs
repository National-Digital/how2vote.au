import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { usesRef, classifyRef, verdict } from "./check-action-pinning.mjs";

const SHA = "9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0"; // a real 40-hex commit sha
const SHA2 = "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e";

describe("usesRef — extracting the reference from a line", () => {
  it("reads a list-item uses with a trailing version comment", () => {
    expect(usesRef(`      - uses: actions/checkout@${SHA} # v7`)).toBe(`actions/checkout@${SHA}`);
  });
  it("reads a mapping-form uses", () => {
    expect(usesRef(`        uses: github/codeql-action/init@${SHA}`)).toBe(
      `github/codeql-action/init@${SHA}`,
    );
  });
  it("strips surrounding quotes", () => {
    expect(usesRef(`      - uses: "actions/checkout@${SHA}"`)).toBe(`actions/checkout@${SHA}`);
  });
  it("returns null for a non-uses line", () => {
    expect(usesRef("      - run: pnpm install")).toBeNull();
    expect(usesRef("        with:")).toBeNull();
  });
});

describe("classifyRef — pinning policy", () => {
  it("accepts a full-SHA commit pin", () => {
    expect(classifyRef(`actions/checkout@${SHA}`).ok).toBe(true);
  });
  it("accepts a full-SHA pin on an action subpath and a reusable workflow", () => {
    expect(classifyRef(`github/codeql-action/init@${SHA}`).ok).toBe(true);
    expect(classifyRef(`owner/repo/.github/workflows/x.yml@${SHA}`).ok).toBe(true);
  });
  it("accepts a local composite action", () => {
    expect(classifyRef("./.github/actions/setup").ok).toBe(true);
  });
  it("accepts a digest-pinned docker image", () => {
    expect(classifyRef(`docker://alpine@sha256:${"a".repeat(64)}`).ok).toBe(true);
  });

  it("REJECTS a version tag", () => {
    const v = classifyRef("actions/checkout@v4");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/mutable/);
  });
  it("REJECTS a branch pin", () => {
    expect(classifyRef("actions/checkout@main").ok).toBe(false);
  });
  it("REJECTS a short sha", () => {
    expect(classifyRef(`actions/checkout@${SHA.slice(0, 8)}`).ok).toBe(false);
  });
  it("REJECTS a reference with no pin", () => {
    const v = classifyRef("actions/checkout");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/no version pin/);
  });
  it("REJECTS an expression-built reference", () => {
    expect(classifyRef("${{ matrix.action }}@v4").ok).toBe(false);
  });
  it("REJECTS a docker image without a digest", () => {
    expect(classifyRef("docker://alpine:3.19").ok).toBe(false);
  });
});

describe("scanText / verdict", () => {
  const clean = `jobs:
  build:
    steps:
      - uses: actions/checkout@${SHA} # v7
      - uses: actions/setup-node@${SHA2} # v6
      - run: pnpm build
      - uses: ./.github/actions/local`;

  it("passes a fully pinned workflow", () => {
    expect(verdict([{ path: "ci.yml", text: clean }]).ok).toBe(true);
  });

  it("flags each unpinned reference with its line number", () => {
    const dirty = `jobs:
  build:
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@${SHA2}
      - uses: some/action@main`;
    const res = verdict([{ path: "ci.yml", text: dirty }]);
    expect(res.ok).toBe(false);
    expect(res.violations).toHaveLength(2);
    expect(res.violations[0]).toMatchObject({
      file: "ci.yml",
      line: 4,
      ref: "actions/checkout@v7",
    });
    expect(res.violations[1]).toMatchObject({ line: 6, ref: "some/action@main" });
  });
});

describe("the real committed workflows", () => {
  it("every uses: in .github/workflows is pinned", () => {
    const dir = new URL("../.github/workflows/", import.meta.url);
    const files = readdirSync(dir)
      .filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"))
      .map((name) => ({
        path: `.github/workflows/${name}`,
        text: readFileSync(new URL(name, dir), "utf8"),
      }));
    // Guard against an empty glob silently passing.
    expect(files.length).toBeGreaterThan(0);
    const res = verdict(files);
    expect(res.violations).toEqual([]);
  });
});
