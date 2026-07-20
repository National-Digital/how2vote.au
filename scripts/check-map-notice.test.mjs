import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { rendersGeometry, verdict } from "./check-map-notice.mjs";

const NOTICE = [
  "This product (how2vote.au) incorporates data that is: © Commonwealth of Australia (Australian Electoral Commission) 2026",
  "The Data has been used in how2vote.au with the permission of the Australian Electoral Commission.",
  "The Australian Electoral Commission has not evaluated the Data and gives no warranty.",
  "You may use how2vote.au to load, display, print and reproduce views, retaining this notice, for your personal use, or use within your organisation only.",
];

// A shared notice module that single-sources the wording (imports it, never re-types it).
const GOOD_LIB = `
import { notice, licence } from "$data/aec-spatial/source-record.json";
export const MAP_LICENCE_NOTICE = notice.components;
export const MAP_LICENCE_NAME = licence.name;
export const MAP_LICENCE_URL = licence.url;
`;

// A geometry component that imports the module and shows the notice.
const GOOD_MAP = {
  path: "apps/web/src/lib/components/ElectorateMap.svelte",
  text: `
    import { loadStateMap } from "$lib/maps";
    import { MAP_LICENCE_NAME, MAP_LICENCE_NOTICE, MAP_LICENCE_URL } from "$lib/mapLicence";
    {#each MAP_LICENCE_NOTICE as line}<p>{line}</p>{/each}
  `,
};

function input(over = {}) {
  return {
    noticeComponents: NOTICE,
    libModule: GOOD_LIB,
    geometryComponents: [GOOD_MAP],
    ...over,
  };
}

const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("rendersGeometry", () => {
  it("flags a component that fetches a state map", () => {
    expect(rendersGeometry("const m = await loadStateMap(id, st);")).toBe(true);
  });
  it("flags a component that paints division paths", () => {
    expect(rendersGeometry("{#each map.divisions as d}")).toBe(true);
  });
  it("ignores a component with no boundary geometry", () => {
    expect(rendersGeometry("<h1>Hello</h1>")).toBe(false);
  });
});

describe("verdict — happy path", () => {
  it("passes when the notice is single-sourced and shown next to the map", () => {
    expect(verdict(input())).toEqual({ ok: true, errors: [] });
  });
});

describe("verdict — shared module integrity", () => {
  it("fails when the module does not import the licence record", () => {
    const res = verdict(input({ libModule: "export const MAP_LICENCE_NOTICE = [];" }));
    expect(res.ok).toBe(false);
    expect(hasError(res, "single-source the wording")).toBe(true);
  });

  it("fails when the module does not export the notice", () => {
    const res = verdict(
      input({
        libModule: `import x from "$data/aec-spatial/source-record.json";\nexport const OTHER = x;`,
      }),
    );
    expect(res.ok).toBe(false);
    expect(hasError(res, "must export MAP_LICENCE_NOTICE")).toBe(true);
  });

  it("fails when a notice paragraph is hard-coded verbatim (drift risk)", () => {
    const res = verdict(
      input({
        libModule: `import { notice } from "$data/aec-spatial/source-record.json";\nexport const MAP_LICENCE_NOTICE = ["${NOTICE[0]}"];`,
      }),
    );
    expect(res.ok).toBe(false);
    expect(hasError(res, "hard-codes a notice paragraph verbatim")).toBe(true);
  });

  it("fails when the module is missing", () => {
    const res = verdict(input({ libModule: "" }));
    expect(res.ok).toBe(false);
    expect(hasError(res, "missing or empty")).toBe(true);
  });
});

describe("verdict — every map surface", () => {
  it("fails fail-closed when no component renders geometry", () => {
    const res = verdict(input({ geometryComponents: [] }));
    expect(res.ok).toBe(false);
    expect(hasError(res, "no component renders boundary geometry")).toBe(true);
  });

  it("fails when a geometry component does not import the notice module", () => {
    const res = verdict(
      input({
        geometryComponents: [
          {
            path: "a.svelte",
            text: "import { loadStateMap } from '$lib/maps';\n{#each map.divisions as d}{/each}",
          },
        ],
      }),
    );
    expect(res.ok).toBe(false);
    expect(hasError(res, "does not import the notice")).toBe(true);
  });

  it("fails when a geometry component imports but never displays the notice", () => {
    const res = verdict(
      input({
        geometryComponents: [
          { path: "b.svelte", text: "import '$lib/mapLicence';\nlet x = loadStateMap();" },
        ],
      }),
    );
    expect(res.ok).toBe(false);
    expect(hasError(res, "never displays MAP_LICENCE_NOTICE")).toBe(true);
  });

  it("flags every offending map surface, not just the first", () => {
    const res = verdict(
      input({
        geometryComponents: [
          { path: "one.svelte", text: "loadStateMap()" },
          { path: "two.svelte", text: "map.divisions" },
        ],
      }),
    );
    expect(hasError(res, "one.svelte")).toBe(true);
    expect(hasError(res, "two.svelte")).toBe(true);
  });
});

describe("verdict — real committed sources", () => {
  const root = new URL("../", import.meta.url);
  const record = JSON.parse(
    readFileSync(new URL("data/aec-spatial/source-record.json", root), "utf8"),
  );
  const libModule = readFileSync(new URL("apps/web/src/lib/mapLicence.ts", root), "utf8");
  const map = readFileSync(
    new URL("apps/web/src/lib/components/ElectorateMap.svelte", root),
    "utf8",
  );

  it("the shipped module + ElectorateMap satisfy the guard", () => {
    const res = verdict({
      noticeComponents: record.notice.components,
      libModule,
      geometryComponents: [{ path: "apps/web/src/lib/components/ElectorateMap.svelte", text: map }],
    });
    expect(res.errors).toEqual([]);
  });

  it("ElectorateMap really renders geometry (so the discovery in main() finds it)", () => {
    expect(rendersGeometry(map)).toBe(true);
  });
});
