import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStateGeometry,
  dropOutlierParts,
  nameKey,
  VIEW_WIDTH,
  type StateMap,
} from "./maps.js";
import { DATA_DIR, REPO_ROOT, readJson } from "./paths.js";

describe("nameKey", () => {
  it("folds punctuation and case so shapefile names match dataset names", () => {
    expect(nameKey("O'Connor")).toBe(nameKey("O’Connor"));
    expect(nameKey("Eden-Monaro")).toBe(nameKey("eden monaro"));
    expect(nameKey("McEwen")).toBe(nameKey("MCEWEN"));
  });
});

describe("buildStateGeometry", () => {
  const square = (x: number, y: number, size: number): [number, number][] => [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ];

  it("scales to a fixed-width viewBox, flips y, and closes rings with Z", () => {
    const { viewBox, divisions } = buildStateGeometry([
      { name: "A", polygons: [[square(0, 0, 100)]] },
      { name: "B", polygons: [[square(100, 0, 100)]] },
    ]);
    expect(viewBox).toEqual([VIEW_WIDTH, 500]); // 200 wide × 100 tall → 1000 × 500
    const a = divisions[0];
    // Projected origin (0,0) is the bottom-left → viewBox (0, 500); no trailing duplicate point.
    expect(a.path).toBe("M0 500L500 500L500 0L0 0Z");
    expect(a.bbox).toEqual([0, 0, 500, 500]);
  });

  it("keeps cities in frame and drops ones outside it", () => {
    const { cities } = buildStateGeometry(
      [{ name: "A", polygons: [[square(0, 0, 100)]] }],
      [
        { name: "In", x: 50, y: 50 },
        { name: "Out", x: 900, y: 50 },
      ],
    );
    expect(cities.map((c) => c.name)).toEqual(["In"]);
  });
});

describe("dropOutlierParts", () => {
  const square = (x: number, y: number, size: number): [number, number][] => [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ];

  it("drops a small far-away part (Jervis Bay) but keeps near and large ones", () => {
    const core = square(0, 0, 100); // the state's main mass
    const nearIsland = square(110, 0, 10); // just offshore → keep
    const farSpeck = square(300, 0, 10); // small and 2× the extent away → drop
    const farLarge = square(300, 200, 60); // far but a third of the core → keep
    const result = dropOutlierParts([
      { name: "X", polygons: [[core], [nearIsland], [farSpeck], [farLarge]] },
    ]);
    expect(result[0]!.polygons).toEqual([[core], [nearIsland], [farLarge]]);
  });
});

describe("committed map files", () => {
  const MAPS_DIR = resolve(REPO_ROOT, "apps/web/static/maps/2025");

  it("cover every 2025 dataset electorate exactly, state by state", async () => {
    const dataset = await readJson<{
      ballots: { electorates: { state: string; electorate: string }[] };
    }>(resolve(DATA_DIR, "dist/2025/dataset.json"));

    const expected = new Map<string, string[]>();
    for (const e of dataset.ballots.electorates) {
      const state = e.state.toUpperCase();
      expected.set(state, [...(expected.get(state) ?? []), e.electorate]);
    }

    const files = (await readdir(MAPS_DIR)).filter((f) => f.endsWith(".json")).sort();
    expect(files).toEqual([...expected.keys()].sort().map((s) => `${s}.json`));

    for (const file of files) {
      const map = JSON.parse(await readFile(resolve(MAPS_DIR, file), "utf8")) as StateMap;
      const names = map.divisions.map((d) => d.name).sort();
      expect(names).toEqual(expected.get(map.state)!.sort());
      expect(map.viewBox[0]).toBe(VIEW_WIDTH);
      expect(map.viewBox[1]).toBeGreaterThan(0);
      expect(map.cities.length).toBeGreaterThan(0);
      expect(map.attribution).toContain("Australian Electoral Commission");
      for (const d of map.divisions) {
        expect(d.path.startsWith("M")).toBe(true);
        expect(d.path.endsWith("Z")).toBe(true);
        expect(d.bbox[2]).toBeGreaterThan(0);
        expect(d.bbox[3]).toBeGreaterThan(0);
      }
    }
  });
});
