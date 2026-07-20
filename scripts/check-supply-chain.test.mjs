import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict } from "./check-supply-chain.mjs";
import { buildSbom, parseLockPackages } from "./build-sbom.mjs";

const LOCK = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
const REAL_SBOM = buildSbom({ lockText: LOCK });
const SOURCE = "https://github.com/National-Digital/how2vote.au";
// buildSbom requires a supported lockfileVersion header; synthetic fixtures declare v9.
const V9 = "lockfileVersion: '9.0'\n";

const PINNED_WORKFLOW = {
  path: ".github/workflows/ci.yml",
  text: [
    "jobs:",
    "  build:",
    "    steps:",
    "      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7",
    "      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6",
    "      - uses: ./.github/actions/local-thing",
  ].join("\n"),
};

const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));
const ok = () => ({ workflows: [PINNED_WORKFLOW], sbom: REAL_SBOM, sourceRepoUrl: SOURCE });

describe("build-sbom — lockfile parse", () => {
  it("parses the real lockfile into many components", () => {
    const pkgs = parseLockPackages(LOCK);
    expect(pkgs.length).toBeGreaterThan(100);
    expect(REAL_SBOM.bomFormat).toBe("CycloneDX");
    expect(REAL_SBOM.specVersion).toBe("1.5");
  });

  it("splits scoped names on the last @ and builds a purl", () => {
    const pkgs = parseLockPackages(
      ["packages:", "", "  '@babel/core@7.29.7':", "    resolution: {integrity: sha512-x==}"].join(
        "\n",
      ),
    );
    expect(pkgs).toEqual([{ name: "@babel/core", version: "7.29.7" }]);
    const sbom = buildSbom({
      lockText: V9 + ["packages:", "  '@babel/core@7.29.7':", "  acorn@8.17.0:"].join("\n"),
    });
    expect(sbom.components).toEqual([
      {
        type: "library",
        name: "@babel/core",
        version: "7.29.7",
        // purl spec: the scope "@" is percent-encoded (%40); the "/" and "@version" stay literal.
        purl: "pkg:npm/%40babel/core@7.29.7",
      },
      { type: "library", name: "acorn", version: "8.17.0", purl: "pkg:npm/acorn@8.17.0" },
    ]);
  });

  it("is deterministic — same lock yields identical output", () => {
    expect(JSON.stringify(buildSbom({ lockText: LOCK }))).toBe(JSON.stringify(REAL_SBOM));
  });

  it("de-duplicates and sorts components", () => {
    const sbom = buildSbom({
      lockText: V9 + ["packages:", "  zzz@1.0.0:", "  aaa@1.0.0:", "  aaa@1.0.0:"].join("\n"),
    });
    expect(sbom.components.map((c) => c.name)).toEqual(["aaa", "zzz"]);
  });

  it("fails closed on an unsupported/absent lockfileVersion", () => {
    // A format bump (peer-suffix keys) would misparse silently — refuse anything but v9.
    expect(() =>
      buildSbom({ lockText: "lockfileVersion: '6.0'\npackages:\n  foo@1.0.0:" }),
    ).toThrow(/unsupported pnpm lockfileVersion/);
    expect(() => buildSbom({ lockText: "packages:\n  foo@1.0.0:" })).toThrow(
      /unsupported pnpm lockfileVersion/,
    );
  });
});

describe("verdict — passes on the real inputs", () => {
  it("is ok for pinned workflows + real SBOM + source URL", () => {
    const res = verdict(ok());
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe("verdict — action pinning", () => {
  it("fails an action pinned to a tag", () => {
    const wf = { path: ".github/workflows/x.yml", text: "      - uses: actions/checkout@v4" };
    expect(hasError(verdict({ ...ok(), workflows: [wf] }), "40-hex commit SHA")).toBe(true);
  });

  it("fails an action pinned to a branch", () => {
    const wf = { path: ".github/workflows/x.yml", text: "      - uses: some/action@main" };
    expect(hasError(verdict({ ...ok(), workflows: [wf] }), "40-hex commit SHA")).toBe(true);
  });

  it("fails an unversioned action ref", () => {
    const wf = { path: ".github/workflows/x.yml", text: "      - uses: docker://alpine" };
    expect(hasError(verdict({ ...ok(), workflows: [wf] }), "not pinned")).toBe(true);
  });

  it("exempts local ./ actions", () => {
    const wf = { path: ".github/workflows/x.yml", text: "      - uses: ./.github/actions/foo" };
    expect(verdict({ ...ok(), workflows: [wf] }).ok).toBe(true);
  });
});

describe("verdict — SBOM validity", () => {
  it("fails a non-CycloneDX SBOM", () => {
    expect(
      hasError(verdict({ ...ok(), sbom: { bomFormat: "SPDX", components: [{}] } }), "CycloneDX"),
    ).toBe(true);
  });

  it("fails an empty component list", () => {
    expect(
      hasError(verdict({ ...ok(), sbom: { bomFormat: "CycloneDX", components: [] } }), "non-empty"),
    ).toBe(true);
  });

  it("fails a missing SBOM (fail-closed)", () => {
    expect(hasError(verdict({ ...ok(), sbom: null }), "not an object")).toBe(true);
  });
});

describe("verdict — deployed-source link", () => {
  it("fails a missing source URL", () => {
    expect(hasError(verdict({ ...ok(), sourceRepoUrl: "" }), "missing")).toBe(true);
  });

  it("fails a non-github / non-https URL", () => {
    expect(hasError(verdict({ ...ok(), sourceRepoUrl: "http://example.com" }), "github.com")).toBe(
      true,
    );
  });
});

describe("verdict — fail-closed on missing workflows", () => {
  it("fails when workflows is absent", () => {
    expect(hasError(verdict({ sbom: REAL_SBOM, sourceRepoUrl: SOURCE }), "none found")).toBe(true);
  });

  it("fails when workflows is an empty array (gather found nothing)", () => {
    expect(
      hasError(verdict({ workflows: [], sbom: REAL_SBOM, sourceRepoUrl: SOURCE }), "none found"),
    ).toBe(true);
  });

  it("fails when workflows exist but contain no action references", () => {
    const wf = {
      path: ".github/workflows/x.yml",
      text: "name: x\non: push\njobs:\n  a:\n    steps: []",
    };
    expect(
      hasError(
        verdict({ workflows: [wf], sbom: REAL_SBOM, sourceRepoUrl: SOURCE }),
        "no action references",
      ),
    ).toBe(true);
  });
});
