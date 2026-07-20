import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  verdict,
  verifyGateModule,
  verifyGuardWiring,
  verifyPayloadIsolation,
} from "./check-age-gate.mjs";

const root = new URL("../", import.meta.url);
const read = (rel) => ({ path: rel, text: readFileSync(new URL(rel, root), "utf8") });

const has = (errors, needle) => errors.some((e) => e.includes(needle));

describe("verifyPayloadIsolation", () => {
  it("passes when the research path does not touch the gate", () => {
    expect(
      verifyPayloadIsolation([
        { path: "survey.ts", text: 'const q = { key: "age", label: "Your age group" };' },
        { path: "research.ts", text: "import { DEMOGRAPHIC_OPTIONS } from '../src/lib/survey';" },
      ]),
    ).toEqual([]);
  });

  it("flags an import of the age-gate module in the research path", () => {
    expect(
      has(
        verifyPayloadIsolation([
          { path: "survey/+page.svelte", text: 'import { ageGate } from "$lib/age.svelte";' },
        ]),
        "imports the age-gate module",
      ),
    ).toBe(true);
    expect(
      has(
        verifyPayloadIsolation([{ path: "x.ts", text: 'import { ageGate } from "./age";' }]),
        "imports the age-gate module",
      ),
    ).toBe(true);
  });

  it("flags any reference to the ageGate singleton in a payload builder", () => {
    expect(
      has(
        verifyPayloadIsolation([
          { path: "survey.ts", text: "payload.eligible = ageGate.confirmed;" },
        ]),
        "must never enter a research payload",
      ),
    ).toBe(true);
  });

  it("does not flag the demographic 'age group' survey field", () => {
    // The demographic key is a plain string; only the ageGate capability is prohibited here.
    expect(
      verifyPayloadIsolation([
        {
          path: "survey.ts",
          text: 'export const SURVEY = [{ key: "age", options: ["18–24", "25–34"] }];\nimport { RESEARCH_MIN_AGE } from "./org";',
        },
      ]),
    ).toEqual([]);
  });
});

describe("verifyGateModule", () => {
  const good = {
    path: "age.svelte.ts",
    text: "class AgeGate { confirmAdult() { localStorage.setItem(K, '1'); } }\nexport const ageGate = new AgeGate();",
  };

  it("passes on an eligibility-bit-only store", () => {
    expect(verifyGateModule(good)).toEqual([]);
  });

  it("rejects capturing a date of birth / age value", () => {
    expect(
      has(
        verifyGateModule({
          path: "a.ts",
          text: "let dateOfBirth = '';\nexport const ageGate = 1;",
        }),
        "date-of-birth",
      ),
    ).toBe(true);
    expect(
      has(
        verifyGateModule({ path: "a.ts", text: "let dob = read();\nexport const ageGate = 1;" }),
        "date-of-birth",
      ),
    ).toBe(true);
    expect(
      has(
        verifyGateModule({ path: "a.ts", text: "let birthYear = 0;\nexport const ageGate = 1;" }),
        "birth-year",
      ),
    ).toBe(true);
    expect(
      has(
        verifyGateModule({ path: "a.ts", text: "let ageInYears = 0;\nexport const ageGate = 1;" }),
        "numeric-age",
      ),
    ).toBe(true);
  });

  it("rejects transmitting the answer", () => {
    expect(
      has(
        verifyGateModule({ path: "a.ts", text: "fetch('/x');\nexport const ageGate = 1;" }),
        "network fetch",
      ),
    ).toBe(true);
    expect(
      has(
        verifyGateModule({
          path: "a.ts",
          text: "navigator.sendBeacon('/x');\nexport const ageGate = 1;",
        }),
        "sendBeacon",
      ),
    ).toBe(true);
    expect(
      has(
        verifyGateModule({ path: "a.ts", text: "post('/api/age');\nexport const ageGate = 1;" }),
        "API endpoint",
      ),
    ).toBe(true);
  });

  it("requires the ageGate export", () => {
    expect(
      has(verifyGateModule({ path: "a.ts", text: "const x = 1;" }), "must export the ageGate"),
    ).toBe(true);
  });

  it("fails closed when the module cannot be read", () => {
    expect(has(verifyGateModule(null), "could not read")).toBe(true);
  });
});

describe("verifyGuardWiring", () => {
  it("passes when the layout references ageGate and redirects to /start", () => {
    expect(
      verifyGuardWiring({
        path: "+layout.svelte",
        text: 'if (!ageGate.confirmed) goto("/start");',
      }),
    ).toEqual([]);
  });

  it("flags a layout that no longer references the gate", () => {
    expect(
      has(
        verifyGuardWiring({ path: "+layout.svelte", text: 'goto("/start");' }),
        "does not reference the ageGate",
      ),
    ).toBe(true);
  });

  it("flags a layout that no longer redirects to the gate", () => {
    expect(
      has(
        verifyGuardWiring({ path: "+layout.svelte", text: "ageGate.hydrate();" }),
        'does not redirect to the "/start" gate',
      ),
    ).toBe(true);
  });

  it("fails closed when the layout cannot be read", () => {
    expect(has(verifyGuardWiring(undefined), "could not read")).toBe(true);
  });
});

describe("real committed artefacts — smoke test", () => {
  const payloadSources = [
    "apps/web/src/routes/survey/+page.svelte",
    "apps/web/src/lib/survey.ts",
    "apps/web/functions/api/research.ts",
    "apps/web/functions/api/research/geography.ts",
  ].map(read);
  const gateModule = read("apps/web/src/lib/age.svelte.ts");
  const guardSource = read("apps/web/src/routes/+layout.svelte");

  it("the committed sources satisfy every age-gate invariant", () => {
    const result = verdict({ payloadSources, gateModule, guardSource });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
