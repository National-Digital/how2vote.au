import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { extractRunScripts, verdict } from "./check-supply-chain.mjs";
import { classifyRef } from "./check-action-pinning.mjs";
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
    "      - run: pnpm install --frozen-lockfile",
  ].join("\n"),
};

/** A step that fetches a tool, wrapped so only its `run:` body varies. */
const runStep = (script) => ({
  path: ".github/workflows/x.yml",
  text: [
    "jobs:",
    "  a:",
    "    steps:",
    "      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7",
    "      - run: |",
    ...script.split("\n").map((l) => `          ${l}`),
  ].join("\n"),
});

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
    expect(hasError(verdict({ ...ok(), workflows: [wf] }), "mutable")).toBe(true);
  });

  it("fails an action pinned to a branch", () => {
    const wf = { path: ".github/workflows/x.yml", text: "      - uses: some/action@main" };
    expect(hasError(verdict({ ...ok(), workflows: [wf] }), "mutable")).toBe(true);
  });

  it("fails an unversioned action ref", () => {
    const wf = { path: ".github/workflows/x.yml", text: "      - uses: docker://alpine" };
    expect(hasError(verdict({ ...ok(), workflows: [wf] }), "not pinned")).toBe(true);
  });

  it("exempts local ./ actions", () => {
    const wf = {
      path: ".github/workflows/x.yml",
      text: ["      - uses: ./.github/actions/foo", "      - run: echo ok"].join("\n"),
    };
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

describe("verdict — shares one pinning rule with check-action-pinning", () => {
  it("accepts what the rule accepts", () => {
    for (const ref of [
      `docker://alpine@sha256:${"a".repeat(64)}`,
      "../.github/actions/foo",
      `actions/checkout@${"b".repeat(40)}`,
    ]) {
      const wf = {
        path: ".github/workflows/x.yml",
        text: [`      - uses: ${ref}`, "      - run: echo ok"].join("\n"),
      };
      const res = verdict({ ...ok(), workflows: [wf] });
      expect(res.errors, `${ref} should be accepted`).toEqual([]);
      expect(classifyRef(ref).ok).toBe(true);
    }
  });

  it("rejects what the rule rejects", () => {
    for (const ref of ["actions/checkout@v4", "some/action@main", "docker://alpine"]) {
      const wf = {
        path: ".github/workflows/x.yml",
        text: [`      - uses: ${ref}`, "      - run: echo ok"].join("\n"),
      };
      expect(verdict({ ...ok(), workflows: [wf] }).ok, `${ref} should be rejected`).toBe(false);
      expect(classifyRef(ref).ok).toBe(false);
    }
  });
});

describe("verdict — tool provisioning", () => {
  it("fails an unpinned pip install", () => {
    const res = verdict({ ...ok(), workflows: [runStep("pip install --quiet apksigcopier")] });
    expect(hasError(res, 'pip installs "apksigcopier" unpinned')).toBe(true);
  });

  it("accepts a pip install pinned by version and digest", () => {
    const res = verdict({
      ...ok(),
      workflows: [
        runStep(
          [
            "cat > req.txt <<'REQ'",
            "apksigcopier==1.1.1 --hash=sha256:0834bb7d",
            "REQ",
            "pip install --quiet --require-hashes -r req.txt",
          ].join("\n"),
        ),
      ],
    });
    expect(res.errors).toEqual([]);
  });

  it("fails a requirements file installed outside hash-checking mode", () => {
    const res = verdict({ ...ok(), workflows: [runStep("pip install -r requirements.txt")] });
    expect(hasError(res, "without --require-hashes")).toBe(true);
  });

  it("fails an unpinned global npm install", () => {
    const res = verdict({ ...ok(), workflows: [runStep("npm install -g pnpm")] });
    expect(hasError(res, 'npm installs "pnpm" unpinned')).toBe(true);
  });

  it("accepts a version-pinned global npm install", () => {
    const res = verdict({ ...ok(), workflows: [runStep("npm install -g pnpm@11.12.0")] });
    expect(res.errors).toEqual([]);
  });

  it("reads only the package spec of a pnpm dlx, not the tool's own arguments", () => {
    const pinned = verdict({ ...ok(), workflows: [runStep("pnpm dlx @lhci/cli@0.14.0 autorun")] });
    expect(pinned.errors).toEqual([]);
    const loose = verdict({ ...ok(), workflows: [runStep("pnpm dlx @lhci/cli autorun")] });
    expect(hasError(loose, 'installs "@lhci/cli" unpinned')).toBe(true);
  });

  // Both writing forms of each tool, including the first-argument cases (`curl -O url`).
  it.each([
    ["bare wget, which writes a file by default", "wget https://example.com/t.tgz"],
    ["wget -O <file>", "wget -O t.tgz https://example.com/t.tgz"],
    ["curl -O as the first argument", "curl -O https://example.com/t.tgz"],
    ["curl -o as the first argument", "curl -o t.tgz https://example.com/t.tgz"],
    ["curl with flags before -o", "curl -sSfL -o t.tgz https://example.com/t.tgz"],
    ["curl --output=<file>", "curl --output=t.tgz https://example.com/t.tgz"],
  ])("fails %s", (_label, script) => {
    expect(hasError(verdict({ ...ok(), workflows: [runStep(script)] }), "no digest check")).toBe(
      true,
    );
  });

  it.each([
    ["a response piped to stdout", "curl -sS https://api.example.com/x | jq ."],
    ["curl -o /dev/null", "curl -sS -o /dev/null https://example.com"],
    ["curl -o - (stdout)", "curl -sS -o - https://example.com | grep x"],
    ["wget -O - (stdout)", "wget -O - https://example.com | grep x"],
    ["wget -qO- (stdout)", "wget -qO- https://example.com | grep x"],
  ])("accepts %s — nothing persists to be run later", (_label, script) => {
    expect(verdict({ ...ok(), workflows: [runStep(script)] }).errors).toEqual([]);
  });

  it("fails a download whose digest is never checked", () => {
    const res = verdict({
      ...ok(),
      workflows: [
        runStep('curl -sSfL -o tool.tgz "https://example.com/tool.tgz"\ntar -xzf tool.tgz'),
      ],
    });
    expect(hasError(res, "no digest check")).toBe(true);
  });

  it("accepts a download verified against a committed checksum", () => {
    const res = verdict({
      ...ok(),
      workflows: [
        runStep(
          [
            "SHA256=abc123",
            'curl -sSfL -o tool.tgz "https://example.com/tool.tgz"',
            'echo "${SHA256}  tool.tgz" | sha256sum --check --quiet',
          ].join("\n"),
        ),
      ],
    });
    expect(res.errors).toEqual([]);
  });

  it("ignores commands that only appear in comments", () => {
    const res = verdict({
      ...ok(),
      workflows: [runStep("# pip install apksigcopier\necho hello")],
    });
    expect(res.errors).toEqual([]);
  });

  it("fails closed when a workflow set has no run steps at all", () => {
    const wf = {
      path: ".github/workflows/x.yml",
      text: "      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
    };
    expect(hasError(verdict({ ...ok(), workflows: [wf] }), "no run steps")).toBe(true);
  });
});

describe("extractRunScripts", () => {
  it("collects a block scalar and stops at the next key", () => {
    const text = ["      - run: |", "          one", "          two", "      - uses: x@sha"].join(
      "\n",
    );
    expect(extractRunScripts(text)).toEqual([{ line: 1, script: "one\ntwo" }]);
  });

  it("collects a one-line run", () => {
    expect(extractRunScripts("      - run: corepack enable")).toEqual([
      { line: 1, script: "corepack enable" },
    ]);
  });
});
