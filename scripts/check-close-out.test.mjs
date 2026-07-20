import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import {
  verdict,
  extractJobNames,
  findDuplicateMappingKeys,
  scriptArtefacts,
  isWired,
  parseIsoDate,
  GROUP_JOB_NAMES,
} from "./check-close-out.mjs";
import { CANONICAL_GROUPS } from "./check-control-register.mjs";

const rel = (p) => new URL(`../${p}`, import.meta.url);
const NOW = Date.parse("2026-07-16T00:00:00Z");
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

/** A minimal register that passes the base control-register guard AND close-out. */
function makeRegister(n = 31) {
  const controls = [];
  for (let i = 1; i <= n; i++) {
    controls.push({
      id: `control-${i}`,
      title: `Control ${i}`,
      inherent: 10,
      targetResidual: 5,
      ciGroups: ["Legal"],
      status: "partial",
      tests: [
        {
          id: `t-${i}`,
          type: "unit",
          owner: "eng",
          status: "passing",
          enforcedBy: "apps/web/src/x.test.ts",
        },
      ],
      evidence: [{ id: `EV-${i}`, description: "d", status: "not-required" }],
    });
  }
  return { schemaVersion: 1, updated: "2026-07-16", ciGroups: [...CANONICAL_GROUPS], controls };
}

function baseInput(overrides = {}) {
  const jobNames = [...Object.values(GROUP_JOB_NAMES), "Control register (fail-closed)"];
  const requiredChecks = {
    schemaVersion: 1,
    branch: "main",
    ciGroups: [...CANONICAL_GROUPS],
    requiredChecks: [...jobNames],
    bypasses: [],
    disclaimers: [],
  };
  return {
    register: makeRegister(),
    requiredChecks,
    jobNames,
    workflowText: "",
    duplicateKeys: [],
    existingScripts: new Set(),
    disclaimerHits: [],
    ...overrides,
  };
}

describe("pure helpers", () => {
  it("extracts every job name from the real compliance.yml", () => {
    const yaml = readFileSync(rel(".github/workflows/compliance.yml"), "utf8");
    const names = extractJobNames(yaml);
    expect(names).toContain("Control register (fail-closed)");
    expect(names).toContain("Close-out — control-register completeness + required-checks");
    for (const g of CANONICAL_GROUPS) expect(names).toContain(GROUP_JOB_NAMES[g]);
  });

  it("finds NO duplicate mapping keys in the real compliance.yml", () => {
    const yaml = readFileSync(rel(".github/workflows/compliance.yml"), "utf8");
    expect(findDuplicateMappingKeys(yaml)).toEqual([]);
  });

  it("catches a duplicate sibling key (the GitHub-rejects-the-workflow failure mode)", () => {
    const yaml = [
      "jobs:",
      "  a:",
      "    steps:",
      "      - uses: actions/upload-artifact@v7",
      "        with:",
      "          path: one",
      "          retention-days: 7",
      "          path: two",
    ].join("\n");
    const dups = findDuplicateMappingKeys(yaml);
    expect(dups.some((d) => d.key === "path")).toBe(true);
  });

  it("does not false-positive on a repeated key at a DIFFERENT level or in another step", () => {
    const yaml = [
      "jobs:",
      "  a:",
      "    steps:",
      "      - name: one",
      "        run: echo hi",
      "      - name: two",
      "        run: echo bye",
    ].join("\n");
    expect(findDuplicateMappingKeys(yaml)).toEqual([]);
  });

  it("does not treat block-scalar content as keys", () => {
    const yaml = [
      "jobs:",
      "  a:",
      "    steps:",
      "      - name: multi",
      "        run: |",
      "          echo: one",
      "          echo: two",
    ].join("\n");
    expect(findDuplicateMappingKeys(yaml)).toEqual([]);
  });

  it("extracts only scripts/*.mjs artefacts from free-text enforcedBy", () => {
    expect(scriptArtefacts("scripts/check-a.mjs + scripts/gen-b.mjs --flag (deploy.yml)")).toEqual([
      "scripts/check-a.mjs",
      "scripts/gen-b.mjs",
    ]);
    expect(scriptArtefacts("apps/web/src/x.test.ts")).toEqual([]);
    expect(scriptArtefacts("(none)")).toEqual([]);
  });

  it("treats a guard as wired only when referenced; a .test.mjs is wired via pnpm test", () => {
    expect(isWired("scripts/check-a.mjs", "run: node scripts/check-a.mjs")).toBe(true);
    expect(isWired("scripts/check-a.mjs", "nothing here")).toBe(false);
    expect(isWired("scripts/check-a.test.mjs", "run: pnpm test")).toBe(true);
    expect(isWired("scripts/check-a.test.mjs", "nothing here")).toBe(false);
  });

  it("parses ISO dates and rejects junk", () => {
    expect(parseIsoDate("2026-07-16")).toBeTypeOf("number");
    expect(parseIsoDate("nope")).toBeNull();
  });
});

describe("verdict — well-formed synthetic input passes", () => {
  it("passes", () => {
    const res = verdict(baseInput(), { now: NOW });
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe("verdict — orphan requirement / dangling test", () => {
  it("flags a control with no evidence", () => {
    const reg = makeRegister();
    reg.controls[0].evidence = [];
    expect(
      hasError(verdict(baseInput({ register: reg }), { now: NOW }), "no evidence record"),
    ).toBe(true);
  });

  it("flags a test whose enforcedBy is (none)", () => {
    const reg = makeRegister();
    reg.controls[0].tests[0].enforcedBy = "(none)";
    expect(
      hasError(verdict(baseInput({ register: reg }), { now: NOW }), "enforcedBy missing"),
    ).toBe(true);
  });

  it("flags a dangling scripts/ artefact that does not exist on disk", () => {
    const reg = makeRegister();
    reg.controls[0].tests[0].enforcedBy = "scripts/missing.mjs";
    const res = verdict(baseInput({ register: reg, existingScripts: new Set() }), { now: NOW });
    expect(hasError(res, "does not exist on disk (dangling)")).toBe(true);
  });

  it("flags an ownerless test — a guard that exists but no workflow runs", () => {
    const reg = makeRegister();
    reg.controls[0].tests[0].enforcedBy = "scripts/present.mjs";
    const res = verdict(
      baseInput({
        register: reg,
        existingScripts: new Set(["scripts/present.mjs"]),
        workflowText: "no reference here",
      }),
      { now: NOW },
    );
    expect(hasError(res, "no CI workflow runs")).toBe(true);
  });
});

describe("verdict — required-checks drift", () => {
  it("flags a compliance job missing from the manifest (a new unregistered job)", () => {
    const input = baseInput();
    input.jobNames = [...input.jobNames, "CI group (New unregistered)"];
    const res = verdict(input, { now: NOW });
    expect(res.ok).toBe(false);
    expect(hasError(res, "is not a declared required check (drift)")).toBe(true);
  });

  it("flags a stale required-check with no backing job", () => {
    const input = baseInput();
    input.requiredChecks.requiredChecks = [...input.requiredChecks.requiredChecks, "Ghost check"];
    expect(hasError(verdict(input, { now: NOW }), "is not a compliance.yml job")).toBe(true);
  });

  it("flags a canonical group whose job is not marked required", () => {
    const input = baseInput();
    input.requiredChecks.requiredChecks = input.requiredChecks.requiredChecks.filter(
      (n) => n !== GROUP_JOB_NAMES.Data,
    );
    // also drop the job so the drift check does not additionally complain
    input.jobNames = input.jobNames.filter((n) => n !== GROUP_JOB_NAMES.Data);
    expect(hasError(verdict(input, { now: NOW }), 'no compliance job for group "Data"')).toBe(true);
  });
});

describe("verdict — bypasses", () => {
  it("accepts the empty set", () => {
    expect(verdict(baseInput(), { now: NOW }).ok).toBe(true);
  });

  it("flags an expired bypass (fail-closed)", () => {
    const input = baseInput();
    input.requiredChecks.bypasses = [
      { id: "BP-1", control: "control-1", owner: "eng", reason: "x", expiresAt: "2020-01-01" },
    ];
    expect(hasError(verdict(input, { now: NOW }), "expired at 2020-01-01")).toBe(true);
  });

  it("flags a bypass with no expiry", () => {
    const input = baseInput();
    input.requiredChecks.bypasses = [
      { id: "BP-1", control: "control-1", owner: "eng", reason: "x" },
    ];
    expect(hasError(verdict(input, { now: NOW }), "needs a valid expiresAt")).toBe(true);
  });

  it("flags a bypass referencing a non-existent control", () => {
    const input = baseInput();
    input.requiredChecks.bypasses = [
      { id: "BP-1", control: "control-999", owner: "eng", reason: "x", expiresAt: "2099-01-01" },
    ];
    expect(hasError(verdict(input, { now: NOW }), "must reference a real control id")).toBe(true);
  });

  it("accepts a well-formed, unexpired bypass", () => {
    const input = baseInput();
    input.requiredChecks.bypasses = [
      { id: "BP-1", control: "control-1", owner: "eng", reason: "x", expiresAt: "2099-01-01" },
    ];
    expect(verdict(input, { now: NOW }).ok).toBe(true);
  });
});

describe("verdict — disclaimers", () => {
  it("flags a user-facing disclaimer with no allowlist entry", () => {
    const input = baseInput();
    input.disclaimerHits = [
      {
        patternId: "advice",
        file: "apps/web/src/routes/x/+page.svelte",
        line: 3,
        text: "not legal advice",
      },
    ];
    expect(hasError(verdict(input, { now: NOW }), "unaudited")).toBe(true);
  });

  it("accepts a disclaimer allowlisted with a real, tested backing control", () => {
    const input = baseInput();
    input.requiredChecks.disclaimers = [
      {
        id: "DISC-1",
        patternId: "advice",
        files: ["apps/web/src/routes/x/+page.svelte"],
        backingControls: ["control-1"],
        note: "backed",
      },
    ];
    input.disclaimerHits = [
      {
        patternId: "advice",
        file: "apps/web/src/routes/x/+page.svelte",
        line: 3,
        text: "not legal advice",
      },
    ];
    expect(verdict(input, { now: NOW }).ok).toBe(true);
  });

  it("flags an allowlist entry whose backing control is only planned", () => {
    const reg = makeRegister();
    reg.controls[0].status = "planned";
    reg.controls[0].tests[0].status = "planned";
    const input = baseInput({ register: reg });
    input.requiredChecks.disclaimers = [
      {
        id: "DISC-1",
        patternId: "advice",
        files: ["apps/web/src/routes/x/+page.svelte"],
        backingControls: ["control-1"],
        note: "x",
      },
    ];
    expect(hasError(verdict(input, { now: NOW }), 'only "planned"')).toBe(true);
  });

  it("flags an allowlist entry whose backing control does not exist", () => {
    const input = baseInput();
    input.requiredChecks.disclaimers = [
      {
        id: "DISC-1",
        patternId: "advice",
        files: ["apps/web/src/routes/x/+page.svelte"],
        backingControls: ["control-999"],
        note: "x",
      },
    ];
    expect(hasError(verdict(input, { now: NOW }), "is not a real control")).toBe(true);
  });
});

describe("verdict — workflow well-formedness", () => {
  it("flags duplicate mapping keys reported for compliance.yml", () => {
    const input = baseInput();
    input.duplicateKeys = [{ line: 42, key: "path", indent: 10 }];
    expect(hasError(verdict(input, { now: NOW }), "duplicate mapping key")).toBe(true);
  });
});

describe("verdict — real committed tree passes end to end", () => {
  it("passes with the real register, manifest and workflows", () => {
    const register = JSON.parse(readFileSync(rel("docs/legal/control-register.json"), "utf8"));
    const requiredChecks = JSON.parse(readFileSync(rel("docs/legal/required-checks.json"), "utf8"));
    const complianceText = readFileSync(rel(".github/workflows/compliance.yml"), "utf8");
    let workflowText = "";
    for (const f of readdirSync(rel(".github/workflows"))) {
      if (/\.ya?ml$/.test(f))
        workflowText += readFileSync(rel(`.github/workflows/${f}`), "utf8") + "\n";
    }
    const existingScripts = new Set();
    for (const c of register.controls) {
      for (const t of c.tests ?? []) {
        for (const art of scriptArtefacts(t.enforcedBy)) {
          if (existsSync(rel(art))) existingScripts.add(art);
        }
      }
    }
    const res = verdict(
      {
        register,
        requiredChecks,
        jobNames: extractJobNames(complianceText),
        workflowText,
        duplicateKeys: findDuplicateMappingKeys(complianceText),
        existingScripts,
        disclaimerHits: [],
      },
      { now: NOW },
    );
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});
